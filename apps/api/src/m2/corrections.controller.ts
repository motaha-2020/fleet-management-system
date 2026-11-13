import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { COST_CATEGORIES as COUNTRY_COST_CATEGORIES } from "@fleet/config";
import { routes, type Correction } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, canApproveCorrection, CORRECTABLE, isFinancialCorrection, localDate, type CorrectableRecord } from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { QUEUE } from "../infra/tokens.js";
import type { JobQueue } from "../infra/infra.module.js";
import { enqueueKpiRecalculation } from "../m5/jobs.js";
import { queueKpiRecalculation } from "../m5/kpi-recalc.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { AppError, conflict, forbidden, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { companyOf, type DbOrTx } from "./common.js";
import { MeterService } from "./meter.service.js";
import { FuelRecalc } from "./fuel-recalc.service.js";

const K = schema.corrections;
type Row = typeof K.$inferSelect;
const F = schema.fuelEntries;
const R = schema.meterReadings;
const C = schema.costRecords;

/** Typed new values per record type; unknown fields are refused. */
const NEW_VALUES = {
  fuel_entry: z.object({
    eventAt: z.iso.datetime({ offset: true }), odometer: z.number().int().min(0), quantity: z.number().positive(), fuelType: z.string().max(16),
    isFull: z.boolean(), netMinor: z.number().int().positive(), taxMinor: z.number().int().min(0), payment: z.enum(["cash", "card"]), receiptRef: z.string().max(64).nullable(),
  }).partial().strict(),
  meter_reading: z.object({ value: z.number().int().min(0), eventAt: z.iso.datetime({ offset: true }) }).partial().strict(),
  cost_record: z.object({
    category: z.enum(COUNTRY_COST_CATEGORIES).refine((c) => c !== "fuel", "use_fuel_entries"), netMinor: z.number().int().min(0), taxMinor: z.number().int().min(0),
    expenseDate: z.iso.date(), vendorId: z.uuid().nullable(), description: z.string().max(500).nullable(), eInvoiceUuid: z.string().max(64).nullable(),
  }).partial().strict(),
} satisfies Record<CorrectableRecord, z.ZodTypeAny>;

/**
 * E16. No silent overwrite (GEN-003): a change to an accepted fuel entry, a reading or a cost is a
 * Correction with previous/new values and a reason. It is applied only when a different person with
 * the right to approve it does so (AUD-002, GEN-004 — also a DB CHECK). The original stays readable:
 * the correction keeps the previous values, and corrected readings are kept with status Corrected.
 * KPIs are computed from the ledgers on read. Applying a correction also queues each month of its affected
 * period for recalculation (US-E16-03): the dashboard shows those months as "Recalculating" until the job has
 * replaced their snapshot, and keeps the reason with the values before and after.
 */
@Controller()
export class CorrectionsController {
  constructor(private readonly tdb: TenantDb, private readonly meter: MeterService, private readonly recalc: FuelRecalc, @Inject(QUEUE) private readonly queue: JobQueue) {}

  private toDto(k: Row, ctx: RequestContext): Correction {
    return {
      id: k.id, recordType: k.recordType, recordId: k.recordId, changes: k.changes, reason: k.reason, financial: k.financial, status: k.status,
      requestedBy: k.requestedBy, requestedAt: k.requestedAt.toISOString(), decidedBy: k.decidedBy, decidedAt: k.decidedAt?.toISOString() ?? null,
      decisionNote: k.decisionNote, affectedFrom: k.affectedFrom, affectedTo: k.affectedTo,
      canDecide: k.status === "pending" && k.requestedBy !== ctx.identityId && canApproveCorrection(ctx.role, k.financial),
    };
  }

