import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lt, lte, ne, or, sql } from "drizzle-orm";
import { DEFAULTS } from "@fleet/config";
import { schema, newId, type Db } from "@fleet/db";
import { fuelFlags, fuelRuleConfig, localDate, needsReview, type FuelFlag } from "@fleet/domain";
import { policiesFor } from "./policies.js";
import { CONTROL_DB } from "../infra/tokens.js";
import type { RequestContext } from "../auth/context.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { companyOf, hasAssignment, type DbOrTx } from "./common.js";

const F = schema.fuelEntries;
/** A price more than twice (or under half) the company's own median price per litre is flagged for review. */
const COMPANY_PRICE_FACTOR = 2;
type FuelRow = typeof F.$inferSelect;

/**
 * Keeps derived records consistent when a fuel entry changes state:
 *  - accepted → exactly one fuel cost record (expense identity, FIN-003/GEN-006)
 *  - voided → its cost record is voided too
 *  - an assignment covering it appears (create/backdate) → the no_assignment flag is lifted (US-E07-02)
 */
@Injectable()
export class FuelRecalc {
  constructor(@Inject(CONTROL_DB) private readonly control: Db) {}

  /** FUEL-017: the official price in force at the event time (not at sync time). */
  async referencePrice(countryCode: string, fuelType: string, at: Date) {
    const P = schema.fuelPrices;
    const [p] = await this.control.select().from(P)
      .where(and(eq(P.countryCode, countryCode), eq(P.fuelType, fuelType), lte(P.effectiveFrom, at)))
      .orderBy(desc(P.effectiveFrom)).limit(1);
    return p ? { priceMinor: p.priceMinor, official: true } : null;
  }

  /**
   * No official price: the company's own median unit price for that fuel over the 90 days before the entry
   * (accepted entries only, at least 3), so an absurd price is still caught (QA 16 Nov 2026: 99,999 EGP/L passed).
   */
  async companyPrice(tx: DbOrTx, fuelType: string, at: Date, selfId: string) {
    const rows = await tx.select({ net: F.netMinor, tax: F.taxMinor, q: F.quantity }).from(F).where(and(
      eq(F.fuelType, fuelType), eq(F.status, "accepted"), ne(F.id, selfId),
      gte(F.eventAt, new Date(at.getTime() - 90 * 86_400_000)), lte(F.eventAt, at),
    )).orderBy(desc(F.eventAt)).limit(50);
    const units = rows.filter((r) => Number(r.q) > 0).map((r) => (r.net + r.tax) / Number(r.q)).sort((a, b) => a - b);
    if (units.length < 3) return null;
    const mid = Math.floor(units.length / 2);
    const median = units.length % 2 ? units[mid]! : (units[mid - 1]! + units[mid]!) / 2;
    return { priceMinor: Math.round(median), official: false };
  }

  /** All fuel rules for an entry (new or corrected); `selfId` is excluded from duplicate detection. */
  async evaluate(tx: DbOrTx, e: {
    selfId: string; vehicle: typeof schema.vehicles.$inferSelect; driverId: string | null; fuelType: string; quantity: number; grossMinor: number;
    at: Date; receiptRef: string | null; hasReceiptFile: boolean; payment: "cash" | "card"; readingStatus: string; countryCode: string;
  }) {
    const v = e.vehicle;
    // GEN-007: the thresholds in force at the event time, not today's.
    const policy = await policiesFor(tx, e.at);
    const window = policy.fuel_duplicate_window_min * 60_000;
    const nearby = await tx.select().from(F).where(and(
      eq(F.vehicleId, v.id), ne(F.status, "voided"), ne(F.id, e.selfId),
      or(and(gte(F.eventAt, new Date(e.at.getTime() - window)), lte(F.eventAt, new Date(e.at.getTime() + window))), e.receiptRef ? eq(F.receiptRef, e.receiptRef) : sql`false`),
    ));
    const official = await this.referencePrice(e.countryCode, e.fuelType, e.at);
    const company = official ? null : await this.companyPrice(tx, e.fuelType, e.at, e.selfId);
    const reference = official ?? company;
    const flags: FuelFlag[] = fuelFlags({
      vehicle: { primaryFuelType: v.primaryFuelType, primaryTankCapacity: Number(v.primaryTankCapacity), secondaryFuelType: v.secondaryFuelType, secondaryTankCapacity: v.secondaryTankCapacity == null ? null : Number(v.secondaryTankCapacity) },
      fuelType: e.fuelType, quantity: e.quantity, grossMinor: e.grossMinor, at: e.at.getTime(), reference: official,
      nearby: nearby.map((n) => ({ id: n.id, at: n.eventAt.getTime(), quantity: Number(n.quantity), grossMinor: n.grossMinor ?? n.netMinor + n.taxMinor, receiptRef: n.receiptRef })),
      receiptRef: e.receiptRef,
      hasAssignment: e.driverId ? await hasAssignment(tx, e.driverId, v.id, e.at) : true,
      odometer: e.readingStatus === "conflict" ? "conflict" : e.readingStatus === "warning" ? "warning" : "valid",
    }, fuelRuleConfig(policy));
    // The company median is a rough guide (prices move, grades differ): only a price far off it is flagged.
    if (!official && company && e.quantity > 0) {
      const unit = e.grossMinor / e.quantity;
      if ((unit > company.priceMinor * COMPANY_PRICE_FACTOR || unit < company.priceMinor / COMPANY_PRICE_FACTOR) && !flags.includes("price_deviation")) flags.push("price_deviation");
    }
    // FUEL-009: cash needs a receipt photo; it is uploaded right after (it may arrive later when offline).
    if (e.payment === "cash" && !e.hasReceiptFile) flags.push("missing_receipt");
    return { flags, reference };
  }

