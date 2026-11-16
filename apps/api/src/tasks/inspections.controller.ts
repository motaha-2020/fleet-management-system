import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { routes, type Inspection } from "@fleet/contracts";
import { INSPECTION_ITEMS, INSPECTION_CODES } from "@fleet/config";
import { schema, newId } from "@fleet/db";
import { branchFilter, localDate } from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { validation } from "../infra/errors.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { MeterService } from "../m2/meter.service.js";
import { companyOf, eventTime, loadVehicle } from "../m2/common.js";
import { policiesFor } from "../m2/policies.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { AlertService } from "../m5/alert.service.js";

const I = schema.inspections;
type Row = typeof I.$inferSelect;
const DAY = 86_400_000;
const CRITICAL = new Set<string>(INSPECTION_ITEMS.filter((i) => i.critical).map((i) => i.code));

export const toInspection = (r: Row): Inspection => ({
  id: r.id, vehicleId: r.vehicleId, branchId: r.branchId, driverId: r.driverId, inspectedAt: r.inspectedAt.toISOString(), odometer: r.odometer,
  items: r.items.map((i) => ({ code: i.code, ok: i.ok, note: i.note ?? null })), failed: r.failed, notes: r.notes, status: r.status,
  decisionReason: r.decisionReason, createdBy: r.createdBy,
});

/**
 * Owner decision (14 Nov 2026): vehicle inspections — a checklist the driver (or the office) fills in; how often
 * each vehicle is inspected is a company policy (inspection_every_days); an inspection counts once approved.
 * Failed critical items alert the fleet manager at once.
 */
@Controller()
export class InspectionsController {
  constructor(private readonly tdb: TenantDb, private readonly meter: MeterService, private readonly approvals: ApprovalService, private readonly alerts: AlertService) {}

  @Requires("inspection.read", "inspection.create") @Get(routes.inspectionsDue.path)
  async due(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const { company } = await companyOf(db);
    const every = (await policiesFor(db, new Date())).inspection_every_days;
    const filter = branchFilter(ctx, ctx.scope!);
    const vehicles = (await db.select().from(schema.vehicles).where(eq(schema.vehicles.status, "active"))).filter((v) => !filter || filter.includes(v.branchId));
    const done = await db.select({ vehicleId: I.vehicleId, at: I.inspectedAt }).from(I).where(eq(I.status, "approved")).orderBy(desc(I.inspectedAt));
    const today = localDate(new Date(), company.timezone);
    return {
      items: vehicles.map((v) => {
        const last = done.find((d) => d.vehicleId === v.id)?.at ?? null;
        const dueOn = last ? localDate(new Date(last.getTime() + every * DAY), company.timezone) : null;
        return { vehicleId: v.id, label: `${v.fleetNumber} · ${v.registrationNumber}`, branchId: v.branchId, lastAt: last?.toISOString() ?? null, dueOn, overdue: !dueOn || dueOn <= today, everyDays: every };
      }).sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "")),
    };
  }

  @Requires("inspection.read", "inspection.create") @Get(routes.listInspections.path)
  async list(@Query(new ZodPipe(routes.listInspections.query)) q: z.output<typeof routes.listInspections.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const where = [];
    if (q.vehicleId) where.push(eq(I.vehicleId, q.vehicleId));
    if (q.status) where.push(eq(I.status, q.status));
    if (ctx.role === "driver") where.push(eq(I.createdBy, ctx.identityId));
    const filter = ctx.role === "driver" ? null : branchFilter(ctx, ctx.scope!);
    const rows = (await db.select().from(I).where(and(...where)).orderBy(desc(I.inspectedAt)).limit(500)).filter((r) => !filter || filter.includes(r.branchId));
    return { items: rows.map(toInspection) };
  }

  @Requires("inspection.create") @Post(routes.createInspection.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createInspection.body)) b: z.output<typeof routes.createInspection.body>, @Ctx() ctx: RequestContext) {
    const codes = new Set(b.items.map((i) => i.code));
    if (codes.size !== b.items.length) throw validation({ items: "duplicate_item" });
    const unknown = b.items.find((i) => !(INSPECTION_CODES as readonly string[]).includes(i.code));
    if (unknown) throw validation({ items: `unknown_item:${unknown.code}` });
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      if (b.id) {
        const [existing] = await tx.select().from(I).where(eq(I.id, b.id));
        if (existing) return toInspection(existing);
      }
      const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true, allowUnassigned: ctx.role !== "driver" });
      const at = eventTime(b.at, v);
      const pending = await this.approvals.needsApproval(tx, ctx, "inspection");
      const id = b.id ?? newId();
      const reading = b.odometer != null
        ? await this.meter.record(tx, { vehicleId: v.id, value: b.odometer, at, sourceType: "inspection", sourceId: id, createdBy: ctx.identityId, pending })
        : null;
      const items = b.items.map((i) => ({ code: i.code, ok: i.ok, note: i.note ?? null }));
      const failed = items.filter((i) => !i.ok);
      const [row] = await tx.insert(I).values({
        id, vehicleId: v.id, branchId: v.branchId, driverId: ctx.role === "driver" ? ctx.driverId ?? null : null, inspectedAt: at,
        odometer: b.odometer ?? null, readingId: reading?.id ?? null, items, failed: failed.length, notes: b.notes ?? null,
        status: pending ? "pending" : "approved", createdBy: ctx.identityId,
      }).returning();
      await TenantDb.audit(tx, ctx, "inspection.recorded", "vehicle", v.id, { inspectionId: id, failed: failed.map((i) => i.code), status: row!.status }, null, v.branchId);
      if (failed.some((i) => CRITICAL.has(i.code))) {
        await this.alerts.raiseToRole(tx, tenantOf(ctx), {
          type: "inspection_failed", entityType: "vehicle", entityId: v.id, branchId: v.branchId,
          params: { label: `${v.fleetNumber} · ${v.registrationNumber}`, description: failed.map((i) => i.code).join(", ") },
        });
      }
      return toInspection(row!);
    });
  }
}
