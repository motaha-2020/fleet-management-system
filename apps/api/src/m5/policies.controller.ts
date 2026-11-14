import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { and, asc, eq, gte, isNull, ne } from "drizzle-orm";
import type { z } from "zod";
import { POLICIES, type PolicyKey } from "@fleet/config";
import { routes } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { checkPolicyChange, localDate, needsReview, policyAt, type FuelFlag } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { notFound, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { companyOf } from "../m2/common.js";
import { zonedStart } from "../m2/costs.controller.js";
import { FuelRecalc } from "../m2/fuel-recalc.service.js";
import { policyVersions } from "../m2/policies.js";

const P = schema.companyPolicies;
const F = schema.fuelEntries;
type Row = typeof P.$inferSelect;
const dto = (r: Row) => ({
  id: r.id, key: r.key, value: r.value, effectiveFrom: r.effectiveFrom, retroactive: r.retroactive, reason: r.reason, recalculated: r.recalculated,
  createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
});
/** Flags set by something other than the fuel rules; a recalculation keeps them. */
const KEEP = new Set(["clock_drift", "vehicle_restricted"]);

/**
 * GEN-007 / US-E03-03: company thresholds are versioned with an Effective From date. Fuel and odometer rules
 * read the version in force at each record's event time, so a change never re-judges history — unless the
 * company admin explicitly makes it retroactive, which recalculates the affected fuel entries (audited).
 */
@Controller()
export class PoliciesController {
  constructor(private readonly tdb: TenantDb, private readonly recalc: FuelRecalc) {}

  @Requires("policy.manage") @Get(routes.listPolicies.path)
  async list(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const { company } = await companyOf(db);
    const today = localDate(new Date(), company.timezone);
    const rows = await db.select().from(P).orderBy(asc(P.effectiveFrom), asc(P.createdAt));
    const versions = await policyVersions(db);
    return {
      items: POLICIES.map((p) => {
        const mine = rows.filter((r) => r.key === p.key);
        const upcoming = mine.filter((r) => r.effectiveFrom > today).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
        return {
          key: p.key, name: p.name, unit: p.unit, min: p.min, max: p.max, default: p.default, current: policyAt(versions, p.key, today),
          next: upcoming ? { value: upcoming.value, effectiveFrom: upcoming.effectiveFrom } : null, versions: mine.map(dto).reverse(),
        };
      }),
    };
  }

  @Requires("policy.manage") @Post(routes.setPolicy.path) @HttpCode(201)
  async set(@Param("key") key: string, @Body(new ZodPipe(routes.setPolicy.body)) b: z.output<typeof routes.setPolicy.body>, @Ctx() ctx: RequestContext) {
    if (!POLICIES.some((p) => p.key === key)) throw notFound("policy");
    const db = await this.tdb.for(ctx);
    const { company } = await companyOf(db);
    const today = localDate(new Date(), company.timezone);
    const err = checkPolicyChange(key, b.value, b.effectiveFrom, today, b.retroactive);
    if (err) throw validation(err === "effective_from_in_past" ? { effectiveFrom: err } : { value: err });
    return db.transaction(async (tx) => {
      const id = newId();
      const before = policyAt(await policyVersions(tx), key as PolicyKey, b.effectiveFrom);
      await tx.insert(P).values({ id, key, value: b.value, effectiveFrom: b.effectiveFrom, retroactive: b.retroactive && b.effectiveFrom < today, reason: b.reason, createdBy: ctx.identityId });
      // Only an explicit retroactive change re-judges records already made (GEN-007 "Recalculation").
      const recalculated = b.retroactive && b.effectiveFrom < today && key.startsWith("fuel_")
        ? await this.recalculateFuel(tx, ctx, zonedStart(b.effectiveFrom, company.timezone), id) : 0;
      const [row] = await tx.update(P).set({ recalculated }).where(eq(P.id, id)).returning();
      const [c] = await tx.select({ id: schema.company.id }).from(schema.company).limit(1);
      await TenantDb.audit(tx, ctx, "policy.changed", "company", c!.id, { key, value: b.value, effectiveFrom: b.effectiveFrom, retroactive: row!.retroactive, reason: b.reason, recalculated }, { key, value: before });
      return dto(row!);
    });
  }

  /** Re-runs the fuel rules for entries from `from` that nobody has reviewed yet; status and cost follow the result. */
  private async recalculateFuel(tx: Tx, ctx: RequestContext, from: Date, policyId: string) {
    const { country } = await companyOf(tx);
    const entries = await tx.select().from(F).where(and(gte(F.eventAt, from), ne(F.status, "voided"), isNull(F.reviewedBy))).orderBy(asc(F.eventAt));
    let changed = 0;
    for (const e of entries) {
      const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, e.vehicleId));
      const [r] = e.readingId ? await tx.select({ status: schema.meterReadings.status }).from(schema.meterReadings).where(eq(schema.meterReadings.id, e.readingId)) : [];
      const { flags: rule } = await this.recalc.evaluate(tx, {
        selfId: e.id, vehicle: v!, driverId: e.driverId, fuelType: e.fuelType, quantity: Number(e.quantity), grossMinor: e.netMinor + e.taxMinor, at: e.eventAt,
        receiptRef: e.receiptRef, hasReceiptFile: !!e.receiptFileKey, payment: e.payment, readingStatus: r?.status ?? "valid", countryCode: country.code,
      });
      const flags = [...rule, ...e.flags.filter((f) => KEEP.has(f) && !rule.includes(f as FuelFlag))] as FuelFlag[];
      if ([...flags].sort().join() === [...e.flags].sort().join()) continue;
      let status = e.status;
      if (e.status === "accepted" && needsReview(flags)) { status = "under_review"; await this.recalc.voidCost(tx, e.id); }
      else if (e.status === "under_review" && !needsReview(flags) && !e.needsApproval) status = "accepted";
      const [row] = await tx.update(F).set({ flags, status }).where(eq(F.id, e.id)).returning();
      if (status === "accepted" && e.status !== "accepted") await this.recalc.ensureCost(tx, ctx, row!);
      await TenantDb.audit(tx, ctx, "fuel.recalculated", "fuel_entry", e.id, { flags, status, cause: "policy_change", policyId }, { flags: e.flags, status: e.status }, e.branchId);
      changed++;
    }
    return changed;
  }
}
