import { HttpException, Injectable, Logger } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { FuelCreatePayload, OdometerRecordPayload, type SyncEvent, type SyncResult } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
type SyncEventStatus = schema.SyncEventStatus;
import { applicableRun, checkEventClock, currentOdometer, withinGrant, type FuelFlag, type GrantWindow } from "@fleet/domain";
import { tenantOf, type RequestContext } from "../auth/context.js";
import { TokenService } from "../auth/token.service.js";
import { forbidden } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { toVehicle } from "../fleet/vehicles.controller.js";
import { driverVehicleIds, eventTime, hasAssignment } from "../m2/common.js";
import { MeterService } from "../m2/meter.service.js";
import { FuelService } from "../m2/fuel.service.js";

const E = schema.ingestedEvents;
const G = schema.offlineGrants;
const ST = schema.deviceSyncState;
type EventRow = typeof E.$inferSelect;
type GrantRow = typeof G.$inferSelect;
type VehicleRow = typeof schema.vehicles.$inferSelect;

/** What a handler decided for one event. Thrown AppErrors are mapped by `outcomeOf`. */
interface Outcome {
  status: Exclude<SyncEventStatus, "held">;
  code?: string;
  recordType?: string;
  recordId?: string;
  flags?: string[];
  /** Conflict queue entry (OFF-009): kept with the original event, decided by a person. */
  conflictBranchId?: string | null;
}

class Decided extends Error {
  constructor(readonly outcome: Outcome) { super(outcome.code ?? outcome.status); }
}
const reject = (code: string) => new Decided({ status: "rejected", code });
const conflictWith = (code: string, branchId: string | null) => new Decided({ status: "conflict", code, conflictBranchId: branchId });

/**
 * E14 inbox (docs/M3_Offline_Design.md): events are stored once (OFF-004/005), then applied strictly in
 * device_seq order (OFF-007), each checked against the Offline Grant it was taken under (OFF-002/003) and
 * the device clock (OFF-006). Business findings never reject an event (GEN-012); scope problems go to the
 * conflict queue (OFF-009) and are never resolved by last-write-wins.
 */
@Injectable()
export class SyncService {
  private readonly log = new Logger("sync");
  constructor(
    private readonly tokens: TokenService,
    private readonly meter: MeterService,
    private readonly fuel: FuelService,
  ) {}

  private deviceOf(ctx: RequestContext): string {
    if (!ctx.deviceId) throw forbidden("Offline sync needs an activated device");
    return ctx.deviceId;
  }

  // ------------------------------------------------------------------ grant + read set

  async state(db: Db, ctx: RequestContext) {
    const deviceId = this.deviceOf(ctx);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + DEFAULTS.OFFLINE_GRANT_HOURS * 3_600_000);
    const vehicleIds = await driverVehicleIds(db, ctx.driverId, issuedAt);
    const id = newId();
    await db.insert(G).values({ id, deviceId, identityId: ctx.identityId, driverId: ctx.driverId ?? null, vehicleIds, issuedAt, expiresAt });
    const token = await this.tokens.signOfflineGrant({ id, sub: ctx.identityId, tid: tenantOf(ctx), did: deviceId, drv: ctx.driverId ?? null, veh: vehicleIds, issuedAt, expiresAt });

