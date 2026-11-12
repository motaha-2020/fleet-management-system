import { describe, expect, it } from "vitest";
import { EGYPT, DEFAULTS } from "@fleet/config";
import {
  documentValidity, canTransitionDocument, effectiveDocumentTypes, checkTypeSetting, driverCan,
  canChangeVehicleStatus, canDisposeVehicle, isValidEgyptianNationalId, maskNationalId, normalizeEgyptianNationalId,
  driverEligibility, sniffMime, isIsoDate, daysBetween, localDate,
} from "./index.js";

describe("dates", () => {
  it("validates ISO dates strictly", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26-2-1")).toBe(false);
  });
  it("counts days across DST and month ends", () => {
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2);
    expect(daysBetween("2026-03-01", "2026-02-27")).toBe(-2);
  });
  it("resolves the local date in Cairo, not UTC", () => {
    expect(localDate(new Date("2026-11-11T23:30:00Z"), "Africa/Cairo")).toBe("2026-11-12");
  });
});

describe("document validity (US-E11-03)", () => {
  const lead = DEFAULTS.DOC_LEAD_DAYS;
  it("is separate from verification and follows lead times", () => {
    expect(documentValidity(null, "2026-11-12", lead)).toBe("no_expiry");
    expect(documentValidity("2027-01-01", "2026-11-12", lead)).toBe("valid");
    expect(documentValidity("2026-12-12", "2026-11-12", lead)).toBe("expiring"); // 30 days
    expect(documentValidity("2026-12-13", "2026-11-12", lead)).toBe("valid");
    expect(documentValidity("2026-11-12", "2026-11-12", lead)).toBe("expiring"); // last day
    expect(documentValidity("2026-11-11", "2026-11-12", lead)).toBe("expired");
  });
  it("applies a grace period", () => {
    expect(documentValidity("2026-11-10", "2026-11-12", lead, 3)).toBe("expiring");
    expect(documentValidity("2026-11-08", "2026-11-12", lead, 3)).toBe("expired");
  });
  it("only allows the DOC-003 transitions", () => {
    expect(canTransitionDocument("pending", "verified")).toBe(true);
    expect(canTransitionDocument("verified", "superseded")).toBe(true);
    expect(canTransitionDocument("draft", "verified")).toBe(false);
    expect(canTransitionDocument("rejected", "pending")).toBe(false);
  });
});

describe("document type precedence (GEN-008, US-E03-02)", () => {
  const vehLicense = EGYPT.documentTypes.find((t) => t.code === "EG_VEH_LICENSE")!;
  const comprehensive = EGYPT.documentTypes.find((t) => t.code === "EG_VEH_INS_COMPREHENSIVE")!;
  const drug = EGYPT.documentTypes.find((t) => t.code === "EG_DRV_DRUG_TEST")!;
  it("rejects making a country-mandatory type optional", () => {
    expect(checkTypeSetting(vehLicense, { mandatory: false })).toBe("country_mandatory");
    expect(checkTypeSetting(comprehensive, { mandatory: true })).toBeNull();
  });
  it("never lets drivers see sensitive types", () => {
    expect(checkTypeSetting(drug, { driverVisibility: "view" })).toBe("sensitive_not_visible");
  });
  it("merges company settings and custom types; a setting cannot relax country rules", () => {
    const eff = effectiveDocumentTypes(EGYPT.documentTypes, [
      { code: "EG_VEH_INS_COMPREHENSIVE", mandatory: true, driverVisibility: "download" },
      { code: "EG_VEH_LICENSE", mandatory: false, driverVisibility: null },
    ], [{ code: "C_GPS_CERT", entityType: "vehicle", name: { ar: "شهادة GPS", en: "GPS cert" }, mandatory: true, hasExpiry: true, risk: "R1", driverVisibility: "none", sensitive: false, source: "company", active: true }]);
    const get = (c: string) => eff.find((t) => t.code === c)!;
    expect(get("EG_VEH_INS_COMPREHENSIVE")).toMatchObject({ mandatory: true, driverVisibility: "download", countryMandatory: false });
    expect(get("EG_VEH_LICENSE").mandatory).toBe(true);
    expect(get("C_GPS_CERT").source).toBe("company");
  });
  it("separates view from download (DOC-007)", () => {
    expect(driverCan("view", "view")).toBe(true);
    expect(driverCan("view", "download")).toBe(false);
    expect(driverCan("download", "download")).toBe(true);
    expect(driverCan("none", "view")).toBe(false);
  });
});

describe("vehicle lifecycle (VEH-003)", () => {
  it("allows only the defined transitions", () => {
    expect(canChangeVehicleStatus("draft", "active")).toBe(true);
    expect(canChangeVehicleStatus("active", "inactive")).toBe(true);
    expect(canChangeVehicleStatus("inactive", "active")).toBe(true);
    expect(canChangeVehicleStatus("active", "draft")).toBe(false);
    expect(canChangeVehicleStatus("disposed", "active")).toBe(false);
    expect(canDisposeVehicle("draft")).toBe(false);
    expect(canDisposeVehicle("inactive")).toBe(true);
  });
});

describe("drivers (DRV-001, DRV-007, US-E06-02)", () => {
  it("validates Egyptian national IDs", () => {
    expect(isValidEgyptianNationalId("29001011234567")).toBe(true);
    expect(isValidEgyptianNationalId("29002301234567")).toBe(false); // Feb 30
    expect(isValidEgyptianNationalId("19001011234567")).toBe(false);
    expect(isValidEgyptianNationalId("2900101123456")).toBe(false);
    expect(normalizeEgyptianNationalId("٢٩٠٠١٠١ ١٢٣٤٥٦٧")).toBe("29001011234567");
  });
  it("masks as in the acceptance criteria", () => {
    expect(maskNationalId("29001011234515")).toBe("2***********15");
  });
  it("suspended driver is restricted with a clear reason", () => {
    const e = driverEligibility({ employmentStatus: "suspended", licenseExpiry: "2030-01-01", licenseCategories: ["PRO3"] }, "2026-11-12");
    expect(e).toEqual({ status: "restricted", reasons: ["employment_suspended"] });
  });
  it("license expiring today is still valid; yesterday is expired", () => {
    const base = { employmentStatus: "active" as const, licenseCategories: ["PRO3"] };
    expect(driverEligibility({ ...base, licenseExpiry: "2026-11-12" }, "2026-11-12").status).toBe("eligible");
    expect(driverEligibility({ ...base, licenseExpiry: "2026-11-11" }, "2026-11-12").reasons).toEqual(["license_expired"]);
    expect(driverEligibility({ ...base, licenseExpiry: "2030-01-01" }, "2026-11-12", 0, "PRO1").reasons).toEqual(["license_category"]);
  });
});

describe("file sniffing (US-E11-02)", () => {
  it("detects by magic bytes, not by name", () => {
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMime(new TextEncoder().encode("MZ executable"))).toBeNull();
  });
});
