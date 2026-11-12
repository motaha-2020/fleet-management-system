import type { DocumentTypeDef, DriverVisibility } from "@fleet/config";
import { daysBetween, type IsoDate } from "./dates.js";

export const DOCUMENT_STATUSES = ["draft", "pending", "verified", "rejected", "superseded"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type Validity = "valid" | "expiring" | "expired" | "no_expiry";

/**
 * DOC-004: validity is computed from dates and is independent of verification status.
 * "expiring" starts at the first lead time (D-DOC-LEAD); "expired" after the grace period (D-DOC-GRACE).
 */
export function documentValidity(expiry: IsoDate | null, today: IsoDate, leadDays: readonly number[], graceDays = 0): Validity {
  if (!expiry) return "no_expiry";
  const left = daysBetween(today, expiry);
  if (left < -graceDays) return "expired";
  if (left < 0) return "expiring"; // inside the grace period
  return left <= Math.max(0, ...leadDays) ? "expiring" : "valid";
}

/** Allowed verification transitions (DOC-003). */
const NEXT: Record<DocumentStatus, readonly DocumentStatus[]> = {
  draft: ["pending"],
  pending: ["verified", "rejected"],
  verified: ["superseded"],
  rejected: [],
  superseded: [],
};
export const canTransitionDocument = (from: DocumentStatus, to: DocumentStatus) => NEXT[from].includes(to);

export interface CustomDocumentType extends DocumentTypeDef { source: "company"; active: boolean }
export interface EffectiveDocumentType extends DocumentTypeDef { source: "country" | "company"; active: boolean; countryMandatory: boolean }
export interface TypeSetting { code: string; mandatory: boolean | null; driverVisibility: DriverVisibility | null }

/**
 * GEN-008 precedence: Country Mandatory > Company Config. The company may make a country
 * type mandatory or change who can see it, but never make a mandatory country type optional.
 */
export function effectiveDocumentTypes(
  country: readonly DocumentTypeDef[],
  settings: readonly TypeSetting[],
  custom: readonly CustomDocumentType[],
): EffectiveDocumentType[] {
  const byCode = new Map(settings.map((s) => [s.code, s]));
  const fromCountry = country.map((t): EffectiveDocumentType => {
    const s = byCode.get(t.code);
    return {
      ...t,
      source: "country",
      active: true,
      countryMandatory: t.mandatory,
      mandatory: t.mandatory || s?.mandatory === true,
      driverVisibility: t.sensitive ? "none" : (s?.driverVisibility ?? t.driverVisibility),
    };
  });
  return [...fromCountry, ...custom.map((c) => ({ ...c, countryMandatory: false }))];
}

/** Returns an error code if the company setting would relax a country rule. */
export function checkTypeSetting(type: DocumentTypeDef, setting: { mandatory?: boolean | null; driverVisibility?: DriverVisibility | null }): string | null {
  if (type.mandatory && setting.mandatory === false) return "country_mandatory";
  if (type.sensitive && setting.driverVisibility && setting.driverVisibility !== "none") return "sensitive_not_visible";
  return null;
}

/** Driver access to a document by its type's visibility (DOC-007): view and download are separate. */
export function driverCan(visibility: DriverVisibility, what: "view" | "download"): boolean {
  return what === "view" ? visibility !== "none" : visibility === "download";
}
