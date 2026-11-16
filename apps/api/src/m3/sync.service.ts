import { ApprovalService } from "../approvals/approval.service.js";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { DefectReportPayload, FuelCreatePayload, OdometerRecordPayload, type ResolveSyncConflictRequest, type SyncEvent, type SyncResult } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
type SyncEventStatus = schema.SyncEventStatus;
import { applicableRun, checkEventClock, currentOdometer, withinGrant, type FuelFlag, type GrantWindow } from "@fleet/domain";
import { tenantOf, type RequestContext } from "../auth/context.js";
import { TokenService } from "../auth/token.service.js";
import { AppError, conflict, forbidden, notFound } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { toVehicle } from "../fleet/vehicles.controller.js";
import { driverVehicleIds, eventTime, hasAssignment } from "../m2/common.js";
import { MeterService } from "../m2/meter.service.js";
import { FuelService } from "../m2/fuel.service.js";
import { DefectService } from "../m4/defect.service.js";
import { ReadinessService, reasonDto } from "../m4/readiness.service.js";
import { renderAlert } from "../m5/alert.service.js";
import { OpsLog } from "../infra/ops-log.js";

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
    private readonly defects: DefectService,
    private readonly readiness: ReadinessService,
    private readonly ops: OpsLog,
    private readonly approvals: ApprovalService,
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
    // US-E12-02: the driver sees whether they may drive each assigned vehicle, and why not.
    const [driver] = ctx.driverId ? await db.select().from(schema.drivers).where(eq(schema.drivers.id, ctx.driverId)) : [];
    const rs = await this.readiness.evaluateMany(db, vehicles.map((vehicle) => ({ vehicle, driver })), issuedAt);
    const readiness = vehicles.map((v, i) => ({ vehicleId: v.id, outcome: rs[i]!.outcome, reasons: rs[i]!.reasons.map(reasonDto) }));
    const AL = schema.alerts;
    const mine = await db.select().from(AL).where(and(eq(AL.ownerId, ctx.identityId), inArray(AL.status, ["open", "acknowledged", "in_progress"]))).orderBy(desc(AL.createdAt)).limit(20);
    const notices = mine.map((a) => ({ id: a.id, type: a.type, ...renderAlert(a, "ar"), createdAt: a.createdAt.toISOString() }));
    const [st] = await db.select().from(ST).where(eq(ST.deviceId, deviceId));
    return {
      grant: { token, grantId: id, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), vehicleIds },
      readSet: { vehicles: vehicles.map(toVehicle), odometer, readiness, notices },
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
      let last = st!.lastAppliedSeq;

      // An event that has waited too long for an earlier one: the missing events are lost (wiped phone,
      // reinstall). It goes to the conflict queue as sequence_gap and the device moves on (Design: limits).
      const first = held[0];
      const holdLimit = Date.now() - DEFAULTS.SYNC_HOLD_MAX_DAYS * 86_400_000;
      if (first && first.deviceSeq > last + 1 && first.serverTime.getTime() < holdLimit) {
        const missing = `${last + 1}..${first.deviceSeq - 1}`;
        await this.record(tx, ctx, first, { status: "conflict", code: "sequence_gap", conflictBranchId: await this.branchOfPayload(tx, first.payload) }, { missing });
        last = first.deviceSeq;
      }

      const run = applicableRun(last, held.map((h) => h.deviceSeq));
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
        await this.record(tx, ctx, ev, outcome);
        last = seq;
      }
      if (last !== st!.lastAppliedSeq) await tx.update(ST).set({ lastAppliedSeq: last, updatedAt: new Date() }).where(eq(ST.deviceId, deviceId));
    });
  }

  /** Stores the outcome on the event (replayed to retries) and opens a conflict when needed. */
  private async record(tx: Tx, ctx: RequestContext, ev: EventRow, outcome: Outcome, extra?: Record<string, unknown>) {
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
    await TenantDb.audit(tx, ctx, "sync.event_applied", "sync_event", ev.eventId, { type: ev.type, seq: ev.deviceSeq, status: outcome.status, code: outcome.code ?? null, flags, ...extra });
    this.log.log(`tenant=${ctx.tenantId} device=${ev.deviceId} seq=${ev.deviceSeq} type=${ev.type} status=${outcome.status}${outcome.code ? ` code=${outcome.code}` : ""}`);
    // US-E19-02: a sync failure is visible in monitoring with the tenant and the reason.
    if (outcome.status === "rejected" || outcome.status === "conflict") {
      await this.ops.record({ tenantId: ctx.tenantId, kind: "sync", severity: outcome.status === "rejected" ? "error" : "warning", code: `${outcome.status}:${outcome.code ?? "unknown"}`,
        detail: { eventId: ev.eventId, type: ev.type, deviceId: ev.deviceId, seq: ev.deviceSeq } });
    }
  }

  private async branchOfPayload(tx: Tx, payload: Record<string, unknown>): Promise<string | null> {
    const id = payload.vehicleId;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [v] = await tx.select({ b: schema.vehicles.branchId }).from(schema.vehicles).where(eq(schema.vehicles.id, id));
    return v?.b ?? null;
  }

  // ------------------------------------------------------------------ handlers

  /**
   * Checks the grant and the clock, then runs the handler of the event type.
   * `review` = a person accepted or corrected the event from the conflict queue: the scope check that sent it
   * there is skipped, and `payload` may carry the corrected fields.
   */
  private async handle(tx: Tx, ctx: RequestContext, ev: EventRow, review?: { payload: Record<string, unknown> }): Promise<Outcome> {
    if (!ev.grantId) throw reject("grant_unknown");
    const [grant] = await tx.select().from(G).where(eq(G.id, ev.grantId));
    if (!grant) throw reject("grant_unknown");
    // OFF-003: a new action after the grant expired is refused; actions taken in time are accepted late.
    if (!withinGrant({ deviceTime: ev.deviceTime.getTime(), elapsedMs: ev.elapsedMs }, windowOf(grant))) throw reject("grant_expired");
    const clock = checkEventClock({ deviceTime: ev.deviceTime.getTime(), elapsedMs: ev.elapsedMs }, windowOf(grant));
    const run: Run = { ev, grant, payload: review?.payload ?? ev.payload, at: clock.eventAt, timeFlags: clock.flags, reviewed: !!review };

    switch (ev.type) {
      case "fuel.create": return this.fuelCreate(tx, ctx, run);
      case "odometer.record": return this.odometerRecord(tx, ctx, run);
      case "defect.report": return this.defectReport(tx, ctx, run);
      default: throw reject("unknown_type");
    }
  }

  private async lockVehicle(tx: Tx, id: string): Promise<VehicleRow | null> {
    const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).for("update");
    return v ?? null;
  }

  /** fuel.create: like POST /fuel-entries, with scope taken at event time (FUEL-008 allows branch vehicles). */
  private async fuelCreate(tx: Tx, ctx: RequestContext, r: Run): Promise<Outcome> {
    const p = parse(FuelCreatePayload, r.payload);
    const v = await this.lockVehicle(tx, p.vehicleId);
    if (!v) throw reject("unknown_vehicle");
    const inScope = v.status === "active" && (r.grant.vehicleIds.includes(v.id) || ctx.branchIds.includes(v.branchId));
    if (!inScope && !r.reviewed) throw conflictWith("vehicle_not_in_scope", v.branchId);
    const when = eventTime(new Date(r.at).toISOString(), v);
    const extraFlags = r.timeFlags.filter((f): f is FuelFlag => f === "clock_drift");
    const { row } = await this.fuel.create(tx, ctx, { ...p, id: r.ev.eventId }, { vehicle: v, at: when, extraFlags });
    const accepted = row.status === "accepted" && !r.timeFlags.length;
    return { status: accepted ? "accepted" : "warning", recordType: "fuel_entry", recordId: row.id, flags: row.flags };
  }

  /** odometer.record: the driver must have held the vehicle at the time of the reading (ODO-001). */
  private async odometerRecord(tx: Tx, ctx: RequestContext, r: Run): Promise<Outcome> {
    const p = parse(OdometerRecordPayload, r.payload);
    const v = await this.lockVehicle(tx, p.vehicleId);
    if (!v) throw reject("unknown_vehicle");
    const when = eventTime(new Date(r.at).toISOString(), v);
    if (ctx.role === "driver" && !r.reviewed) {
      if (!ctx.driverId || !(await hasAssignment(tx, ctx.driverId, v.id, when))) {
        // In the grant but no longer assigned at that time: the assignment ended while the driver was offline.
        throw conflictWith(r.grant.vehicleIds.includes(v.id) ? "assignment_expired" : "vehicle_not_in_scope", v.branchId);
      }
    }
    const [existing] = await tx.select().from(schema.meterReadings).where(eq(schema.meterReadings.id, r.ev.eventId));
    const capture = {
      photoTakenAt: p.photoTakenAt ? new Date(p.photoTakenAt) : null,
      location: p.location ?? null,
      locationStatus: p.locationStatus ?? (p.location ? "ok" as const : null),
    };
    const pending = !existing && (await this.approvals.needsApproval(tx, ctx, "odometer"));
    const row = existing ?? (await this.meter.record(tx, { id: r.ev.eventId, vehicleId: v.id, value: p.odometer, at: when, sourceType: "manual", sourceId: null, createdBy: ctx.identityId, capture, pending }));
    if (!existing) await TenantDb.audit(tx, ctx, "odometer.recorded", "vehicle", v.id, { value: p.odometer, at: when, status: row.status, reasons: row.reasons, offline: true, location: capture.locationStatus }, null, v.branchId);
    const accepted = row.status === "valid" && !r.timeFlags.length;
    return { status: accepted ? "accepted" : "warning", recordType: "meter_reading", recordId: row.id, flags: row.reasons.map((x) => `odometer_${x}`) };
  }

  /**
   * defect.report (US-E10-04): a fact the driver saw; like fuel, any active vehicle of the driver's branch is in
   * scope (a driver may report a vehicle they do not hold). The photo follows as a resumable upload.
   */
  private async defectReport(tx: Tx, ctx: RequestContext, r: Run): Promise<Outcome> {
    const p = parse(DefectReportPayload, r.payload);
    const v = await this.lockVehicle(tx, p.vehicleId);
    if (!v) throw reject("unknown_vehicle");
    const inScope = v.status === "active" && (r.grant.vehicleIds.includes(v.id) || ctx.branchIds.includes(v.branchId));
    if (!inScope && !r.reviewed) throw conflictWith("vehicle_not_in_scope", v.branchId);
    const when = eventTime(new Date(r.at).toISOString(), v);
    const { row } = await this.defects.create(tx, ctx, v, { ...p, id: r.ev.eventId }, when, r.timeFlags.filter((f) => f === "clock_drift"));
    return { status: r.timeFlags.length ? "warning" : "accepted", recordType: "defect", recordId: row.id, flags: row.flags };
  }

  // ------------------------------------------------------------------ conflict queue

  async conflicts(db: Db, ctx: RequestContext, status?: "open" | "accepted" | "rejected" | "corrected") {
    const C = schema.syncConflicts;
    const where = [];
    if (status) where.push(eq(C.status, status));
    if (ctx.scope === "branches") {
      if (!ctx.branchIds.length) return [];
      where.push(inArray(C.branchId, ctx.branchIds));
    }
    const rows = await db.select({ c: C, e: E }).from(C).innerJoin(E, eq(E.eventId, C.eventId)).where(where.length ? and(...where) : undefined).orderBy(desc(C.createdAt)).limit(500);
    return rows.map(({ c, e }) => toConflict(c, e));
  }

  /**
   * OFF-009/010 / US-E14-06: a person accepts, rejects or corrects an offline event, with a reason. The original
   * event stays stored; accept/correct create the record as the driver (recalculation follows from the record).
   * There is never an automatic last-write-wins.
   */
  async resolve(db: Db, ctx: RequestContext, id: string, b: z.output<typeof ResolveSyncConflictRequest>) {
    const C = schema.syncConflicts;
    return db.transaction(async (tx) => {
      const [c] = await tx.select().from(C).where(eq(C.id, id)).for("update");
      if (!c || (ctx.scope === "branches" && (!c.branchId || !ctx.branchIds.includes(c.branchId)))) throw notFound("conflict");
      if (c.status !== "open") throw conflict("already_resolved", "This conflict was already decided");
      const [ev] = await tx.select().from(E).where(eq(E.eventId, c.eventId)).for("update");
      if (!ev) throw notFound("conflict");
      if (ev.createdBy === ctx.identityId) throw forbidden("The person who recorded the event cannot decide its conflict");
      const now = new Date();

      if (b.decision === "reject") {
        await tx.update(E).set({ status: "rejected", result: { eventId: ev.eventId, status: "rejected", code: "rejected_by_reviewer" } }).where(eq(E.eventId, ev.eventId));
        const [row] = await tx.update(C).set({ status: "rejected", resolutionReason: b.reason, resolvedBy: ctx.identityId, resolvedAt: now }).where(eq(C.id, id)).returning();
        await TenantDb.audit(tx, ctx, "sync.conflict_resolved", "sync_conflict", id, { decision: "reject", reason: b.reason }, null, c.branchId);
        return toConflict(row!, ev);
      }

      // Accept / correct: run the handler as the driver who recorded the event, without the scope check.
      const [grant] = ev.grantId ? await tx.select().from(G).where(eq(G.id, ev.grantId)) : [];
      const driverCtx: RequestContext = { ...ctx, identityId: ev.createdBy, role: "driver", driverId: grant?.driverId ?? null, deviceId: ev.deviceId, branchIds: [] };
      const payload = b.decision === "correct" ? { ...ev.payload, ...b.correction } : ev.payload;
      let outcome: Outcome;
      try {
        outcome = await tx.transaction((sp) => this.handle(sp, driverCtx, ev, { payload }));
      } catch (err) {
        outcome = outcomeOf(err);
      }
      if (outcome.status === "rejected" || outcome.status === "conflict") {
        throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, "cannot_apply", "The event cannot be applied as it is; reject it or correct it", { decision: outcome.code ?? outcome.status });
      }
      const flags = [...new Set([...ev.flags, ...(outcome.flags ?? [])])];
      await tx.update(E).set({
        status: outcome.status, flags,
        result: { eventId: ev.eventId, status: outcome.status, ...(outcome.recordId ? { recordId: outcome.recordId } : {}), ...(flags.length ? { flags } : {}) },
        recordType: outcome.recordType ?? null, recordId: outcome.recordId ?? null, appliedAt: now,
      }).where(eq(E.eventId, ev.eventId));
      const [row] = await tx.update(C).set({
        status: b.decision === "correct" ? "corrected" : "accepted", resolutionReason: b.reason, resolvedBy: ctx.identityId, resolvedAt: now,
        correction: b.decision === "correct" ? (b.correction as Record<string, unknown>) : null, recordType: outcome.recordType ?? null, recordId: outcome.recordId ?? null,
      }).where(eq(C.id, id)).returning();
      await TenantDb.audit(tx, ctx, "sync.conflict_resolved", "sync_conflict", id, { decision: b.decision, reason: b.reason, correction: b.correction ?? null, recordId: outcome.recordId ?? null }, { payload: ev.payload }, c.branchId);
      return toConflict(row!, ev);
    });
  }
}

interface Run { ev: EventRow; grant: GrantRow; payload: Record<string, unknown>; at: number; timeFlags: string[]; reviewed: boolean }

type ConflictRow = typeof schema.syncConflicts.$inferSelect;
const toConflict = (c: ConflictRow, e: EventRow) => ({
  id: c.id, eventId: c.eventId, type: e.type, reason: c.reason, status: c.status, branchId: c.branchId, payload: e.payload,
  deviceTime: e.deviceTime.toISOString(), estimatedTime: e.estimatedTime?.toISOString() ?? null, serverTime: e.serverTime.toISOString(),
  flags: e.flags, createdBy: e.createdBy, createdAt: c.createdAt.toISOString(),
  resolutionReason: c.resolutionReason, resolvedBy: c.resolvedBy, resolvedAt: c.resolvedAt?.toISOString() ?? null,
  correction: c.correction ?? null, recordType: c.recordType ?? null, recordId: c.recordId ?? null,
});

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