  /** Loads the record + its branch, enforcing the requester's scope. */
  private async record(tx: DbOrTx, ctx: RequestContext, type: CorrectableRecord, id: string, lock = false) {
    const lockIf = <T extends { for: (s: "update") => unknown }>(q: T) => (lock ? q.for("update") : q);
    let current: Record<string, unknown>;
    let branchId: string;
    let ownedByDriver = false;
    if (type === "fuel_entry") {
      const [e] = (await lockIf(tx.select().from(F).where(eq(F.id, id)))) as (typeof F.$inferSelect)[];
      if (!e) throw notFound("record");
      if (e.status === "voided") throw conflict("voided", "A voided entry cannot be corrected");
      current = { eventAt: e.eventAt.toISOString(), odometer: e.odometer, quantity: Number(e.quantity), fuelType: e.fuelType, isFull: e.isFull, netMinor: e.netMinor, taxMinor: e.taxMinor, payment: e.payment, receiptRef: e.receiptRef };
      branchId = e.branchId;
      ownedByDriver = !!ctx.driverId && e.driverId === ctx.driverId;
    } else if (type === "meter_reading") {
      const [r] = (await lockIf(tx.select().from(R).where(eq(R.id, id)))) as (typeof R.$inferSelect)[];
      if (!r) throw notFound("record");
      if (r.status === "corrected" || r.status === "excluded") throw conflict("not_correctable", `A ${r.status} reading cannot be corrected`);
      const [v] = await tx.select({ branchId: schema.vehicles.branchId }).from(schema.vehicles).where(eq(schema.vehicles.id, r.vehicleId));
      current = { value: r.value, eventAt: r.eventAt.toISOString() };
      branchId = v!.branchId;
    } else {
      const [c] = (await lockIf(tx.select().from(C).where(eq(C.id, id)))) as (typeof C.$inferSelect)[];
      if (!c) throw notFound("record");
      if (c.sourceType !== "manual") throw conflict("correct_at_source", "Correct the source record (e.g. the fuel entry) instead");
      if (c.status === "voided") throw conflict("voided", "A voided cost cannot be corrected");
      current = { category: c.category, netMinor: c.netMinor, taxMinor: c.taxMinor, expenseDate: c.expenseDate, vendorId: c.vendorId, description: c.description, eInvoiceUuid: c.eInvoiceUuid };
      branchId = c.branchId;
    }
    if (ctx.role === "driver") {
      if (type !== "fuel_entry" || !ownedByDriver) throw notFound("record");
    } else {
      const filter = branchFilter(ctx, ctx.scope!);
      if (filter && !filter.includes(branchId)) throw notFound("record");
    }
    return { current, branchId };
  }

