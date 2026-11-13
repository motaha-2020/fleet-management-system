import { Injectable } from "@nestjs/common";
import { asc, eq, inArray } from "drizzle-orm";
import type { Dashboard } from "@fleet/contracts";
import { schema, type Db } from "@fleet/db";
import { DashboardService } from "./dashboard.service.js";
import { monthEnd } from "./kpi-recalc.js";

const S = schema.kpiSnapshots;
const R = schema.kpiRecalculations;

/** The headline numbers kept before/after a recalculation, so the log can say what changed. */
const headline = (kpis: Dashboard["kpis"], costs: Dashboard["costs"], distance: Dashboard["distance"]) => ({
  costPerKm: kpis.costPerKm.value, fuelCostPerKm: kpis.fuelCostPerKm.value, fuelConsumption: kpis.fuelConsumption.value,
  operatingMinor: costs.operatingMinor, fuelMinor: costs.fuelMinor, distance: distance.value,
});

/**
 * US-E16-03 / AUD-003: the job that recalculates queued months (see kpi-recalc.ts), replaces each month's
 * snapshot and keeps the values before and after with the correction's reason.
 */
@Injectable()
export class KpiSnapshotService {
  constructor(private readonly dashboard: DashboardService) {}

  /** Recalculates every month waiting, oldest request first. Rows queued meanwhile wait for the next run. */
  async process(db: Db) {
    const pending = await db.select().from(R).where(eq(R.status, "pending")).orderBy(asc(R.requestedAt));
    const months = [...new Set(pending.map((p) => p.month))].sort();
    for (const month of months) {
      const d = await this.dashboard.build(db, null, { from: month, to: monthEnd(month) });
      const ids = pending.filter((p) => p.month === month).map((p) => p.id);
      await db.transaction(async (tx) => {
        const [prev] = await tx.select().from(S).where(eq(S.month, month)).for("update");
        const before = prev ? headline(prev.kpis as Dashboard["kpis"], prev.costs as Dashboard["costs"], (prev.kpis as { distance?: Dashboard["distance"] }).distance ?? { value: null, quality: "unavailable" }) : null;
        const kpis = { ...d.kpis, distance: d.distance };
        await tx.insert(S).values({ month, kpis, costs: d.costs, computedAt: new Date() })
          .onConflictDoUpdate({ target: S.month, set: { kpis, costs: d.costs, computedAt: new Date() } });
        await tx.update(R).set({ status: "done", completedAt: new Date(), before, after: headline(d.kpis, d.costs, d.distance) }).where(inArray(R.id, ids));
      });
    }
    return { processed: pending.length, months };
  }

  /** Month close: keep last month's snapshot, so a later correction has the values from before it. */
  async closeMonth(db: Db, today: string) {
    const [y, m] = today.split("-").map(Number) as [number, number];
    const month = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
    const [has] = await db.select({ month: S.month }).from(S).where(eq(S.month, month));
    if (has) return false;
    const d = await this.dashboard.build(db, null, { from: month, to: monthEnd(month) });
    await db.insert(S).values({ month, kpis: { ...d.kpis, distance: d.distance }, costs: d.costs }).onConflictDoNothing();
    return true;
  }
}