  /** Cost record for an accepted entry; idempotent through the unique (source_type, source_id) index. */
  async ensureCost(tx: DbOrTx, ctx: RequestContext, e: FuelRow) {
    const { country } = await companyOf(tx);
    const [branch] = await tx.select({ tz: schema.branches.timezone }).from(schema.branches).where(eq(schema.branches.id, e.branchId));
    await tx.insert(schema.costRecords).values({
      id: newId(), category: "fuel", vehicleId: e.vehicleId, branchId: e.branchId, netMinor: e.netMinor, taxMinor: e.taxMinor,
      currency: e.currency, taxRecoverable: country.taxRecoverable.fuel, expenseDate: localDate(e.eventAt, branch?.tz ?? "Africa/Cairo"),
      sourceType: "fuel", sourceId: e.id, description: null, createdBy: ctx.identityId,
    }).onConflictDoNothing();
  }

  /** Mirror a corrected fuel entry onto its cost record (amounts, date). */
  async syncCost(tx: DbOrTx, e: FuelRow) {
    const [branch] = await tx.select({ tz: schema.branches.timezone }).from(schema.branches).where(eq(schema.branches.id, e.branchId));
    await tx.update(schema.costRecords).set({ netMinor: e.netMinor, taxMinor: e.taxMinor, expenseDate: localDate(e.eventAt, branch?.tz ?? "Africa/Cairo") })
      .where(and(eq(schema.costRecords.sourceType, "fuel"), eq(schema.costRecords.sourceId, e.id)));
  }

  async voidCost(tx: DbOrTx, entryId: string) {
    await tx.update(schema.costRecords).set({ status: "voided" }).where(and(eq(schema.costRecords.sourceType, "fuel"), eq(schema.costRecords.sourceId, entryId)));
  }

  /**
   * After an assignment is created or backdated, entries by that driver on that vehicle inside the new
   * range are no longer "without assignment". Clean entries waiting only for that are accepted.
   * Returns how many entries were re-evaluated.
   */
  async assignmentChanged(tx: DbOrTx, ctx: RequestContext, driverId: string, vehicleId: string, from: Date, to: Date | null) {
    const rows = await tx.select().from(F).where(and(
      eq(F.driverId, driverId), eq(F.vehicleId, vehicleId), gte(F.eventAt, from), to ? lt(F.eventAt, to) : undefined,
      ne(F.status, "voided"), sql`'no_assignment' = ANY(${F.flags})`,
    ));
    for (const e of rows) {
      const flags = e.flags.filter((f) => f !== "no_assignment");
      const accept = e.status === "under_review" && !needsReview(flags) && !e.reviewedBy && !e.needsApproval;
      const [row] = await tx.update(F).set({ flags, ...(accept ? { status: "accepted" as const } : {}) }).where(eq(F.id, e.id)).returning();
      if (accept) await this.ensureCost(tx, ctx, row!);
      await TenantDb.audit(tx, ctx, "fuel.recalculated", "fuel_entry", e.id, { flags, status: row!.status }, { flags: e.flags, status: e.status }, e.branchId);
    }
    return rows.length;
  }
}
