import { DEFAULTS } from "@fleet/config";

export type ReadingStatus = "valid" | "warning" | "conflict" | "corrected" | "excluded";
export const READING_STATUSES: readonly ReadingStatus[] = ["valid", "warning", "conflict", "corrected", "excluded"];
/** Valid and Warning readings count (US-E08-03: warnings stay in KPIs until decided). */
export const isTrusted = (s: ReadingStatus) => s === "valid" || s === "warning";

export interface Replacement { at: number; oldFinal: number; newStart: number }
export interface Reading { id: string; value: number; at: number; status: ReadingStatus; source: string }

/**
 * ODO-009: a meter replacement starts a new segment. Readings are compared on a continuous
 * "cumulative km" scale: raw value + offset of its segment, so 180,000 → new meter 0 → 500
 * means 180,500 and is not a conflict (US-E08-05).
 */
export function cumulative(value: number, at: number, replacements: readonly Replacement[]): number {
  let offset = 0;
  for (const r of [...replacements].sort((a, b) => a.at - b.at)) {
    if (r.at <= at) offset += r.oldFinal - r.newStart;
  }
  return value + offset;
}

export interface Classification {
  status: "valid" | "warning" | "conflict";
  /** Why: below an earlier reading, above a later one, too far per day. */
  reasons: ("below_previous" | "above_next" | "daily_distance")[];
  /** Readings this one corroborates (ODO-008): not duplicates, not conflicts. */
  corroborates: string[];
}

/**
 * ODO-004/005/008. Compared with trusted readings only (Conflict/Excluded/Corrected are ignored).
 * A reading within ±2 km and 10 minutes of a reading from another source corroborates it and is
 * never a conflict with it.
 */
export function classifyReading(
  candidate: { value: number; at: number; source: string },
  existing: readonly Reading[],
  replacements: readonly Replacement[],
  cfg = { maxPerDay: DEFAULTS.ODO_MAX_KM_PER_DAY, corrobKm: DEFAULTS.ODO_CORROB_KM, corrobMinutes: DEFAULTS.ODO_CORROB_MINUTES },
): Classification {
  const cum = cumulative(candidate.value, candidate.at, replacements);
  const trusted = existing.filter((r) => isTrusted(r.status)).map((r) => ({ ...r, cum: cumulative(r.value, r.at, replacements) }));
  const corroborates = trusted
    .filter((r) => r.source !== candidate.source && Math.abs(r.at - candidate.at) <= cfg.corrobMinutes * 60_000 && Math.abs(r.cum - cum) <= cfg.corrobKm)
    .map((r) => r.id);
  const others = trusted.filter((r) => !corroborates.includes(r.id));
  const prev = others.filter((r) => r.at <= candidate.at).sort((a, b) => b.at - a.at || b.cum - a.cum)[0];
  const next = others.filter((r) => r.at > candidate.at).sort((a, b) => a.at - b.at || a.cum - b.cum)[0];

  const reasons: Classification["reasons"] = [];
  if (prev && cum < prev.cum) reasons.push("below_previous");
  if (next && cum > next.cum) reasons.push("above_next");
  if (reasons.length) return { status: "conflict", reasons, corroborates };

  const tooFar = (a: { at: number; cum: number }, b: { at: number; cum: number }) => {
    const days = Math.max(1, Math.abs(b.at - a.at) / 86_400_000);
    return Math.abs(b.cum - a.cum) > cfg.maxPerDay * days;
  };
  const me = { at: candidate.at, cum };
  if ((prev && tooFar(prev, me)) || (next && tooFar(me, next))) return { status: "warning", reasons: ["daily_distance"], corroborates };
  return { status: "valid", reasons: [], corroborates };
}

/** ODO-007: current odometer = latest trusted reading by event time (cumulative and raw). */
export function currentOdometer(readings: readonly Reading[], replacements: readonly Replacement[]) {
  const last = readings.filter((r) => isTrusted(r.status)).sort((a, b) => b.at - a.at)[0];
  return last ? { value: last.value, cumulative: cumulative(last.value, last.at, replacements), at: last.at } : null;
}

export type Quality = "reliable" | "estimated" | "partial" | "unavailable";
export interface Measured { value: number | null; quality: Quality }

/**
 * Valid distance in [from, to] (KPI rules §26.1): from trusted readings only. Starts at the last
 * trusted reading at/before `from` (else the first inside the period → Partial). A Conflict reading
 * inside the period also makes it Partial (US-E16-04). No usable pair → Unavailable.
 */
export function validDistance(readings: readonly Reading[], replacements: readonly Replacement[], from: number, to: number): Measured {
  const trusted = readings.filter((r) => isTrusted(r.status)).map((r) => ({ ...r, cum: cumulative(r.value, r.at, replacements) })).sort((a, b) => a.at - b.at);
  const before = trusted.filter((r) => r.at <= from).pop();
  const inside = trusted.filter((r) => r.at > from && r.at <= to);
  const start = before ?? inside[0];
  const end = [...(before ? [before] : []), ...inside].pop();
  if (!start || !end || end === start) return { value: null, quality: "unavailable" };
  const conflicts = readings.some((r) => r.status === "conflict" && r.at > from && r.at <= to);
  return { value: end.cum - start.cum, quality: !before || conflicts ? "partial" : "reliable" };
}
