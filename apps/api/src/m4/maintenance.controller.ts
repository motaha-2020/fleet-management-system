import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { routes, type MaintenanceTemplate, type MaintenanceVisit } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, invoiceAllocation, isOpenWorkOrder, localDate } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { companyOf, eventTime, iso, loadVehicle, type DbOrTx } from "../m2/common.js";
import { MeterService } from "../m2/meter.service.js";
import { MaintenanceService } from "./maintenance.service.js";

const T = schema.maintenanceTemplates;
const TI = schema.maintenanceTemplateItems;
const MV = schema.maintenanceVisits;
const MVI = schema.maintenanceVisitItems;
const WO = schema.workOrders;
type VisitRow = typeof MV.$inferSelect;
type VehicleRow = typeof schema.vehicles.$inferSelect;
const CODE = /^[A-Z0-9_]{2,32}$/;

/** E10: maintenance templates (MNT-001/002), per-vehicle due status (MNT-003..005) and visits (MNT-006/007). */
@Controller()
export class MaintenanceController {
  constructor(private readonly tdb: TenantDb, private readonly mnt: MaintenanceService, private readonly meter: MeterService) {}

  // ---------------------------------------------------------------- templates
  private async template(db: DbOrTx, id: string): Promise<MaintenanceTemplate> {
    const [t] = await db.select().from(T).where(eq(T.id, id));
    if (!t) throw notFound("template");
    const items = await db.select().from(TI).where(eq(TI.templateId, id)).orderBy(asc(TI.code));
    return {
      id: t.id, name: t.name, make: t.make, model: t.model, status: t.status,
      items: items.map((i) => ({ id: i.id, code: i.code, name: i.name, intervalKm: i.intervalKm, intervalMonths: i.intervalMonths, safety: i.safety, status: i.status })),
    };
  }

  @Requires("maintenance.read") @Get(routes.listTemplates.path)
  async listTemplates(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const rows = await db.select({ id: T.id }).from(T).orderBy(asc(T.name));
    return { items: await Promise.all(rows.map((r) => this.template(db, r.id))) };
  }

  @Requires("maintenance_template.manage") @Post(routes.createTemplate.path) @HttpCode(201)
  async createTemplate(@Body(new ZodPipe(routes.createTemplate.body)) b: z.output<typeof routes.createTemplate.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const codes = b.items.map((i) => i.code);
    if (new Set(codes).size !== codes.length) throw validation({ items: "duplicate_code" });
    return db.transaction(async (tx) => {
      if (b.id) {
        const [existing] = await tx.select({ id: T.id }).from(T).where(eq(T.id, b.id));
        if (existing) return this.template(tx, existing.id);
      }
      const id = b.id ?? newId();
      await tx.insert(T).values({ id, name: b.name, make: b.make || null, model: b.model || null, createdBy: ctx.identityId });
      await tx.insert(TI).values(b.items.map((i) => ({ id: newId(), templateId: id, code: i.code, name: i.name, intervalKm: i.intervalKm ?? null, intervalMonths: i.intervalMonths ?? null, safety: i.safety })));
      const out = await this.template(tx, id);
      await TenantDb.audit(tx, ctx, "maintenance_template.created", "maintenance_template", id, out);
      return out;
    });
  }

