import { DEFAULTS } from "@fleet/config";
import { daysBetween, type IsoDate } from "./dates.js";

/** MNT-003: distance and/or calendar interval; whichever comes first. */
export interface Interval { km: number | null; months: number | null }
export type MaintenanceStatus = "ok" | "upcoming" | "due" | "overdue" | "unknown_baseline";
const ORDER: Record<MaintenanceStatus, number> = { unknown_baseline: 0, ok: 1, upcoming: 2, due: 3, overdue: 4 };

/** Last time the item was done. `estimated`: its odometer reading is not trusted (MNT-005). */
export interface Baseline { cumKm: number | null; date: IsoDate; estimated: boolean }

export interface ItemDue {
  status: MaintenanceStatus;
  /** Cumulative km (continuous scale across meter replacements) at which it falls due. */
  dueKm: number | null;
  dueDate: IsoDate | null;
  remainingKm: number | null;
  remainingDays: number | null;
  /** When it is expected to fall due, from the recent movement (distance intervals) and the due date. */
  forecastDate: IsoDate | null;
  quality: "reliable" | "estimated" | "unavailable";
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(days) * 86_400_000).toISOString().slice(0, 10);
}

const sideStatus = (remaining: number, upcoming: number): MaintenanceStatus =>
  remaining < 0 ? "overdue" : remaining === 0 ? "due" : remaining <= upcoming ? "upcoming" : "ok";

/**
 * MNT-003/004/005 (US-E10-02/03). With no baseline there is no due point ("Unknown baseline").
 * Each side (km, date) gets a status; the worse one wins. The forecast uses the recent km/day.
 */
export function maintenanceDue(
  interval: Interval,
  baseline: Baseline | null,
  now: { date: IsoDate; cumKm: number | null; kmPerDay: number | null },
  cfg = { upcomingKm: DEFAULTS.MNT_UPCOMING_KM, upcomingDays: DEFAULTS.MNT_UPCOMING_DAYS },
): ItemDue {
  if (!baseline) return { status: "unknown_baseline", dueKm: null, dueDate: null, remainingKm: null, remainingDays: null, forecastDate: null, quality: "unavailable" };
  const dueKm = interval.km != null && baseline.cumKm != null ? baseline.cumKm + interval.km : null;
  const dueDate = interval.months != null ? addMonths(baseline.date, interval.months) : null;
  const remainingKm = dueKm != null && now.cumKm != null ? dueKm - now.cumKm : null;
  const remainingDays = dueDate ? daysBetween(now.date, dueDate) : null;

  let status: MaintenanceStatus = "ok";
  let known = false;
  if (remainingKm != null) { status = sideStatus(remainingKm, cfg.upcomingKm); known = true; }
  if (remainingDays != null) {
    const s = sideStatus(remainingDays, cfg.upcomingDays);
    status = !known || ORDER[s] > ORDER[status] ? s : status;
    known = true;
  }
  if (!known) status = "unknown_baseline";

  // Already reached by distance: it is due now, whatever the recent movement.
  const byKm = remainingKm == null ? null : remainingKm <= 0 ? now.date : now.kmPerDay && now.kmPerDay > 0 ? addDays(now.date, remainingKm / now.kmPerDay) : null;
  const forecastDate = [byKm, dueDate].filter((d): d is string => !!d).sort()[0] ?? null;
  const estimated = baseline.estimated || (interval.km != null && now.cumKm == null);
  return { status, dueKm, dueDate, remainingKm, remainingDays, forecastDate, quality: known ? (estimated ? "estimated" : "reliable") : "unavailable" };
}

export const worstStatus = (list: readonly MaintenanceStatus[]): MaintenanceStatus =>
  list.reduce<MaintenanceStatus>((a, b) => (ORDER[b] > ORDER[a] ? b : a), "ok");

/** MNT-002: a vehicle override replaces the template interval for that vehicle only (US-E10-01). */
export function effectiveInterval(template: Interval, override: Partial<Interval> | null | undefined): Interval {
  if (!override) return template;
  return { km: override.km !== undefined ? override.km : template.km, months: override.months !== undefined ? override.months : template.months };
}

/** Which template applies: most specific match on make/model wins (null = any). */
export function templateMatches(t: { make: string | null; model: string | null }, v: { make: string; model: string }): number {
  const eq = (a: string | null, b: string) => a === null || a.trim().toLowerCase() === b.trim().toLowerCase();
  if (!eq(t.make, v.make) || !eq(t.model, v.model)) return -1;
  return (t.make ? 2 : 0) + (t.model ? 1 : 0);
}

// ---------------------------------------------------------------- defects & work orders (WO-002/003)

export const DEFECT_STATUSES = ["reported", "triaged", "converted", "rejected", "duplicate"] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];
const DEFECT_NEXT: Record<DefectStatus, readonly DefectStatus[]> = {
  reported: ["triaged", "converted", "rejected", "duplicate"],
  triaged: ["converted", "rejected", "duplicate"],
  converted: [], rejected: [], duplicate: [],
};
export const canTransitionDefect = (from: DefectStatus, to: DefectStatus) => DEFECT_NEXT[from].includes(to);

export const WORK_ORDER_STATUSES = ["open", "scheduled", "in_progress", "completed", "closed", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
const WO_NEXT: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  open: ["scheduled", "in_progress", "completed", "cancelled"],
  scheduled: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: ["closed"],
  closed: [], cancelled: [],
};
export const canTransitionWorkOrder = (from: WorkOrderStatus, to: WorkOrderStatus) => WO_NEXT[from].includes(to);
export const isOpenWorkOrder = (s: WorkOrderStatus) => s !== "closed" && s !== "cancelled";

/** WO-005: downtime from off-road to return to service (or now, while still off the road). */
export const downtimeMs = (offRoadAt: number | null, returnAt: number | null, now: number) => (offRoadAt == null ? 0 : Math.max(0, (returnAt ?? now) - offRoadAt));

/**
 * MNT-007 / US-E10-07: the invoice total counts once; the breakdown is optional and its gap is shown as
 * Unallocated. A breakdown larger than the total is an input error.
 */
export function invoiceAllocation(grossMinor: number, parts: number | null, labor: number | null, other: number | null) {
  const allocated = (parts ?? 0) + (labor ?? 0) + (other ?? 0);
  if (allocated > grossMinor) return { ok: false as const, allocated, unallocated: 0 };
  return { ok: true as const, allocated, unallocated: grossMinor - allocated };
}
