import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lte, ne, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { routes, type CostRecord } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, canAccessBranch, costPerKm, reportedCost, validDistance } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { companyOf, loadVehicle } from "./common.js";
import { MeterService } from "./meter.service.js";
import { branchPeriod } from "./zoned.js";

const C = schema.costRecords;
type Row = typeof C.$inferSelect;

export const toCost = (c: Row): CostRecord => {
  const gross = c.grossMinor ?? c.netMinor + c.taxMinor;
  return {
    id: c.id, category: c.category, vehicleId: c.vehicleId, branchId: c.branchId, vendorId: c.vendorId, netMinor: c.netMinor, taxMinor: c.taxMinor,
    grossMinor: gross, currency: c.currency, taxRecoverable: c.taxRecoverable, reportedMinor: reportedCost({ netMinor: c.netMinor, grossMinor: gross }, c.taxRecoverable),
    expenseDate: c.expenseDate, sourceType: c.sourceType, sourceId: c.sourceId, eInvoiceUuid: c.eInvoiceUuid, description: c.description,
    status: c.status, flags: c.flags, createdAt: c.createdAt.toISOString(),
  };
};

/** Start of a calendar date in a time zone, as an instant (branch/company reporting days, GEN-010). */
export { zonedStart } from "./zoned.js";

/** E15: recorded costs (Expense Date view), one expense identity per source, cost/km over valid distance. */
@Controller()
export class CostsController {
  constructor(private readonly tdb: TenantDb, private readonly meter: MeterService) {}

  private scope(ctx: RequestContext): SQL | undefined | null {
    const filter = branchFilter(ctx, ctx.scope!);
    if (!filter) return undefined;
    return filter.length ? inArray(C.branchId, [...filter]) : null;
  }

  @Requires("cost.read") @Get(routes.listCosts.path)
  async list(@Query(new ZodPipe(routes.listCosts.query)) q: z.output<typeof routes.listCosts.query>, @Ctx() ctx: RequestContext) {
    const scope = this.scope(ctx);
    if (scope === null) return { items: [] };
    const where: SQL[] = scope ? [scope] : [];
    if (q.vehicleId) where.push(eq(C.vehicleId, q.vehicleId));
    if (q.category) where.push(eq(C.category, q.category));
    if (q.from) where.push(gte(C.expenseDate, q.from));
    if (q.to) where.push(lte(C.expenseDate, q.to));
    if (q.includeVoided !== "true") where.push(eq(C.status, "active"));
    const db = await this.tdb.for(ctx);
    const rows = await db.select().from(C).where(and(...where)).orderBy(desc(C.expenseDate), desc(C.createdAt)).limit(1000);
    return { items: rows.map(toCost) };
  }

