import type { Measured } from "./meter.js";
import { addMonths } from "./maintenance.js";
import type { IsoDate } from "./dates.js";

/**
 * KPI dictionary (PRD §26.1). General rules: a zero or untrusted denominator is Unavailable (never 0 or ∞);
 * a value built partly from estimated inputs carries that quality.
 */
export function percent(num: number, den: number, quality: Measured["quality"] = "reliable"): Measured {
  if (!(den > 0)) return { value: null, quality: "unavailable" };
  return { value: Math.round((num / den) * 1000) / 10, quality };
}

/** Document Compliance % = mandatory documents Valid + Verified ÷ all mandatory documents. */
export function documentCompliance(states: readonly { mandatory: boolean; ok: boolean }[]): Measured {
  const m = states.filter((s) => s.mandatory);
  return percent(m.filter((s) => s.ok).length, m.length);
}

/**
 * Maintenance Compliance % = items done before Overdue ÷ items that fell due in the period.
 * A done item is on time if it was done no later than its due point (km or date, whichever came first) from
 * the previous baseline. Items that fell due in the period and are still not done count as missed.
 */
export function maintenanceOnTime(prev: { date: IsoDate; km: number | null }, interval: { km: number | null; months: number | null }, done: { date: IsoDate; km: number | null }): boolean {
  if (interval.months != null && done.date > addMonths(prev.date, interval.months)) return false;
  if (interval.km != null && prev.km != null && done.km != null && done.km > prev.km + interval.km) return false;
  return true;
}
export const maintenanceCompliance = (onTime: number, late: number, missed: number): Measured => percent(onTime, onTime + late + missed);

/** Vehicle Availability % = (Scheduled Hours − Downtime) ÷ Scheduled Hours (calendar hours, Pilot). */
export function availability(scheduledHours: number, downtimeHours: number): Measured {
  return percent(Math.max(0, scheduledHours - Math.min(downtimeHours, scheduledHours)), scheduledHours);
}

/** Downtime hours of [offRoad, return) that fall inside [from, to). */
export function overlapHours(offRoad: number, back: number | null, from: number, to: number) {
  const s = Math.max(offRoad, from);
  const e = Math.min(back ?? to, to);
  return e > s ? (e - s) / 3_600_000 : 0;
}

/** Data Coverage % = vehicles whose distance in the period is Reliable ÷ vehicles measured. */
export const dataCoverage = (qualities: readonly Measured["quality"][]): Measured => percent(qualities.filter((q) => q === "reliable").length, qualities.length);

/** Sync Success Rate = events accepted (with or without warning) ÷ events submitted and decided. */
export const syncSuccess = (accepted: number, decided: number): Measured => percent(accepted, decided);