  @Requires("correction.request") @Post(routes.requestCorrection.path) @HttpCode(201)
  async request(@Body(new ZodPipe(routes.requestCorrection.body)) b: z.output<typeof routes.requestCorrection.body>, @Ctx() ctx: RequestContext) {
    const parsed = NEW_VALUES[b.recordType].safeParse(b.changes);
    if (!parsed.success) throw validation(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "changes", i.message])));
    const db = await this.tdb.for(ctx);
    const { company } = await companyOf(db);
    try {
      return await db.transaction(async (tx) => {
        const { current, branchId } = await this.record(tx, ctx, b.recordType, b.recordId);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const [field, to] of Object.entries(parsed.data as Record<string, unknown>)) {
          if (!(CORRECTABLE[b.recordType] as readonly string[]).includes(field)) throw validation({ [field]: "not_correctable" });
          if (JSON.stringify(current[field]) !== JSON.stringify(to)) changes[field] = { from: current[field] ?? null, to };
        }
        if (!Object.keys(changes).length) throw validation({ changes: "no_change" });
        const dates = [current.eventAt, (parsed.data as Record<string, unknown>).eventAt, current.expenseDate, (parsed.data as Record<string, unknown>).expenseDate]
          .filter((x): x is string => typeof x === "string")
          .map((d) => (d.length === 10 ? d : localDate(new Date(d), company.timezone)))
          .sort();
        const [row] = await tx.insert(K).values({
          id: newId(), recordType: b.recordType, recordId: b.recordId, branchId, changes, reason: b.reason,
          financial: isFinancialCorrection(b.recordType, Object.keys(changes)), status: "pending", requestedBy: ctx.identityId,
          affectedFrom: dates[0] ?? null, affectedTo: dates.at(-1) ?? null,
        }).returning();
        await TenantDb.audit(tx, ctx, "correction.requested", b.recordType, b.recordId, { correctionId: row!.id, changes, reason: b.reason }, null, branchId);
        return this.toDto(row!, ctx);
      });
    } catch (e) {
      if (uniqueViolation(e) === "corrections_one_pending") throw conflict("correction_pending", "This record already has a pending correction");
      throw e;
    }
  }

  @Requires("correction.request") @Get(routes.listCorrections.path)
  async list(@Query(new ZodPipe(routes.listCorrections.query)) q: z.output<typeof routes.listCorrections.query>, @Ctx() ctx: RequestContext) {
    const where: SQL[] = [];
    if (ctx.role === "driver") where.push(eq(K.requestedBy, ctx.identityId));
    else {
      const filter = branchFilter(ctx, ctx.scope!);
      if (filter && !filter.length) return { items: [] };
      if (filter) where.push(inArray(K.branchId, [...filter]));
    }
    if (q.status) where.push(eq(K.status, q.status));
    if (q.recordType) where.push(eq(K.recordType, q.recordType));
    if (q.recordId) where.push(eq(K.recordId, q.recordId));
    const db = await this.tdb.for(ctx);
    const rows = await db.select().from(K).where(and(...where)).orderBy(desc(K.requestedAt)).limit(500);
    return { items: rows.map((k) => this.toDto(k, ctx)) };
  }

  private async lockPending(tx: Tx, ctx: RequestContext, id: string) {
    const [k] = await tx.select().from(K).where(eq(K.id, id)).for("update");
    if (!k) throw notFound("correction");
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.includes(k.branchId)) throw notFound("correction");
    if (k.status !== "pending") throw conflict("invalid_transition", "This correction was already decided");
    if (k.requestedBy === ctx.identityId) throw new AppError(HttpStatus.FORBIDDEN, "maker_checker", "You cannot verify a record you created");
    if (!canApproveCorrection(ctx.role, k.financial)) throw forbidden(k.financial ? "Financial corrections are approved by finance or a company admin" : "Only fleet managers or company admins approve this correction");
    return k;
  }

  @Requires("correction.approve") @Post(routes.rejectCorrection.path) @HttpCode(200)
  async reject(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.rejectCorrection.body)) b: z.output<typeof routes.rejectCorrection.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const k = await this.lockPending(tx, ctx, id);
      const [row] = await tx.update(K).set({ status: "rejected", decidedBy: ctx.identityId, decidedAt: new Date(), decisionNote: b.note ?? null }).where(eq(K.id, id)).returning();
      await TenantDb.audit(tx, ctx, "correction.rejected", k.recordType, k.recordId, { correctionId: id, note: b.note ?? null }, null, k.branchId);
      return this.toDto(row!, ctx);
    });
  }

  @Requires("correction.approve") @Post(routes.approveCorrection.path) @HttpCode(200)
  async approve(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.approveCorrection.body)) b: z.output<typeof routes.approveCorrection.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const { country } = await companyOf(db);
    const result = await db.transaction(async (tx) => {
      const k = await this.lockPending(tx, ctx, id);
      const { current } = await this.record(tx, { ...ctx, role: "company_admin", scope: "all" }, k.recordType, k.recordId, true);
      // The record must still be what the requester saw.
      for (const [f, ch] of Object.entries(k.changes)) {
        if (JSON.stringify(current[f] ?? null) !== JSON.stringify(ch.from)) throw conflict("stale_correction", "The record changed since this correction was requested; request it again");
      }
      const to = Object.fromEntries(Object.entries(k.changes).map(([f, ch]) => [f, ch.to])) as Record<string, unknown>;
      if (k.recordType === "fuel_entry") await this.applyFuel(tx, ctx, k.recordId, to, country.code);
      else if (k.recordType === "meter_reading") await this.applyReading(tx, ctx, k.recordId, to);
      else await this.applyCost(tx, k.recordId, to, country.taxRecoverable);
      const [row] = await tx.update(K).set({ status: "applied", decidedBy: ctx.identityId, decidedAt: new Date(), decisionNote: b.note ?? null }).where(eq(K.id, id)).returning();
      await TenantDb.audit(tx, ctx, "correction.applied", k.recordType, k.recordId, { correctionId: id, changes: k.changes, affectedFrom: k.affectedFrom, affectedTo: k.affectedTo }, null, k.branchId);
      const months = await queueKpiRecalculation(tx, { id, reason: k.reason, from: k.affectedFrom, to: k.affectedTo, by: ctx.identityId });
      return { dto: this.toDto(row!, ctx), months };
    });
    if (result.months.length) await enqueueKpiRecalculation(this.queue, tenantOf(ctx));
    return result.dto;
  }

  private async applyFuel(tx: Tx, ctx: RequestContext, id: string, to: Record<string, unknown>, countryCode: string) {
    const [e] = await tx.select().from(F).where(eq(F.id, id));
    const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, e!.vehicleId)).for("update");
    const next = {
      eventAt: to.eventAt ? new Date(to.eventAt as string) : e!.eventAt,
      odometer: (to.odometer as number | undefined) ?? e!.odometer,
      quantity: (to.quantity as number | undefined) ?? Number(e!.quantity),
      fuelType: (to.fuelType as string | undefined) ?? e!.fuelType,
      isFull: (to.isFull as boolean | undefined) ?? e!.isFull,
      netMinor: (to.netMinor as number | undefined) ?? e!.netMinor,
      taxMinor: (to.taxMinor as number | undefined) ?? e!.taxMinor,
      payment: (to.payment as "cash" | "card" | undefined) ?? e!.payment,
      receiptRef: to.receiptRef !== undefined ? (to.receiptRef as string | null) : e!.receiptRef,
    };
    let readingId = e!.readingId;
    let readingStatus = "valid";
    if (to.odometer !== undefined || to.eventAt !== undefined) {
      // ODO-010: the old reading is kept as Corrected; a new version is classified without it.
      const reading = await this.meter.record(tx, { vehicleId: v!.id, value: next.odometer, at: next.eventAt, sourceType: "fuel", sourceId: id, createdBy: ctx.identityId, excludeIds: readingId ? [readingId] : [] });
      if (readingId) await tx.update(R).set({ status: "corrected", correctedBy: reading.id }).where(eq(R.id, readingId));
      readingId = reading.id;
      readingStatus = reading.status;
    } else if (readingId) {
      readingStatus = (await tx.select({ s: R.status }).from(R).where(eq(R.id, readingId)))[0]?.s ?? "valid";
    }
    const { flags, reference } = await this.recalc.evaluate(tx, {
      selfId: id, vehicle: v!, driverId: e!.driverId, fuelType: next.fuelType, quantity: next.quantity, grossMinor: next.netMinor + next.taxMinor,
      at: next.eventAt, receiptRef: next.receiptRef, hasReceiptFile: !!e!.receiptFileKey, payment: next.payment, readingStatus, countryCode,
    });
    // An approved correction is itself a review: entries waiting only for review become accepted.
    const status = e!.status === "under_review" && !flags.some((f) => f === "tank_exceeded" || f === "odometer_conflict" || f === "possible_duplicate") ? "accepted" : e!.status;
    const [row] = await tx.update(F).set({
      ...next, readingId, flags, status, referencePriceMinor: reference?.priceMinor ?? null, referenceOfficial: reference?.official ?? null,
      ...(status !== e!.status ? { reviewedBy: e!.createdBy === ctx.identityId ? null : ctx.identityId, reviewedAt: new Date() } : {}),
    }).where(eq(F.id, id)).returning();
    if (row!.status === "accepted") {
      await this.recalc.ensureCost(tx, ctx, row!);
      await this.recalc.syncCost(tx, row!);
    }
  }

  private async applyReading(tx: Tx, ctx: RequestContext, id: string, to: Record<string, unknown>) {
    const [old] = await tx.select().from(R).where(eq(R.id, id));
    await tx.select({ id: schema.vehicles.id }).from(schema.vehicles).where(eq(schema.vehicles.id, old!.vehicleId)).for("update");
    const value = (to.value as number | undefined) ?? old!.value;
    const at = to.eventAt ? new Date(to.eventAt as string) : old!.eventAt;
    const fresh = await this.meter.record(tx, { vehicleId: old!.vehicleId, value, at, sourceType: old!.sourceType, sourceId: old!.sourceId, createdBy: ctx.identityId, excludeIds: [id] });
    await tx.update(R).set({ status: "corrected", correctedBy: fresh.id }).where(eq(R.id, id));
    // Keep the source record pointing at the current version.
    if (old!.sourceType === "fuel" && old!.sourceId) await tx.update(F).set({ odometer: value, readingId: fresh.id }).where(eq(F.id, old!.sourceId));
    if (old!.sourceType === "handover" && old!.sourceId) await tx.update(schema.handovers).set({ odometer: value, readingId: fresh.id }).where(eq(schema.handovers.id, old!.sourceId));
  }

  private async applyCost(tx: Tx, id: string, to: Record<string, unknown>, taxRecoverable: Record<string, boolean>) {
    const set: Partial<typeof C.$inferInsert> = { ...(to as Partial<typeof C.$inferInsert>) };
    if (to.category) set.taxRecoverable = taxRecoverable[to.category as string] ?? true;
    await tx.update(C).set(set).where(eq(C.id, id));
  }
}
