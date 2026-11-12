import { POLICIES, type PolicyKey, type PolicyValues } from "@fleet/config";
import type { IsoDate } from "./dates.js";

export interface PolicyVersion { key: string; value: number; effectiveFrom: IsoDate; createdAt: number }

/**
 * GEN-007: the value in force on a local date = the version with the latest Effective From on or before that date
 * (a later entry for the same date replaces an earlier one); before any version, the catalog default.
 */
export function policyAt(versions: readonly PolicyVersion[], key: PolicyKey, date: IsoDate): number {
  const def = POLICIES.find((p) => p.key === key)!.default;
  const v = versions.filter((x) => x.key === key && x.effectiveFrom <= date)
    .sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? b.createdAt - a.createdAt : b.effectiveFrom.localeCompare(a.effectiveFrom)))[0];
  return v ? v.value : def;
}

export function policiesAt(versions: readonly PolicyVersion[], date: IsoDate): PolicyValues {
  return Object.fromEntries(POLICIES.map((p) => [p.key, policyAt(versions, p.key, date)])) as PolicyValues;
}

/** A change takes effect from today or later; an earlier date is retroactive and needs an explicit decision. */
export function checkPolicyChange(key: string, value: number, effectiveFrom: IsoDate, today: IsoDate, retroactive: boolean): string | null {
  const def = POLICIES.find((p) => p.key === key);
  if (!def) return "unknown_policy";
  if (!(value >= def.min && value <= def.max)) return "out_of_range";
  if (effectiveFrom < today && !retroactive) return "effective_from_in_past";
  return null;
}

/** The thresholds the fuel and odometer rules take, from policy values. */
export const fuelRuleConfig = (p: PolicyValues) => ({
  tankTol: p.fuel_tank_tolerance_pct / 100, priceTol: p.fuel_price_tolerance_pct / 100,
  officialTol: p.fuel_official_price_tolerance_pct / 100, dupMinutes: p.fuel_duplicate_window_min,
});
