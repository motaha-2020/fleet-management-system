import { DEFAULTS } from "./defaults.js";

/**
 * GEN-007 / US-E03-03: thresholds a company may set for itself, effective-dated. Each change is a new version
 * with an Effective From date; records are always judged by the version in force at their event time, so a
 * change never alters past evaluations unless it is made retroactive explicitly (with a recalculation).
 */
export interface PolicyDef {
  key: string;
  default: number;
  min: number;
  max: number;
  unit: "percent" | "minutes" | "km_per_day";
  name: { ar: string; en: string };
}

export const POLICIES = [
  { key: "fuel_tank_tolerance_pct", default: DEFAULTS.FUEL_TANK_TOLERANCE * 100, min: 0, max: 20, unit: "percent", name: { ar: "هامش سعة الخزان", en: "Tank capacity tolerance" } },
  { key: "fuel_price_tolerance_pct", default: DEFAULTS.FUEL_PRICE_TOLERANCE * 100, min: 1, max: 50, unit: "percent", name: { ar: "هامش سعر اللتر (بدون سعر رسمي)", en: "Unit price tolerance (no official price)" } },
  { key: "fuel_official_price_tolerance_pct", default: DEFAULTS.FUEL_OFFICIAL_PRICE_TOLERANCE * 100, min: 0.5, max: 10, unit: "percent", name: { ar: "هامش السعر الرسمي", en: "Official price tolerance" } },
  { key: "fuel_duplicate_window_min", default: DEFAULTS.FUEL_DUPLICATE_WINDOW_MINUTES, min: 5, max: 240, unit: "minutes", name: { ar: "نافذة كشف التفويلة المكررة", en: "Duplicate fuel window" } },
  { key: "odo_max_km_per_day", default: DEFAULTS.ODO_MAX_KM_PER_DAY, min: 100, max: 5000, unit: "km_per_day", name: { ar: "أقصى مسافة يومية قبل التحذير", en: "Max daily distance before a warning" } },
] as const satisfies readonly PolicyDef[];

export type PolicyKey = (typeof POLICIES)[number]["key"];
export type PolicyValues = Record<PolicyKey, number>;