  /** US-E15-01/05. Fuel costs come only from fuel entries (FIN-003), so no manual "fuel" category. */
  @Requires("cost.write") @Post(routes.createCost.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createCost.body)) b: z.output<typeof routes.createCost.body>, @Ctx() ctx: RequestContext) {
    if (b.category === "fuel") throw validation({ category: "use_fuel_entries" });
    const db = await this.tdb.for(ctx);
    const { country } = await companyOf(db);
    return db.transaction(async (tx) => {
      if (b.id) {
        const [existing] = await tx.select().from(C).where(eq(C.id, b.id));
        if (existing) return toCost(existing);
      }
      let branchId: string;
      if (b.vehicleId) {
        const v = await loadVehicle(tx, ctx, b.vehicleId);
        if (v.status === "disposed" && v.disposedAt && b.expenseDate > v.disposedAt) throw validation({ expenseDate: "after_disposal" });
        branchId = v.branchId;
      } else {
        if (!b.branchId) throw validation({ branchId: "required" });
        if (!canAccessBranch(ctx, ctx.scope!, b.branchId)) throw forbidden("You can only record costs for your branches");
        const [br] = await tx.select({ id: schema.branches.id }).from(schema.branches).where(eq(schema.branches.id, b.branchId));
        if (!br) throw validation({ branchId: "unknown_branch" });
        branchId = b.branchId;
      }
      if (b.vendorId) {
        const [vendor] = await tx.select({ id: schema.vendors.id }).from(schema.vendors).where(eq(schema.vendors.id, b.vendorId));
        if (!vendor) throw validation({ vendorId: "unknown_vendor" });
      }
      // FIN-012: the same e-invoice UUID twice is a possible duplicate (flagged, not rejected).
      const flags: string[] = [];
      if (b.eInvoiceUuid) {
        const [dup] = await tx.select({ id: C.id }).from(C).where(and(eq(C.eInvoiceUuid, b.eInvoiceUuid), eq(C.status, "active"))).limit(1);
        if (dup) flags.push("possible_duplicate");
      }
      const [row] = await tx.insert(C).values({
        id: b.id ?? newId(), category: b.category, vehicleId: b.vehicleId ?? null, branchId, vendorId: b.vendorId ?? null,
        netMinor: b.netMinor, taxMinor: b.taxMinor, currency: country.currency, taxRecoverable: country.taxRecoverable[b.category],
        expenseDate: b.expenseDate, sourceType: "manual", sourceId: null, eInvoiceUuid: b.eInvoiceUuid ?? null, description: b.description ?? null,
        flags, createdBy: ctx.identityId,
      }).returning();
      await TenantDb.audit(tx, ctx, "cost.created", "cost_record", row!.id, toCost(row!), null, branchId);
      return toCost(row!);
    });
  }

  @Requires("cost.write") @Post(routes.voidCost.path) @HttpCode(200)
  async void(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.voidCost.body)) b: z.output<typeof routes.voidCost.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const [c] = await tx.select().from(C).where(eq(C.id, id)).for("update");
      if (!c || !canAccessBranch(ctx, ctx.scope!, c.branchId)) throw notFound("cost");
      if (c.sourceType !== "manual") throw conflict("void_at_source", "Void the source record (e.g. the fuel entry) instead");
      if (c.status === "voided") throw conflict("invalid_transition", "Already voided");
      const [row] = await tx.update(C).set({ status: "voided" }).where(eq(C.id, id)).returning();
      await TenantDb.audit(tx, ctx, "cost.voided", "cost_record", id, { reason: b.reason }, { status: c.status }, c.branchId);
      return toCost(row!);
    });
  }

  /**
   * US-E15-03 / Worked Example E3: recorded cost per vehicle for [from, to] divided by valid distance. Days are
   * the vehicle's branch days (US-E03-01): costs carry their branch-local expense date, and the distance window
   * starts and ends at the branch's midnight. No valid distance → Unavailable, never 0 or ∞.
   */
  @Requires("cost.read") @Get(routes.costSummary.path)
  async summary(@Query(new ZodPipe(routes.costSummary.query)) q: z.output<typeof routes.costSummary.query>, @Ctx() ctx: RequestContext) {
    if (q.to < q.from) throw validation({ to: "before_from" });
    const db = await this.tdb.for(ctx);
    const { company } = await companyOf(db);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { from: q.from, to: q.to, currency: company.currency, vehicles: [] };
    const V = schema.vehicles;
    const vehicles = await db.select({ id: V.id, fleetNumber: V.fleetNumber, branchId: V.branchId }).from(V)
      .where(and(filter ? inArray(V.branchId, [...filter]) : undefined, q.vehicleId ? eq(V.id, q.vehicleId) : undefined, ne(V.status, "draft")))
      .orderBy(asc(V.fleetNumber));
    const period = await branchPeriod(db, q.from, q.to);
    const costs = vehicles.length ? await db.select().from(C).where(and(eq(C.status, "active"), gte(C.expenseDate, q.from), lte(C.expenseDate, q.to), inArray(C.vehicleId, vehicles.map((v) => v.id)))) : [];
    const out = [];
    for (const v of vehicles) {
      const mine = costs.filter((c) => c.vehicleId === v.id).map(toCost);
      const costMinor = mine.reduce((s, c) => s + c.reportedMinor, 0);
      const fuelCostMinor = mine.filter((c) => c.category === "fuel").reduce((s, c) => s + c.reportedMinor, 0);
      const { domain, replacements } = await this.meter.history(db, v.id);
      const w = period.window(v.branchId);
      const distance = validDistance(domain, replacements, w.start, w.end - 1);
      out.push({ vehicleId: v.id, fleetNumber: v.fleetNumber, costMinor, fuelCostMinor, distance, costPerKm: costPerKm(costMinor, distance), fuelCostPerKm: costPerKm(fuelCostMinor, distance) });
    }
    return { from: q.from, to: q.to, currency: company.currency, vehicles: out };
  }
}

