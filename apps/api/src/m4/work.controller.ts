import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { and, desc, eq, inArray, notInArray, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { routes, type WorkOrder } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, canTransitionDefect, canTransitionWorkOrder, downtimeMs, type DefectStatus } from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, notFound, validation } from "../infra/errors.js";
import { STORAGE } from "../infra/tokens.js";
import { TenantKeys } from "../infra/tenant-keys.js";
import { decryptFile, type ObjectStorage } from "../files/storage.js";
import { readCapped } from "../files/read-capped.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { eventTime, iso, loadVehicle, vehicleInScope, type DbOrTx } from "../m2/common.js";
import { DefectService, toDefect, type DefectRow } from "./defect.service.js";
import { AlertService } from "../m5/alert.service.js";
import { enqueueAlertScan } from "../m5/jobs.js";
import { QUEUE } from "../infra/tokens.js";
import type { JobQueue } from "../infra/infra.module.js";

const D = schema.defects;
const WO = schema.workOrders;
type WoRow = typeof WO.$inferSelect;

/** E10 defects (WO-001/002) and work orders (WO-003..006). */
@Controller()
export class WorkController {
  constructor(
    private readonly tdb: TenantDb, private readonly defects: DefectService, private readonly keys: TenantKeys,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly alerts: AlertService,
    @Inject(QUEUE) private readonly queue: JobQueue,
  ) {}

