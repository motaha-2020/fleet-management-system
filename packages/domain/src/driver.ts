import { daysBetween, type IsoDate } from "./dates.js";
import { toWesternDigits } from "./vehicle.js";

export const EMPLOYMENT_STATUSES = ["active", "suspended", "terminated"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

/**
 * Egyptian national ID: 14 digits = century (2=1900s, 3=2000s) + YYMMDD + governorate (2) + serial (4) + check (1).
 * Validates structure and birth date; the check digit algorithm is not public, so it is not verified.
 */
export function normalizeEgyptianNationalId(input: string): string {
  return toWesternDigits(input).replace(/[\s-]/g, "");
}

export function isValidEgyptianNationalId(id: string): boolean {
  if (!/^[23]\d{13}$/.test(id)) return false;
  const year = (id[0] === "2" ? 1900 : 2000) + Number(id.slice(1, 3));
  const month = Number(id.slice(3, 5));
  const day = Number(id.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return false;
  const gov = Number(id.slice(7, 9));
  return (gov >= 1 && gov <= 35) || gov === 88;
}

/** US-E06-04 masking: first digit and last two, e.g. 2**********15. */
export function maskNationalId(id: string): string {
  if (id.length < 4) return "*".repeat(id.length);
  return id[0] + "*".repeat(id.length - 3) + id.slice(-2);
}

export type EligibilityReason = "employment_suspended" | "employment_terminated" | "license_missing" | "license_expired" | "license_category";

export interface Eligibility { status: "eligible" | "restricted"; reasons: EligibilityReason[] }

/**
 * Driver eligibility for operating vehicles (DRV-003..005, US-E06-02). Readiness (M4) will add
 * documents and vehicle checks on top. `requiredCategory` checks a specific vehicle's requirement.
 */
export function driverEligibility(
  d: { employmentStatus: EmploymentStatus; licenseExpiry: IsoDate | null; licenseCategories: readonly string[] },
  today: IsoDate,
  graceDays = 0,
  requiredCategory?: string,
): Eligibility {
  const reasons: EligibilityReason[] = [];
  if (d.employmentStatus === "suspended") reasons.push("employment_suspended");
  if (d.employmentStatus === "terminated") reasons.push("employment_terminated");
  if (!d.licenseExpiry) reasons.push("license_missing");
  else if (daysBetween(today, d.licenseExpiry) < -graceDays) reasons.push("license_expired");
  if (requiredCategory && !d.licenseCategories.includes(requiredCategory)) reasons.push("license_category");
  return { status: reasons.length ? "restricted" : "eligible", reasons };
}