    const vehicles = vehicleIds.length ? await db.select().from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds)) : [];
    const odometer = [];
    for (const v of vehicles) {
      const { domain, replacements } = await this.meter.history(db, v.id);
      const cur = currentOdometer(domain, replacements);
      if (cur) odometer.push({ vehicleId: v.id, value: cur.value, at: new Date(cur.at).toISOString() });
    }
    const [st] = await db.select().from(ST).where(eq(ST.deviceId, deviceId));
    return {
      grant: { token, grantId: id, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), vehicleIds },
      readSet: { vehicles: vehicles.map(toVehicle), odometer },
      lastAppliedSeq: st?.lastAppliedSeq ?? 0,
      serverTime: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------ inbox

  async ingest(db: Db, ctx: RequestContext, events: SyncEvent[]) {
    const deviceId = this.deviceOf(ctx);
    const immediate = new Map<string, SyncResult>();

    // 1. Store each event once. A retry finds its row and gets the stored result (OFF-005).
    for (const e of [...events].sort((a, b) => a.deviceSeq - b.deviceSeq)) {
      const r = await db.transaction(async (tx) => {
        const [byId] = await tx.select().from(E).where(eq(E.eventId, e.eventId));
        if (byId) {
          if (byId.deviceId !== deviceId || byId.createdBy !== ctx.identityId) return { eventId: e.eventId, status: "rejected", code: "id_in_use" } as SyncResult;
          return null; // known event: result read back below
        }
        const [bySeq] = await tx.select({ id: E.eventId }).from(E).where(and(eq(E.deviceId, deviceId), eq(E.deviceSeq, e.deviceSeq)));
        if (bySeq) return { eventId: e.eventId, status: "rejected", code: "seq_reused" } as SyncResult;
        const [st] = await tx.select().from(ST).where(eq(ST.deviceId, deviceId));
        if (st && e.deviceSeq <= st.lastAppliedSeq) return { eventId: e.eventId, status: "rejected", code: "seq_reused" } as SyncResult;

        const [grant] = await tx.select().from(G).where(and(eq(G.id, e.grantId), eq(G.deviceId, deviceId)));
        const deviceTime = new Date(e.deviceTime);
        const clock = grant ? checkEventClock({ deviceTime: deviceTime.getTime(), elapsedMs: e.elapsedMs }, windowOf(grant)) : null;
        await tx.insert(E).values({
          eventId: e.eventId, deviceId, deviceSeq: e.deviceSeq, type: e.type, payload: e.payload, deviceTime,
          estimatedTime: clock?.estimatedAt != null ? new Date(clock.estimatedAt) : null, clockDriftMs: clock?.driftMs ?? null,
          elapsedMs: e.elapsedMs, grantId: grant?.id ?? null, status: "held", flags: clock?.flags ?? [], createdBy: ctx.identityId,
        });
        return null;
      });
      if (r) immediate.set(e.eventId, r);
    }

    // 2. Apply every held event that has no gap before it, in device order (OFF-007).
    await this.applyHeld(db, ctx, deviceId);

    // 3. Answer for each event in the request, in request order.
    const ids = events.map((e) => e.eventId).filter((id) => !immediate.has(id));
    const rows = ids.length ? await db.select().from(E).where(inArray(E.eventId, ids)) : [];
    const byId = new Map(rows.map((r) => [r.eventId, r]));
    return events.map((e) => immediate.get(e.eventId) ?? resultOf(byId.get(e.eventId)!));
  }

  private async applyHeld(db: Db, ctx: RequestContext, deviceId: string) {
    await db.transaction(async (tx) => {
      await tx.insert(ST).values({ deviceId }).onConflictDoNothing();
      const [st] = await tx.select().from(ST).where(eq(ST.deviceId, deviceId)).for("update");
      const held = await tx.select().from(E).where(and(eq(E.deviceId, deviceId), eq(E.status, "held"))).orderBy(asc(E.deviceSeq));
      const run = applicableRun(st!.lastAppliedSeq, held.map((h) => h.deviceSeq));
      if (!run.length) return;
      const bySeq = new Map(held.map((h) => [h.deviceSeq, h]));
      for (const seq of run) {
        const ev = bySeq.get(seq)!;
        let outcome: Outcome;
        try {
          // Savepoint: a failing handler leaves no partial record behind.
          outcome = await tx.transaction((sp) => this.handle(sp, ctx, ev));
        } catch (err) {
          outcome = outcomeOf(err);
        }
        const flags = [...new Set([...ev.flags, ...(outcome.flags ?? [])])];
        const result: SyncResult = {
          eventId: ev.eventId, status: outcome.status,
          ...(outcome.recordId ? { recordId: outcome.recordId } : {}),
          ...(outcome.code ? { code: outcome.code } : {}),
          ...(flags.length ? { flags } : {}),
        };
        await tx.update(E).set({
          status: outcome.status, flags, result, recordType: outcome.recordType ?? null, recordId: outcome.recordId ?? null, appliedAt: new Date(),
        }).where(eq(E.eventId, ev.eventId));
        if (outcome.status === "conflict") {
          await tx.insert(schema.syncConflicts).values({ id: newId(), eventId: ev.eventId, branchId: outcome.conflictBranchId ?? null, reason: outcome.code ?? "conflict" });
        }
        await TenantDb.audit(tx, ctx, "sync.event_applied", "sync_event", ev.eventId, { type: ev.type, seq: ev.deviceSeq, status: outcome.status, code: outcome.code ?? null, flags });
        this.log.log(`tenant=${ctx.tenantId} device=${deviceId} seq=${ev.deviceSeq} type=${ev.type} status=${outcome.status}${outcome.code ? ` code=${outcome.code}` : ""}`);
      }
      await tx.update(ST).set({ lastAppliedSeq: run[run.length - 1]!, updatedAt: new Date() }).where(eq(ST.deviceId, deviceId));
    });
  }

  // ------------------------------------------------------------------ handlers

  private async handle(tx: Tx, ctx: RequestContext, ev: EventRow): Promise<Outcome> {
    if (!ev.grantId) throw reject("grant_unknown");
    const [grant] = await tx.select().from(G).where(eq(G.id, ev.grantId));
    if (!grant) throw reject("grant_unknown");
    // OFF-003: a new action after the grant expired is refused; actions taken in time are accepted late.
    if (!withinGrant({ deviceTime: ev.deviceTime.getTime(), elapsedMs: ev.elapsedMs }, windowOf(grant))) throw reject("grant_expired");
    const clock = checkEventClock({ deviceTime: ev.deviceTime.getTime(), elapsedMs: ev.elapsedMs }, windowOf(grant));

    switch (ev.type) {
      case "fuel.create": return this.fuelCreate(tx, ctx, ev, grant, clock.eventAt, clock.flags);
      case "odometer.record": return this.odometerRecord(tx, ctx, ev, grant, clock.eventAt, clock.flags);
      default: throw reject("unknown_type");
    }
  }

  private async lockVehicle(tx: Tx, id: string): Promise<VehicleRow | null> {
    const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).for("update");
    return v ?? null;
  }

  /** fuel.create: like POST /fuel-entries, with scope taken at event time (FUEL-008 allows branch vehicles). */
  private async fuelCreate(tx: Tx, ctx: RequestContext, ev: EventRow, grant: GrantRow, at: number, timeFlags: string[]): Promise<Outcome> {
    const p = parse(FuelCreatePayload, ev.payload);
    const v = await this.lockVehicle(tx, p.vehicleId);
    if (!v) throw reject("unknown_vehicle");
    const inScope = v.status === "active" && (grant.vehicleIds.includes(v.id) || ctx.branchIds.includes(v.branchId));
    if (!inScope) throw conflictWith("vehicle_not_in_scope", v.branchId);
    const when = eventTime(new Date(at).toISOString(), v);
    const extraFlags = timeFlags.filter((f): f is FuelFlag => f === "clock_drift");
    const { row } = await this.fuel.create(tx, ctx, { ...p, id: ev.eventId }, { vehicle: v, at: when, extraFlags });
    const accepted = row.status === "accepted" && !timeFlags.length;
    return { status: accepted ? "accepted" : "warning", recordType: "fuel_entry", recordId: row.id, flags: row.flags };
  }

  /** odometer.record: the driver must have held the vehicle at the time of the reading (ODO-001). */
  private async odometerRecord(tx: Tx, ctx: RequestContext, ev: EventRow, grant: GrantRow, at: number, timeFlags: string[]): Promise<Outcome> {
    const p = parse(OdometerRecordPayload, ev.payload);
    const v = await this.lockVehicle(tx, p.vehicleId);
    if (!v) throw reject("unknown_vehicle");
    const when = eventTime(new Date(at).toISOString(), v);
    if (ctx.role === "driver") {
      if (!ctx.driverId || !(await hasAssignment(tx, ctx.driverId, v.id, when))) {
        // In the grant but no longer assigned at that time: the assignment ended while the driver was offline.
        throw conflictWith(grant.vehicleIds.includes(v.id) ? "assignment_expired" : "vehicle_not_in_scope", v.branchId);
      }
    }
    const [existing] = await tx.select().from(schema.meterReadings).where(eq(schema.meterReadings.id, ev.eventId));
    const row = existing ?? (await this.meter.record(tx, { id: ev.eventId, vehicleId: v.id, value: p.odometer, at: when, sourceType: "manual", sourceId: null, createdBy: ctx.identityId }));
    if (!existing) await TenantDb.audit(tx, ctx, "odometer.recorded", "vehicle", v.id, { value: p.odometer, at: when, status: row.status, reasons: row.reasons, offline: true }, null, v.branchId);
    const accepted = row.status === "valid" && !timeFlags.length;
    return { status: accepted ? "accepted" : "warning", recordType: "meter_reading", recordId: row.id, flags: row.reasons.map((r) => `odometer_${r}`) };
  }

  // ------------------------------------------------------------------ conflict queue (read)

  async conflicts(db: Db, ctx: RequestContext, status?: "open" | "accepted" | "rejected" | "corrected") {
    const C = schema.syncConflicts;
    const where = [];
    if (status) where.push(eq(C.status, status));
    if (ctx.scope === "branches") {
      if (!ctx.branchIds.length) return [];
      where.push(inArray(C.branchId, ctx.branchIds));
    }
    const rows = await db.select({ c: C, e: E }).from(C).innerJoin(E, eq(E.eventId, C.eventId)).where(where.length ? and(...where) : undefined).orderBy(desc(C.createdAt)).limit(500);
    return rows.map(({ c, e }) => ({
      id: c.id, eventId: c.eventId, type: e.type, reason: c.reason, status: c.status, branchId: c.branchId, payload: e.payload,
      deviceTime: e.deviceTime.toISOString(), estimatedTime: e.estimatedTime?.toISOString() ?? null, serverTime: e.serverTime.toISOString(),
      flags: e.flags, createdBy: e.createdBy, createdAt: c.createdAt.toISOString(),
      resolutionReason: c.resolutionReason, resolvedBy: c.resolvedBy, resolvedAt: c.resolvedAt?.toISOString() ?? null,
    }));
  }
}