  // ---------------------------------------------------------------- defects
  private async defectInScope(db: DbOrTx, ctx: RequestContext, id: string, lock = false): Promise<DefectRow> {
    const q = db.select().from(D).where(eq(D.id, id));
    const [d] = lock ? await q.for("update") : await q;
    if (!d) throw notFound("defect");
    if (ctx.role === "driver") {
      if (d.createdBy !== ctx.identityId) throw notFound("defect");
      return d;
    }
    const [v] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, d.vehicleId));
    if (!v || !(await vehicleInScope(db, ctx, v))) throw notFound("defect");
    return d;
  }

  @Requires("maintenance.read") @Get(routes.listDefects.path)
  async listDefects(@Query(new ZodPipe(routes.listDefects.query)) q: z.output<typeof routes.listDefects.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const where: SQL[] = [];
    if (filter) where.push(inArray(D.branchId, [...filter]));
    if (q.status === "open") where.push(inArray(D.status, ["reported", "triaged"]));
    else if (q.status) where.push(eq(D.status, q.status));
    if (q.vehicleId) where.push(eq(D.vehicleId, q.vehicleId));
    const rows = await db.select().from(D).where(and(...where)).orderBy(desc(D.reportedAt)).limit(500);
    return { items: rows.map(toDefect) };
  }

  /** WO-001 / US-E10-04: drivers report on vehicles they hold (or of their branch); a report is never rejected for rules. */
  @Requires("defect.report") @Post(routes.createDefect.path)
  async createDefect(@Body(new ZodPipe(routes.createDefect.body)) b: z.output<typeof routes.createDefect.body>, @Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    const db = await this.tdb.for(ctx);
    const r = await db.transaction(async (tx) => {
      const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true, allowUnassigned: true });
      return this.defects.create(tx, ctx, v, b, eventTime(undefined, v));
    });
    // US-E10-04: the fleet manager is alerted without waiting for the daily scan.
    if (r.created) await enqueueAlertScan(this.queue, tenantOf(ctx));
    res.status(r.created ? 201 : 200);
    return toDefect(r.row);
  }

  @Requires("defect.report") @Post(routes.uploadDefectPhoto.path) @HttpCode(200)
  async uploadPhoto(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request, @Ctx() ctx: RequestContext) {
    const bytes = await readCapped(req, DEFAULTS.FILE_DOC_MAX_BYTES);
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => toDefect(await this.defects.attachPhoto(tx, ctx, await this.defectInScope(tx, ctx, id, true), bytes)));
  }

  @Requires("maintenance.read") @Get(routes.downloadDefectPhoto.path)
  async downloadPhoto(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext, @Res() res: Response) {
    const db = await this.tdb.for(ctx);
    const d = await this.defectInScope(db, ctx, id);
    if (!d.photoFileKey || !d.photoMime) throw notFound("photo");
    const plain = decryptFile((await this.keys.for(tenantOf(ctx))).fileKey, await this.storage.get(d.photoFileKey));
    await TenantDb.audit(db, ctx, "defect.photo_downloaded", "defect", id, null, null, d.branchId);
    res.setHeader("content-type", d.photoMime);
    res.setHeader("content-disposition", `attachment; filename="defect-${id}"`);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "private, no-store");
    res.end(plain);
  }

  private async decide(ctx: RequestContext, id: string, to: DefectStatus, extra: Partial<typeof D.$inferInsert>, check?: (tx: Tx, d: DefectRow) => Promise<void>, after?: (tx: Tx, d: DefectRow) => Promise<void>) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const d = await this.defectInScope(tx, ctx, id, true);
      if (!canTransitionDefect(d.status, to)) throw conflict("invalid_transition", `A ${d.status} defect cannot become ${to}`);
      await check?.(tx, d);
      const [row] = await tx.update(D).set({ status: to, decidedBy: ctx.identityId, decidedAt: new Date(), ...extra }).where(eq(D.id, id)).returning();
      await TenantDb.audit(tx, ctx, `defect.${to}`, "defect", id, { status: to, ...extra }, { status: d.status }, d.branchId);
      await after?.(tx, d);
      return toDefect(row!);
    });
  }

  /** WO-002: triage = reviewed; a not-drivable report stops restricting the vehicle (it becomes a work-order decision). */
  @Requires("defect.triage") @Post(routes.triageDefect.path) @HttpCode(200)
  triage(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    return this.decide(ctx, id, "triaged", {});
  }

  @Requires("defect.triage") @Post(routes.rejectDefect.path) @HttpCode(200)
  reject(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.rejectDefect.body)) b: z.output<typeof routes.rejectDefect.body>, @Ctx() ctx: RequestContext) {
    // US-E10-04: the reporter is told, with the reason.
    return this.decide(ctx, id, "rejected", { decisionReason: b.reason }, undefined, async (tx, d) => {
      if (d.createdBy === ctx.identityId) return;
      const [v] = await tx.select({ f: schema.vehicles.fleetNumber, r: schema.vehicles.registrationNumber }).from(schema.vehicles).where(eq(schema.vehicles.id, d.vehicleId));
      await this.alerts.raise(tx, tenantOf(ctx), {
        type: "defect_rejected", entityType: "defect", entityId: d.id, branchId: d.branchId, ownerId: d.createdBy,
        params: { label: v ? `${v.f} · ${v.r}` : undefined, description: d.description.slice(0, 140), reason: b.reason },
      });
    });
  }

  @Requires("defect.triage") @Post(routes.duplicateDefect.path) @HttpCode(200)
  duplicate(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.duplicateDefect.body)) b: z.output<typeof routes.duplicateDefect.body>, @Ctx() ctx: RequestContext) {
    return this.decide(ctx, id, "duplicate", { decisionReason: b.reason, duplicateOf: b.duplicateOf }, async (tx, d) => {
      if (b.duplicateOf === d.id) throw validation({ duplicateOf: "self" });
      const [orig] = await tx.select({ vehicleId: D.vehicleId }).from(D).where(eq(D.id, b.duplicateOf));
      if (!orig || orig.vehicleId !== d.vehicleId) throw validation({ duplicateOf: "unknown_defect" });
    });
  }

  /** WO-002 / US-E10-05: one defect → one work order; not-drivable puts the vehicle off the road from now. */
  @Requires("defect.triage") @Post(routes.convertDefect.path) @HttpCode(201)
  async convert(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.convertDefect.body)) b: z.output<typeof routes.convertDefect.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const d = await this.defectInScope(tx, ctx, id, true);
      if (!canTransitionDefect(d.status, "converted")) throw conflict("invalid_transition", `A ${d.status} defect cannot be converted`);
      const v = await loadVehicle(tx, ctx, d.vehicleId, { lock: true });
      const wo = await this.insertWorkOrder(tx, ctx, v, { type: b.type, title: b.title, notDrivable: b.notDrivable, scheduledFor: b.scheduledFor ?? null, vendorId: b.vendorId ?? null, defectId: d.id });
      await tx.update(D).set({ status: "converted", workOrderId: wo.id, decidedBy: ctx.identityId, decidedAt: new Date() }).where(eq(D.id, d.id));
      await TenantDb.audit(tx, ctx, "defect.converted", "defect", d.id, { workOrderId: wo.id }, { status: d.status }, d.branchId);
      return this.toWorkOrder(tx, wo);
    });
  }

  // ---------------------------------------------------------------- work orders
  private async toWorkOrder(db: DbOrTx, w: WoRow): Promise<WorkOrder> {
    const [visit] = await db.select({ id: schema.maintenanceVisits.id }).from(schema.maintenanceVisits)
      .where(and(eq(schema.maintenanceVisits.workOrderId, w.id), eq(schema.maintenanceVisits.status, "completed"))).limit(1);
    const ms = downtimeMs(w.offRoadAt?.getTime() ?? null, w.returnToServiceAt?.getTime() ?? null, Date.now());
    return {
      id: w.id, vehicleId: w.vehicleId, branchId: w.branchId, defectId: w.defectId, type: w.type, title: w.title, notDrivable: w.notDrivable, status: w.status,
      scheduledFor: w.scheduledFor, vendorId: w.vendorId, offRoadAt: iso(w.offRoadAt), returnToServiceAt: iso(w.returnToServiceAt),
      downtimeHours: w.offRoadAt ? Math.round((ms / 3_600_000) * 10) / 10 : null, closeReason: w.closeReason, hasCompletedVisit: !!visit,
      createdBy: w.createdBy, createdAt: w.createdAt.toISOString(),
    };
  }

  private async insertWorkOrder(
    tx: Tx, ctx: RequestContext, v: typeof schema.vehicles.$inferSelect,
    b: { id?: string; type: WoRow["type"]; title: string; notDrivable: boolean; scheduledFor: string | null; vendorId: string | null; defectId: string | null; offRoadAt?: Date },
  ) {
    if (v.status === "disposed") throw conflict("vehicle_disposed", "The vehicle is disposed");
    if (b.vendorId) {
      const [vendor] = await tx.select({ id: schema.vendors.id }).from(schema.vendors).where(eq(schema.vendors.id, b.vendorId));
      if (!vendor) throw validation({ vendorId: "unknown_vendor" });
    }
    const [row] = await tx.insert(WO).values({
      id: b.id ?? newId(), vehicleId: v.id, branchId: v.branchId, defectId: b.defectId, type: b.type, title: b.title, notDrivable: b.notDrivable,
      status: b.scheduledFor ? "scheduled" : "open", scheduledFor: b.scheduledFor, vendorId: b.vendorId,
      offRoadAt: b.notDrivable ? (b.offRoadAt ?? new Date()) : null, createdBy: ctx.identityId,
    }).returning();
    await TenantDb.audit(tx, ctx, "work_order.created", "work_order", row!.id, { type: b.type, title: b.title, notDrivable: b.notDrivable, defectId: b.defectId }, null, v.branchId);
    return row!;
  }

  @Requires("maintenance.read") @Get(routes.listWorkOrders.path)
  async listWorkOrders(@Query(new ZodPipe(routes.listWorkOrders.query)) q: z.output<typeof routes.listWorkOrders.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const where: SQL[] = [];
    if (filter) where.push(inArray(WO.branchId, [...filter]));
    if (q.status === "active") where.push(notInArray(WO.status, ["closed", "cancelled"]));
    else if (q.status) where.push(eq(WO.status, q.status));
    if (q.vehicleId) where.push(eq(WO.vehicleId, q.vehicleId));
    const rows = await db.select().from(WO).where(and(...where)).orderBy(desc(WO.createdAt)).limit(500);
    return { items: await Promise.all(rows.map((w) => this.toWorkOrder(db, w))) };
  }

  @Requires("maintenance.manage") @Post(routes.createWorkOrder.path)
  async createWorkOrder(@Body(new ZodPipe(routes.createWorkOrder.body)) b: z.output<typeof routes.createWorkOrder.body>, @Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      if (b.id) {
        const [existing] = await tx.select().from(WO).where(eq(WO.id, b.id));
        if (existing) { res.status(200); return this.toWorkOrder(tx, existing); }
      }
      const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true });
      const offRoadAt = b.offRoadAt ? eventTime(b.offRoadAt, v, "offRoadAt") : undefined;
      const row = await this.insertWorkOrder(tx, ctx, v, { id: b.id, type: b.type, title: b.title, notDrivable: b.notDrivable, scheduledFor: b.scheduledFor ?? null, vendorId: b.vendorId ?? null, defectId: null, offRoadAt });
      res.status(201);
      return this.toWorkOrder(tx, row);
    });
  }

  /**
   * WO-003 lifecycle. Completed = back in service (ends downtime and the not-drivable restriction, WO-005).
   * Closing needs a completed visit or a reason (WO-006); cancelling needs a reason.
   */
  @Requires("maintenance.manage") @Post(routes.workOrderStatus.path) @HttpCode(200)
  async status(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.workOrderStatus.body)) b: z.output<typeof routes.workOrderStatus.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const [w] = await tx.select().from(WO).where(eq(WO.id, id)).for("update");
      if (!w) throw notFound("work order");
      const v = await loadVehicle(tx, ctx, w.vehicleId, { lock: true });
      if (!canTransitionWorkOrder(w.status, b.status)) throw conflict("invalid_transition", `A ${w.status} work order cannot become ${b.status}`);
      const set: Partial<typeof WO.$inferInsert> = { status: b.status, updatedAt: new Date() };
      if (b.status === "scheduled") {
        if (!b.scheduledFor && !w.scheduledFor) throw validation({ scheduledFor: "required" });
        if (b.scheduledFor) set.scheduledFor = b.scheduledFor;
      }
      if (b.status === "completed" && w.offRoadAt) set.returnToServiceAt = new Date();
      if (b.status === "cancelled") {
        if (!b.reason) throw validation({ reason: "required" });
        set.closeReason = b.reason;
        if (w.offRoadAt && !w.returnToServiceAt) set.returnToServiceAt = new Date();
      }
      if (b.status === "closed") {
        const [visit] = await tx.select({ id: schema.maintenanceVisits.id }).from(schema.maintenanceVisits)
          .where(and(eq(schema.maintenanceVisits.workOrderId, w.id), eq(schema.maintenanceVisits.status, "completed"))).limit(1);
        if (!visit && !b.reason) throw validation({ reason: "visit_or_reason_required" });
        if (b.reason) set.closeReason = b.reason;
      }
      const [row] = await tx.update(WO).set(set).where(eq(WO.id, id)).returning();
      await TenantDb.audit(tx, ctx, `work_order.${b.status}`, "work_order", id, { status: b.status, reason: b.reason ?? null }, { status: w.status }, v.branchId);
      return this.toWorkOrder(tx, row!);
    });
  }
}
