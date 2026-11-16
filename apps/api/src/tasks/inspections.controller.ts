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
import { InspectionsService, toInspection } from "./inspections.service.js";

const I = schema.inspections;
type Row = typeof I.$inferSelect;
const DAY = 86_400_000;


/**
 * Owner decision (14 Nov 2026): vehicle inspections — a checklist the driver (or the office) fills in; how often
 * each vehicle is inspected is a company policy (inspection_every_days); an inspection counts once approved.
 * Failed critical items alert the fleet manager at once.
 */
@Controller()
export class InspectionsController {
  constructor(private readonly tdb: TenantDb, private readonly inspections: InspectionsService) {}

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
    const db = await this.tdb.for(ctx);
    return db.transaction((tx) => this.inspections.create(tx, ctx, b));
  }

}
