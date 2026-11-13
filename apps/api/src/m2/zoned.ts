import { schema } from "@fleet/db";
import { localDate } from "@fleet/domain";
import { companyOf, type DbOrTx } from "./common.js";

/** The instant a local calendar date starts in an IANA time zone. */
export function zonedStart(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess);
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asLocal = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * US-E03-01 / GEN-010: each branch counts days in its own time zone. A record without a branch (or of an
 * unknown one) uses the company's.
 */
export async function branchZones(db: DbOrTx) {
  const { company } = await companyOf(db);
  const rows = await db.select({ id: schema.branches.id, tz: schema.branches.timezone }).from(schema.branches);
  const byId = new Map(rows.map((r) => [r.id, r.tz]));
  const tzOf = (branchId: string | null | undefined) => (branchId && byId.get(branchId)) || company.timezone;
  return { companyTz: company.timezone, zones: [...new Set([company.timezone, ...byId.values()])], tzOf, localDay: (at: Date, branchId: string | null | undefined) => localDate(at, tzOf(branchId)) };
}

export type BranchPeriod = Awaited<ReturnType<typeof branchPeriod>>;

/**
 * A report period [from, to] (local dates, inclusive) cut per branch: `window(branch)` is that branch's
 * [start, end) in instants, `contains` places a record by its branch's local day, and `outer` spans every
 * branch's window for a first query on the database.
 */
export async function branchPeriod(db: DbOrTx, from: string, to: string) {
  const z = await branchZones(db);
  const byZone = new Map(z.zones.map((tz) => [tz, { start: zonedStart(from, tz).getTime(), end: zonedStart(nextDay(to), tz).getTime() }]));
  const window = (branchId: string | null | undefined) => {
    const tz = z.tzOf(branchId);
    if (!byZone.has(tz)) byZone.set(tz, { start: zonedStart(from, tz).getTime(), end: zonedStart(nextDay(to), tz).getTime() });
    return byZone.get(tz)!;
  };
  const all = [...byZone.values()];
  return {
    ...z, from, to, window,
    contains: (at: Date, branchId: string | null | undefined) => {
      const w = window(branchId);
      return at.getTime() >= w.start && at.getTime() < w.end;
    },
    /** Whether [s, e) (e null = still open) overlaps the branch's period. */
    overlaps: (s: Date, e: Date | null, branchId: string | null | undefined) => {
      const w = window(branchId);
      return s.getTime() < w.end && (!e || e.getTime() >= w.start);
    },
    outer: { start: new Date(Math.min(...all.map((w) => w.start))), end: new Date(Math.max(...all.map((w) => w.end))) },
  };
}
