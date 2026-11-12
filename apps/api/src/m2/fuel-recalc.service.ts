import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lt, lte, ne, or, sql } from "drizzle-orm";
import { DEFAULTS } from "@fleet/config";
import { schema, newId, type Db } from "@fleet/db";
import { fuelFlags, localDate, needsReview, type FuelFlag } from "@fleet/domain";
import { CONTROL_DB } from "../infra/tokens.js";
import type { RequestContext } from "../auth/context.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { companyOf, hasAssignment, type DbOrTx } from "./common.js";

const F = schema.fuelEntries;
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

  /** All fuel rules for an entry (new or corrected); `selfId` is excluded from duplicate detection. */
  async evaluate(tx: DbOrTx, e: {
    selfId: string; vehicle: typeof schema.vehicles.$inferSelect; driverId: string | null; fuelType: string; quantity: number; grossMinor: number;
    at: Date; receiptRef: string | null; hasReceiptFile: boolean; payment: "cash" | "card"; readingStatus: string; countryCode: string;
  }) {
    const v = e.vehicle;
    const window = DEFAULTS.FUEL_DUPLICATE_WINDOW_MINUTES * 60_000;
    const nearby = await tx.select().from(F).where(and(
      eq(F.vehicleId, v.id), ne(F.status, "voided"), ne(F.id, e.selfId),
      or(and(gte(F.eventAt, new Date(e.at.getTime() - window)), lte(F.eventAt, new Date(e.at.getTime() + window))), e.receiptRef ? eq(F.receiptRef, e.receiptRef) : sql`false`),
    ));
    const reference = await this.referencePrice(e.countryCode, e.fuelType, e.at);
    const flags: FuelFlag[] = fuelFlags({
      vehicle: { primaryFuelType: v.primaryFuelType, primaryTankCapacity: Number(v.primaryTankCapacity), secondaryFuelType: v.secondaryFuelType, secondaryTankCapacity: v.secondaryTankCapacity == null ? null : Number(v.secondaryTankCapacity) },
      fuelType: e.fuelType, quantity: e.quantity, grossMinor: e.grossMinor, at: e.at.getTime(), reference,
      nearby: nearby.map((n) => ({ id: n.id, at: n.eventAt.getTime(), quantity: Number(n.quantity), grossMinor: n.grossMinor ?? n.netMinor + n.taxMinor, receiptRef: n.receiptRef })),
      receiptRef: e.receiptRef,
      hasAssignment: e.driverId ? await hasAssignment(tx, e.driverId, v.id, e.at) : true,
      odometer: e.readingStatus === "conflict" ? "conflict" : e.readingStatus === "warning" ? "warning" : "valid",
    });
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
      const accept = e.status === "under_review" && !needsReview(flags) && !e.reviewedBy;
      const [row] = await tx.update(F).set({ flags, ...(accept ? { status: "accepted" as const } : {}) }).where(eq(F.id, e.id)).returning();
      if (accept) await this.ensureCost(tx, ctx, row!);
      await TenantDb.audit(tx, ctx, "fuel.recalculated", "fuel_entry", e.id, { flags, status: row!.status }, { flags: e.flags, status: e.status }, e.branchId);
    }
    return rows.length;
  }
}