  @Requires("maintenance_template.manage") @Patch(routes.updateTemplate.path)
  async updateTemplate(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateTemplate.body)) b: z.output<typeof routes.updateTemplate.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const before = await this.template(tx, id);
      await tx.update(T).set({ ...(b.name ? { name: b.name } : {}), ...(b.status ? { status: b.status } : {}) }).where(eq(T.id, id));
      await TenantDb.audit(tx, ctx, "maintenance_template.updated", "maintenance_template", id, b, { name: before.name, status: before.status });
      return this.template(tx, id);
    });
  }

  @Requires("maintenance_template.manage") @Post(routes.addTemplateItem.path) @HttpCode(201)
  async addItem(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.addTemplateItem.body)) b: z.output<typeof routes.addTemplateItem.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    try {
      return await db.transaction(async (tx) => {
        await this.template(tx, id);
        const itemId = newId();
        await tx.insert(TI).values({ id: itemId, templateId: id, code: b.code, name: b.name, intervalKm: b.intervalKm ?? null, intervalMonths: b.intervalMonths ?? null, safety: b.safety });
        await TenantDb.audit(tx, ctx, "maintenance_template.item_added", "maintenance_template", id, { itemId, ...b });
        return this.template(tx, id);
      });
    } catch (e) {
      if (uniqueViolation(e)) throw conflict("duplicate_code", "This item code already exists in the template", { code: "duplicate_code" });
      throw e;
    }
  }

  /** MNT-002: an interval change applies to every vehicle on the template (not overridden) from now on. */
  @Requires("maintenance_template.manage") @Patch(routes.updateTemplateItem.path)
  async updateItem(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateTemplateItem.body)) b: z.output<typeof routes.updateTemplateItem.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const [i] = await tx.select().from(TI).where(eq(TI.id, id)).for("update");
      if (!i) throw notFound("template item");
      const next = { km: b.intervalKm !== undefined ? b.intervalKm : i.intervalKm, months: b.intervalMonths !== undefined ? b.intervalMonths : i.intervalMonths };
      if (next.km == null && next.months == null) throw validation({ intervalKm: "interval_required" });
      const changes = {
        ...(b.name !== undefined ? { name: b.name } : {}), ...(b.intervalKm !== undefined ? { intervalKm: b.intervalKm } : {}),
        ...(b.intervalMonths !== undefined ? { intervalMonths: b.intervalMonths } : {}), ...(b.safety !== undefined ? { safety: b.safety } : {}),
        ...(b.status !== undefined ? { status: b.status } : {}),
      };
      if (Object.keys(changes).length) await tx.update(TI).set(changes).where(eq(TI.id, id));
      await TenantDb.audit(tx, ctx, "maintenance_template.item_updated", "maintenance_template", i.templateId, { itemId: id, ...changes },
        { name: i.name, intervalKm: i.intervalKm, intervalMonths: i.intervalMonths, safety: i.safety, status: i.status });
      return this.template(tx, i.templateId);
    });
  }

  // ---------------------------------------------------------------- per vehicle
  private async today(db: DbOrTx) {
    const { company } = await companyOf(db);
    return localDate(new Date(), company.timezone);
  }

  @Requires("maintenance.read") @Get(routes.vehicleMaintenance.path)
  async vehicle(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const v = await loadVehicle(db, ctx, id);
    return this.mnt.forVehicle(db, v, await this.today(db));
  }

  private async item(db: DbOrTx, v: VehicleRow, code: string) {
    const state = await this.mnt.forVehicle(db, v, await this.today(db));
    const item = state.items.find((i) => i.code === code.toUpperCase());
    if (!item) throw notFound("maintenance item");
    return item;
  }

  /** US-E10-01: per-vehicle interval; the template is untouched. */
  @Requires("maintenance.manage") @Post(routes.setMaintenanceOverride.path) @HttpCode(200)
  async setOverride(@Param("id", ParseUUIDPipe) id: string, @Param("code") code: string, @Body(new ZodPipe(routes.setMaintenanceOverride.body)) b: z.output<typeof routes.setMaintenanceOverride.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const v = await loadVehicle(tx, ctx, id, { lock: true });
      const item = await this.item(tx, v, code);
      const O = schema.vehicleMaintenanceOverrides;
      await tx.insert(O).values({ vehicleId: v.id, itemCode: item.code, intervalKm: b.intervalKm, intervalMonths: b.intervalMonths, updatedBy: ctx.identityId })
        .onConflictDoUpdate({ target: [O.vehicleId, O.itemCode], set: { intervalKm: b.intervalKm, intervalMonths: b.intervalMonths, updatedBy: ctx.identityId, updatedAt: new Date() } });
      await TenantDb.audit(tx, ctx, "maintenance.override_set", "vehicle", v.id, { code: item.code, ...b }, { intervalKm: item.intervalKm, intervalMonths: item.intervalMonths }, v.branchId);
      return this.mnt.forVehicle(tx, v, await this.today(tx));
    });
  }

  /** MNT-004: opening baseline for a vehicle with no visit yet (or a correction of the last one). */
  @Requires("maintenance.manage") @Post(routes.setMaintenanceBaseline.path) @HttpCode(200)
  async setBaseline(@Param("id", ParseUUIDPipe) id: string, @Param("code") code: string, @Body(new ZodPipe(routes.setMaintenanceBaseline.body)) b: z.output<typeof routes.setMaintenanceBaseline.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const v = await loadVehicle(tx, ctx, id, { lock: true });
      const item = await this.item(tx, v, code);
      if (b.doneOn > (await this.today(tx))) throw validation({ doneOn: "future_not_allowed" });
      const B = schema.maintenanceBaselines;
      const values = { doneOn: b.doneOn, odometer: b.odometer, readingId: null, sourceType: "opening" as const, sourceId: null, updatedBy: ctx.identityId, updatedAt: new Date() };
      await tx.insert(B).values({ vehicleId: v.id, itemCode: item.code, ...values }).onConflictDoUpdate({ target: [B.vehicleId, B.itemCode], set: values });
      await TenantDb.audit(tx, ctx, "maintenance.baseline_set", "vehicle", v.id, { code: item.code, ...b }, item.baseline, v.branchId);
      return this.mnt.forVehicle(tx, v, await this.today(tx));
    });
  }

  /** US-E10-02/03: items not OK across vehicles in scope, most urgent first. */
  @Requires("maintenance.read") @Get(routes.maintenanceDue.path)
  async due(@Query(new ZodPipe(routes.maintenanceDue.query)) q: z.output<typeof routes.maintenanceDue.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const where: SQL[] = [eq(schema.vehicles.status, "active")];
    if (filter) where.push(inArray(schema.vehicles.branchId, [...filter]));
    const vehicles = await db.select().from(schema.vehicles).where(and(...where));
    const states = await this.mnt.evaluate(db, vehicles, await this.today(db));
    const rank = { overdue: 0, due: 1, upcoming: 2, unknown_baseline: 3, ok: 4 } as const;
    const rows = vehicles.flatMap((v) => (states.get(v.id)?.items ?? [])
      .filter((i) => (q.status ? i.due.status === q.status : i.due.status !== "ok"))
      .map((i) => ({ vehicleId: v.id, fleetNumber: v.fleetNumber, branchId: v.branchId, code: i.code, name: i.name, safety: i.safety, due: i.due })));
    rows.sort((a, b) => rank[a.due.status] - rank[b.due.status] || (a.due.remainingDays ?? 1e9) - (b.due.remainingDays ?? 1e9));
    return { items: rows };
  }

  // ---------------------------------------------------------------- visits (MNT-006/007)
  private async toVisit(db: DbOrTx, m: VisitRow): Promise<MaintenanceVisit> {
    const items = await db.select().from(MVI).where(eq(MVI.visitId, m.id));
    const [r] = m.readingId ? await db.select({ status: schema.meterReadings.status }).from(schema.meterReadings).where(eq(schema.meterReadings.id, m.readingId)) : [];
    const [cost] = await db.select({ id: schema.costRecords.id }).from(schema.costRecords)
      .where(and(eq(schema.costRecords.sourceType, "maintenance"), eq(schema.costRecords.sourceId, m.id), eq(schema.costRecords.status, "active")));
    const alloc = m.grossMinor != null ? invoiceAllocation(m.grossMinor, m.partsMinor, m.laborMinor, m.otherMinor) : null;
    return {
      id: m.id, vehicleId: m.vehicleId, branchId: m.branchId, workOrderId: m.workOrderId, vendorId: m.vendorId, type: m.type, visitDate: m.visitDate,
      odometer: m.odometer, readingStatus: r?.status ?? null, netMinor: m.netMinor, taxMinor: m.taxMinor, grossMinor: m.grossMinor, currency: m.currency,
      partsMinor: m.partsMinor, laborMinor: m.laborMinor, otherMinor: m.otherMinor, unallocatedMinor: alloc?.ok ? alloc.unallocated : null,
      invoiceRef: m.invoiceRef, notes: m.notes, items: items.map((i) => i.itemCode).sort(), status: m.status, completedAt: iso(m.completedAt), costId: cost?.id ?? null,
      createdBy: m.createdBy,
    };
  }

  @Requires("maintenance.read") @Get(routes.listVisits.path)
  async listVisits(@Query(new ZodPipe(routes.listVisits.query)) q: z.output<typeof routes.listVisits.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const where: SQL[] = [];
    if (filter) where.push(inArray(MV.branchId, [...filter]));
    if (q.vehicleId) where.push(eq(MV.vehicleId, q.vehicleId));
    if (q.workOrderId) where.push(eq(MV.workOrderId, q.workOrderId));
    const rows = await db.select().from(MV).where(and(...where)).orderBy(desc(MV.visitDate), desc(MV.createdAt)).limit(500);
    return { items: await Promise.all(rows.map((m) => this.toVisit(db, m))) };
  }

  @Requires("maintenance.manage") @Post(routes.createVisit.path)
  async createVisit(@Body(new ZodPipe(routes.createVisit.body)) b: z.output<typeof routes.createVisit.body>, @Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    const db = await this.tdb.for(ctx);
    const { country } = await companyOf(db);
    return db.transaction(async (tx) => {
      if (b.id) {
        const [existing] = await tx.select().from(MV).where(eq(MV.id, b.id));
        if (existing) { res.status(200); return this.toVisit(tx, existing); }
      }
      const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true });
      if (b.visitDate > (await this.today(tx))) throw validation({ visitDate: "future_not_allowed" });
      if (b.workOrderId) {
        const [wo] = await tx.select().from(WO).where(eq(WO.id, b.workOrderId));
        if (!wo || wo.vehicleId !== v.id) throw validation({ workOrderId: "unknown_work_order" });
        if (!isOpenWorkOrder(wo.status)) throw conflict("work_order_closed", "The work order is closed or cancelled");
      }
      if (b.vendorId) {
        const [vendor] = await tx.select({ id: schema.vendors.id }).from(schema.vendors).where(eq(schema.vendors.id, b.vendorId));
        if (!vendor) throw validation({ vendorId: "unknown_vendor" });
      }
      const state = await this.mnt.forVehicle(tx, v, await this.today(tx));
      const codes = [...new Set(b.items)];
      const unknown = codes.find((c) => !state.items.some((i) => i.code === c));
      if (unknown) throw validation({ items: `unknown_item:${unknown}` });
      if (b.netMinor != null) {
        const alloc = invoiceAllocation(b.netMinor + b.taxMinor, b.partsMinor ?? null, b.laborMinor ?? null, b.otherMinor ?? null);
        if (!alloc.ok) throw validation({ partsMinor: "breakdown_exceeds_total" });
      } else if (b.partsMinor != null || b.laborMinor != null || b.otherMinor != null) {
        throw validation({ netMinor: "invoice_required" });
      }
      const id = b.id ?? newId();
      const [row] = await tx.insert(MV).values({
        id, vehicleId: v.id, branchId: v.branchId, workOrderId: b.workOrderId ?? null, vendorId: b.vendorId ?? null, type: b.type, visitDate: b.visitDate,
        odometer: b.odometer ?? null, netMinor: b.netMinor ?? null, taxMinor: b.taxMinor, currency: country.currency, partsMinor: b.partsMinor ?? null,
        laborMinor: b.laborMinor ?? null, otherMinor: b.otherMinor ?? null, invoiceRef: b.invoiceRef ?? null, notes: b.notes ?? null, createdBy: ctx.identityId,
      }).returning();
      if (codes.length) await tx.insert(MVI).values(codes.map((c) => ({ visitId: id, itemCode: c })));
      await TenantDb.audit(tx, ctx, "maintenance_visit.created", "maintenance_visit", id, { type: b.type, visitDate: b.visitDate, items: codes }, null, v.branchId);
      res.status(201);
      if (b.complete) return this.toVisit(tx, await this.complete(tx, ctx, row!, v));
      return this.toVisit(tx, row!);
    });
  }

  @Requires("maintenance.manage") @Post(routes.completeVisit.path) @HttpCode(200)
  async completeVisit(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const [m] = await tx.select().from(MV).where(eq(MV.id, id)).for("update");
      if (!m) throw notFound("visit");
      const v = await loadVehicle(tx, ctx, m.vehicleId, { lock: true });
      if (m.status === "completed") return this.toVisit(tx, m);
      return this.toVisit(tx, await this.complete(tx, ctx, m, v));
    });
  }

  /**
   * Completing a visit (MNT-006/007, US-E10-06/07): the invoice total is required and becomes one cost record
   * (counted once; the breakdown is informative), the odometer goes through the ledger, and the performed items
   * get a new baseline — only when this visit is later than the current one.
   */
  private async complete(tx: Tx, ctx: RequestContext, m: VisitRow, v: VehicleRow): Promise<VisitRow> {
    if (m.status !== "draft") throw conflict("invalid_transition", `A ${m.status} visit cannot be completed`);
    if (m.netMinor == null) throw validation({ netMinor: "invoice_required" });
    if (m.odometer == null) throw validation({ odometer: "odometer_required" });
    const { country, company } = await companyOf(tx);
    const today = localDate(new Date(), company.timezone);
    const at = m.visitDate === today ? new Date() : new Date(`${m.visitDate}T12:00:00Z`);
    eventTime(at.toISOString(), v, "visitDate");
    const reading = await this.meter.record(tx, { vehicleId: v.id, value: m.odometer, at, sourceType: "maintenance", sourceId: m.id, createdBy: ctx.identityId });
    const costId = newId();
    await tx.insert(schema.costRecords).values({
      id: costId, category: m.type, vehicleId: v.id, branchId: v.branchId, vendorId: m.vendorId, netMinor: m.netMinor, taxMinor: m.taxMinor,
      currency: m.currency, taxRecoverable: country.taxRecoverable[m.type], expenseDate: m.visitDate, sourceType: "maintenance", sourceId: m.id,
      description: m.invoiceRef ? `Invoice ${m.invoiceRef}` : null, flags: [], createdBy: ctx.identityId,
    });
    const items = await tx.select().from(MVI).where(eq(MVI.visitId, m.id));
    const B = schema.maintenanceBaselines;
    for (const i of items) {
      const [cur] = await tx.select().from(B).where(and(eq(B.vehicleId, v.id), eq(B.itemCode, i.itemCode)));
      if (cur && cur.doneOn > m.visitDate) continue;
      const values = { doneOn: m.visitDate, odometer: m.odometer, readingId: reading.id, sourceType: "visit" as const, sourceId: m.id, updatedBy: ctx.identityId, updatedAt: new Date() };
      await tx.insert(B).values({ vehicleId: v.id, itemCode: i.itemCode, ...values }).onConflictDoUpdate({ target: [B.vehicleId, B.itemCode], set: values });
    }
    const [row] = await tx.update(MV).set({ status: "completed", completedAt: new Date(), readingId: reading.id }).where(eq(MV.id, m.id)).returning();
    await TenantDb.audit(tx, ctx, "maintenance_visit.completed", "maintenance_visit", m.id,
      { grossMinor: row!.grossMinor, costId, readingStatus: reading.status, items: items.map((i) => i.itemCode) }, { status: m.status }, v.branchId);
    return row!;
  }
}
