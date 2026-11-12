import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { routes, type Assignment } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import {
  assignmentConflicts, authorize, blockingReasons, branchFilter, canAccessBranch, custodyTimeline,
  type AssignmentLike,
} from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { AppError, conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { activeAssignmentWhere, custodianAt, custodySegments, eventTime, exclusionViolation, iso, loadVehicle, type DbOrTx } from "./common.js";
import { MeterService } from "./meter.service.js";
import { FuelRecalc } from "./fuel-recalc.service.js";
import { HttpStatus } from "@nestjs/common";
import { ReadinessService } from "../m4/readiness.service.js";

const A = schema.assignments;
const H = schema.handovers;
type Row = typeof A.$inferSelect;

export const toAssignment = (a: Row): Assignment => ({
  id: a.id, vehicleId: a.vehicleId, driverId: a.driverId, role: a.role, startsAt: a.startsAt.toISOString(), endsAt: iso(a.endsAt),
  status: a.status, notes: a.notes, createdBy: a.createdBy, createdAt: a.createdAt.toISOString(),
});
const like = (a: Row): AssignmentLike => ({ id: a.id, vehicleId: a.vehicleId, driverId: a.driverId, role: a.role, start: a.startsAt.getTime(), end: a.endsAt?.getTime() ?? null });

/** E07: assignments, handover and custody. */
@Controller()
export class AssignmentsController {
  constructor(private readonly tdb: TenantDb, private readonly meter: MeterService, private readonly recalc: FuelRecalc, private readonly readiness: ReadinessService) {}

  /**
   * OPS-007 enforcement point: restricted findings that are not overridden block the action. Field names keep
   * the M2 contract (vehicleId / driverId → reason code).
   */
  private async assertReady(tx: DbOrTx, t: Parameters<ReadinessService["evaluate"]>[1], at: Date, driverField = "driverId") {
    const r = await this.readiness.evaluate(tx, t, at);
    const blocking = blockingReasons(r);
    if (!blocking.length) return r;
    const fields: Record<string, string> = {};
    for (const b of blocking) {
      const f = b.entityType === "vehicle" ? "vehicleId" : driverField;
      fields[f] ??= b.subject && b.entityType === "vehicle" ? `${b.code}:${b.subject}` : b.code;
    }
    throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, "not_eligible", "Operational readiness restricts this action", fields);
  }

  @Requires("assignment.read") @Get(routes.listAssignments.path)
  async list(@Query(new ZodPipe(routes.listAssignments.query)) q: z.output<typeof routes.listAssignments.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const where: SQL[] = [eq(A.status, "active")];
    if (ctx.scope === "own") where.push(eq(A.driverId, ctx.driverId ?? "00000000-0000-0000-0000-000000000000"));
    const filter = ctx.scope === "own" ? null : branchFilter(ctx, ctx.scope!);
    if (filter) {
      if (!filter.length) return { items: [] };
      where.push(inArray(A.vehicleId, db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(inArray(schema.vehicles.branchId, [...filter]))));
    }
    if (q.vehicleId) where.push(eq(A.vehicleId, q.vehicleId));
    if (q.driverId) where.push(eq(A.driverId, q.driverId));
    if (q.current === "true") where.push(activeAssignmentWhere(new Date())!);
    const rows = await db.select().from(A).where(and(...where)).orderBy(desc(A.startsAt)).limit(500);
    return { items: rows.map(toAssignment) };
  }

  private async driverInScope(tx: DbOrTx, ctx: RequestContext, driverId: string) {
    const [d] = await tx.select().from(schema.drivers).where(eq(schema.drivers.id, driverId));
    // DRV-006: assigning outside the driver's home branch needs access to both branches.
    if (!d || !canAccessBranch(ctx, ctx.scope!, d.branchId)) throw notFound("driver");
    return d;
  }

  private async assertNoConflicts(tx: Tx, candidate: AssignmentLike | (Omit<AssignmentLike, "id"> & { id?: string })) {
    const existing = await tx.select().from(A).where(and(eq(A.status, "active"), sql`(${A.vehicleId} = ${candidate.vehicleId} OR ${A.driverId} = ${candidate.driverId})`));
    const conflicts = assignmentConflicts(candidate, existing.map(like));
    if (conflicts.length) {
      const c = conflicts[0]!;
      throw conflict("assignment_overlap", `Overlaps assignment ${c.withId} (${c.kind})`, { [c.kind === "driver_primary" ? "driverId" : "vehicleId"]: `${c.kind}:${c.withId}` });
    }
  }

  /** US-E07-01: overlap rules, license category (R4, no override), eligible driver, active vehicle. */
  @Requires("assignment.write") @Post(routes.createAssignment.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createAssignment.body)) b: z.output<typeof routes.createAssignment.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    try {
      return await db.transaction(async (tx) => {
        if (b.id) {
          const [existing] = await tx.select().from(A).where(eq(A.id, b.id));
          if (existing) return toAssignment(existing);
        }
        const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true });
        const d = await this.driverInScope(tx, ctx, b.driverId);
        const startsAt = b.startsAt ? new Date(b.startsAt) : new Date();
        eventTime(startsAt.toISOString(), v, "startsAt");
        if (startsAt.getTime() < Date.now() - DEFAULTS.MAX_FUTURE_SKEW_MINUTES * 60_000 && !authorize(ctx.role, "assignment.backdate").allowed) {
          throw forbidden("Starting an assignment in the past needs the backdate permission");
        }
        const endsAt = b.endsAt ? new Date(b.endsAt) : null;
        if (endsAt && endsAt <= startsAt) throw validation({ endsAt: "before_start" });
        // E12: license, employment, vehicle status, documents, maintenance, not-drivable work orders/defects.
        await this.assertReady(tx, { vehicle: v, driver: d }, startsAt.getTime() > Date.now() ? startsAt : new Date());
        const candidate = { vehicleId: v.id, driverId: d.id, role: b.role, start: startsAt.getTime(), end: endsAt?.getTime() ?? null };
        await this.assertNoConflicts(tx, candidate);
        const [row] = await tx.insert(A).values({ id: b.id ?? newId(), vehicleId: v.id, driverId: d.id, role: b.role, startsAt, endsAt, notes: b.notes ?? null, createdBy: ctx.identityId }).returning();
        await TenantDb.audit(tx, ctx, "assignment.created", "assignment", row!.id, toAssignment(row!), null, v.branchId);
        // Entries recorded before this assignment existed may no longer lack one.
        await this.recalc.assignmentChanged(tx, ctx, d.id, v.id, startsAt, endsAt);
        return toAssignment(row!);
      });
    } catch (e) {
      if (exclusionViolation(e)) throw conflict("assignment_overlap", "Overlaps another assignment");
      throw e;
    }
  }

  private async lockInScope(tx: Tx, ctx: RequestContext, id: string) {
    const [a] = await tx.select().from(A).where(eq(A.id, id)).for("update");
    if (!a || a.status !== "active") throw notFound("assignment");
    const v = await loadVehicle(tx, ctx, a.vehicleId);
    return { a, v };
  }

  @Requires("assignment.write") @Post(routes.endAssignment.path) @HttpCode(200)
  async end(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.endAssignment.body)) b: z.output<typeof routes.endAssignment.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const { a, v } = await this.lockInScope(tx, ctx, id);
      const endsAt = b.endsAt ? new Date(b.endsAt) : new Date();
      if (endsAt <= a.startsAt) throw validation({ endsAt: "before_start" });
      if (a.endsAt && a.endsAt <= new Date()) throw conflict("already_ended", "This assignment has already ended");
      const [row] = await tx.update(A).set({ endsAt, updatedAt: new Date() }).where(eq(A.id, id)).returning();
      await TenantDb.audit(tx, ctx, "assignment.ended", "assignment", id, { endsAt }, { endsAt: a.endsAt }, v.branchId);
      return toAssignment(row!);
    });
  }

  /** US-E07-02: moving the start earlier re-attributes fuel entries in the new range and is audited. */
  @Requires("assignment.backdate") @Post(routes.backdateAssignment.path) @HttpCode(200)
  async backdate(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.backdateAssignment.body)) b: z.output<typeof routes.backdateAssignment.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    try {
      return await db.transaction(async (tx) => {
        const { a, v } = await this.lockInScope(tx, ctx, id);
        const startsAt = new Date(b.startsAt);
        if (startsAt >= a.startsAt) throw validation({ startsAt: "not_earlier" });
        eventTime(b.startsAt, v, "startsAt");
        await this.assertNoConflicts(tx, { ...like(a), start: startsAt.getTime() });
        const [row] = await tx.update(A).set({ startsAt, updatedAt: new Date() }).where(eq(A.id, id)).returning();
        const recalculated = await this.recalc.assignmentChanged(tx, ctx, a.driverId, a.vehicleId, startsAt, a.startsAt);
        await TenantDb.audit(tx, ctx, "assignment.backdated", "assignment", id, { startsAt, reason: b.reason, recalculatedFuelEntries: recalculated }, { startsAt: a.startsAt }, v.branchId);
        return toAssignment(row!);
      });
    } catch (e) {
      if (exclusionViolation(e)) throw conflict("assignment_overlap", "Overlaps another assignment");
      throw e;
    }
  }

  // ---------------------------------------------------------------- handover (ASN-007)
  @Requires("handover.create") @Post(routes.createHandover.path) @HttpCode(201)
  async handover(@Body(new ZodPipe(routes.createHandover.body)) b: z.output<typeof routes.createHandover.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      if (b.id) {
        const [existing] = await tx.select().from(H).where(eq(H.id, b.id));
        if (existing) return this.toHandover(tx, existing);
      }
      const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true });
      const at = eventTime(b.eventAt, v);
      const holder = await this.custodianAt(tx, v.id, at);
      if (ctx.role === "driver" && holder !== ctx.driverId) throw forbidden("Only the current custodian can hand the vehicle over");
      if (holder === b.toDriverId) throw validation({ toDriverId: "already_custodian" });
      // The receiver must be authorized (an assignment on this vehicle now) and eligible.
      const [assigned] = await tx.select({ id: A.id }).from(A).where(and(eq(A.vehicleId, v.id), eq(A.driverId, b.toDriverId), activeAssignmentWhere(at))).limit(1);
      const [to] = await tx.select().from(schema.drivers).where(eq(schema.drivers.id, b.toDriverId));
      if (!to) throw validation({ toDriverId: "unknown_driver" });
      if (!assigned) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, "not_authorized", "The receiver is not assigned to this vehicle", { toDriverId: "not_assigned" });
      await this.assertReady(tx, { vehicle: v, driver: to }, new Date(), "toDriverId");

      const id = b.id ?? newId();
      const reading = await this.meter.record(tx, { vehicleId: v.id, value: b.odometer, at, sourceType: "handover", sourceId: id, createdBy: ctx.identityId });
      const [row] = await tx.insert(H).values({ id, vehicleId: v.id, fromDriverId: holder, toDriverId: b.toDriverId, eventAt: at, odometer: b.odometer, readingId: reading.id, notes: b.notes ?? null, createdBy: ctx.identityId }).returning();
      await TenantDb.audit(tx, ctx, "handover.created", "vehicle", v.id, { from: holder, to: b.toDriverId, odometer: b.odometer, readingStatus: reading.status }, null, v.branchId);
      return this.toHandover(tx, row!);
    });
  }

  private async toHandover(db: DbOrTx, h: typeof H.$inferSelect) {
    const [r] = h.readingId ? await db.select({ status: schema.meterReadings.status }).from(schema.meterReadings).where(eq(schema.meterReadings.id, h.readingId)) : [];
    return {
      id: h.id, vehicleId: h.vehicleId, fromDriverId: h.fromDriverId, toDriverId: h.toDriverId, eventAt: h.eventAt.toISOString(),
      odometer: h.odometer, readingStatus: r?.status ?? null, notes: h.notes, createdBy: h.createdBy,
    };
  }

  private custodianAt(db: DbOrTx, vehicleId: string, at: Date) { return custodianAt(db, vehicleId, at); }
  private custody(db: DbOrTx, vehicleId: string, from: Date, to: Date) { return custodySegments(db, vehicleId, from, to); }

  @Requires("assignment.read") @Get(routes.vehicleCustody.path)
  async custodyView(@Param("id", ParseUUIDPipe) id: string, @Query(new ZodPipe(routes.vehicleCustody.query)) q: z.output<typeof routes.vehicleCustody.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const v = await loadVehicle(db, ctx, id);
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(Math.min(v.createdAt.getTime(), to.getTime() - 30 * 86_400_000));
    if (from >= to) throw validation({ from: "after_to" });
    const segs = await this.custody(db, id, from, to);
    return { items: segs.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), driverId: s.driverId, source: s.source })) };
  }

  @Requires("assignment.read") @Get(routes.listHandovers.path)
  async listHandovers(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    await loadVehicle(db, ctx, id);
    const rows = await db.select().from(H).where(eq(H.vehicleId, id)).orderBy(asc(H.eventAt));
    return { items: await Promise.all(rows.map((h) => this.toHandover(db, h))) };
  }
}