const windowOf = (g: GrantRow): GrantWindow => ({ issuedAt: g.issuedAt.getTime(), expiresAt: g.expiresAt.getTime() });

function parse<T extends z.ZodTypeAny>(s: T, payload: unknown): z.output<T> {
  const r = s.safeParse(payload);
  if (!r.success) throw reject("invalid_payload");
  return r.data;
}

function resultOf(row: EventRow): SyncResult {
  if (row.result) return row.result as unknown as SyncResult;
  return { eventId: row.eventId, status: row.status, ...(row.flags.length ? { flags: row.flags } : {}) };
}

/** Errors from shared services become event outcomes; anything unexpected is rethrown so the device retries. */
function outcomeOf(err: unknown): Outcome {
  if (err instanceof Decided) return err.outcome;
  if (err instanceof HttpException) {
    const body = err.getResponse() as { error?: { code?: string; fields?: Record<string, string> } };
    const code = body?.error?.code ?? "error";
    const status = err.getStatus();
    if (status === 404) return { status: "conflict", code: "vehicle_not_in_scope", conflictBranchId: null };
    if (status === 409) return { status: "conflict", code, conflictBranchId: null };
    const field = body?.error?.fields ? Object.values(body.error.fields)[0] : undefined;
    return { status: "rejected", code: field ?? code };
  }
  throw err;
}
