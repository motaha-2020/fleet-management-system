import { and, desc, gte, lte } from "drizzle-orm";
import type { KpiRecalculation } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import type { DbOrTx } from "../m2/common.js";

const R = schema.kpiRecalculations;
type RecalcRow = typeof R.$inferSelect;

/** First day of each month from `from` to `to` (ISO dates, inclusive). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
export const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * US-E16-03 / AUD-003. An applied correction queues each month it touches; until the background job has
 * recalculated a month, the dashboard shows it as "Recalculating". The job replaces the month's snapshot and
 * keeps the values before and after, with the correction's reason, so a changed number can be explained.
 */
export async function queueKpiRecalculation(tx: DbOrTx, cause: { id: string; reason: string; from: string | null; to: string | null; by: string }) {
  if (!cause.from || !cause.to) return [];
  const months = monthsBetween(cause.from, cause.to);
  await tx.insert(R).values(months.map((month) => ({ id: newId(), month, causeType: "correction" as const, causeId: cause.id, reason: cause.reason, requestedBy: cause.by })))
    .onConflictDoNothing();
  return months;
}

export const toRecalc = (r: RecalcRow): KpiRecalculation => ({
  id: r.id, month: r.month, causeType: r.causeType, causeId: r.causeId, reason: r.reason, status: r.status,
  requestedAt: r.requestedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
  before: (r.before as Record<string, number | null> | null) ?? null, after: (r.after as Record<string, number | null> | null) ?? null,
});

/** Recalculations of the months that [from, to] touches, newest first. */
export async function recalculationsFor(db: DbOrTx, from: string, to: string) {
  const rows = await db.select().from(R).where(and(gte(R.month, `${from.slice(0, 7)}-01`), lte(R.month, `${to.slice(0, 7)}-01`))).orderBy(desc(R.requestedAt)).limit(20);
  return rows.map(toRecalc);
}

