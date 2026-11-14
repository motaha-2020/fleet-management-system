import { describe, expect, it } from "vitest";
import { EGYPT, RBAC_MATRIX } from "@fleet/config";
import {
  assignmentConflicts, assignmentBlocks, custodyTimeline, classifyReading, cumulative, currentOdometer, validDistance,
  fuelFlags, initialFuelStatus, fullToFullCycles, consumption, reportedCost, costPerKm, money,
  isFinancialCorrection, canApproveCorrection, type AssignmentLike, type CycleEntry, type Reading, type FuelCheckInput,
} from "./index.js";

const day = 86_400_000;
const T = (iso: string) => Date.parse(iso);

describe("assignments (US-E07-01)", () => {
  const base: AssignmentLike = { id: "a1", vehicleId: "v1", driverId: "d1", role: "primary", start: T("2026-03-01T00:00:00Z"), end: null };
  it("rejects a second primary on the same vehicle with an overlapping period", () => {
    expect(assignmentConflicts({ vehicleId: "v1", driverId: "d2", role: "primary", start: T("2026-03-10T00:00:00Z"), end: null }, [base]))
      .toEqual([{ kind: "vehicle_primary", withId: "a1" }]);
  });
  it("accepts a secondary driver for the same period", () => {
    expect(assignmentConflicts({ vehicleId: "v1", driverId: "d2", role: "secondary", start: T("2026-03-10T00:00:00Z"), end: null }, [base])).toEqual([]);
  });
  it("a driver is primary on one vehicle at a time; periods are half-open", () => {
    const ended = { ...base, end: T("2026-03-31T00:00:00Z") };
    expect(assignmentConflicts({ vehicleId: "v2", driverId: "d1", role: "primary", start: T("2026-03-15T00:00:00Z"), end: null }, [ended]))
      .toEqual([{ kind: "driver_primary", withId: "a1" }]);
    expect(assignmentConflicts({ vehicleId: "v2", driverId: "d1", role: "primary", start: T("2026-03-31T00:00:00Z"), end: null }, [ended])).toEqual([]);
  });
  it("blocks a license category mismatch (R4, no override) and inactive vehicles", () => {
    const drv = { employmentStatus: "active" as const, licenseExpiry: "2030-01-01", licenseCategories: ["PRO3"] };
    expect(assignmentBlocks({ status: "active", requiredLicenseCategory: "PRO1" }, drv, "2026-03-01")).toEqual(["license_category"]);
    expect(assignmentBlocks({ status: "inactive", requiredLicenseCategory: "PRO3" }, drv, "2026-03-01")).toEqual(["vehicle_not_active"]);
    expect(assignmentBlocks({ status: "active", requiredLicenseCategory: "PRO3" }, drv, "2026-03-01")).toEqual([]);
  });
});

describe("custody timeline (US-E07-03/04)", () => {
  it("follows assignments and handovers and shows gaps explicitly", () => {
    const a: AssignmentLike = { id: "a", vehicleId: "v", driverId: "d1", role: "primary", start: T("2026-03-02T00:00:00Z"), end: T("2026-03-06T00:00:00Z") };
    const segs = custodyTimeline([a], [{ at: T("2026-03-04T08:00:00Z"), fromDriverId: "d1", toDriverId: "d2" }], T("2026-03-01T00:00:00Z"), T("2026-03-08T00:00:00Z"));
    expect(segs.map((s) => [new Date(s.start).toISOString().slice(0, 13), s.driverId, s.source])).toEqual([
      ["2026-03-01T00", null, "gap"],
      ["2026-03-02T00", "d1", "assignment"],
      ["2026-03-04T08", "d2", "handover"],
    ]);
    // d2 keeps custody after d1's assignment ends (d1 no longer holds it)
    expect(segs[2]!.end).toBe(T("2026-03-08T00:00:00Z"));
  });
  it("custody ends with the holder's assignment", () => {
    const a: AssignmentLike = { id: "a", vehicleId: "v", driverId: "d1", role: "primary", start: T("2026-03-02T00:00:00Z"), end: T("2026-03-05T00:00:00Z") };
    const segs = custodyTimeline([a], [], T("2026-03-01T00:00:00Z"), T("2026-03-07T00:00:00Z"));
    expect(segs.map((s) => s.driverId)).toEqual([null, "d1", null]);
  });
});

describe("odometer ledger (E08)", () => {
  const r = (id: string, value: number, iso: string, status: Reading["status"] = "valid", source = "manual"): Reading => ({ id, value, at: T(iso), status, source });
  it("US-E08-02: a lower reading after a valid one is a Conflict", () => {
    const c = classifyReading({ value: 49_800, at: T("2026-03-03T10:00:00Z"), source: "fuel" }, [r("a", 50_000, "2026-03-01T10:00:00Z")], []);
    expect(c).toMatchObject({ status: "conflict", reasons: ["below_previous"] });
  });
  it("US-E08-02: a late reading above a later valid one is a Conflict", () => {
    const c = classifyReading({ value: 52_000, at: T("2026-03-02T10:00:00Z"), source: "fuel" }, [r("a", 50_000, "2026-03-01T10:00:00Z"), r("b", 51_000, "2026-03-03T10:00:00Z")], []);
    expect(c.reasons).toEqual(["above_next"]);
  });
  it("US-E08-03: 1,800 km in one day is a Warning, not a Conflict", () => {
    const c = classifyReading({ value: 51_800, at: T("2026-03-02T10:00:00Z"), source: "manual" }, [r("a", 50_000, "2026-03-01T10:00:00Z")], []);
    expect(c).toMatchObject({ status: "warning", reasons: ["daily_distance"] });
  });
  it("US-E08-04: two readings within 2 km and 10 minutes from different sources corroborate", () => {
    const c = classifyReading({ value: 49_999, at: T("2026-03-01T10:05:00Z"), source: "handover" }, [r("a", 50_000, "2026-03-01T10:00:00Z", "valid", "fuel")], []);
    expect(c).toEqual({ status: "valid", reasons: [], corroborates: ["a"] });
  });
  it("US-E08-05: meter replacement continues the scale (180,000 → 0 → 500 = +500, no conflict)", () => {
    const reps = [{ at: T("2026-03-10T00:00:00Z"), oldFinal: 180_000, newStart: 0 }];
    const existing = [r("a", 179_900, "2026-03-09T00:00:00Z")];
    const c = classifyReading({ value: 500, at: T("2026-03-11T00:00:00Z"), source: "manual" }, existing, reps);
    expect(c.status).toBe("valid");
    expect(cumulative(500, T("2026-03-11T00:00:00Z"), reps)).toBe(180_500);
    const d = validDistance([...existing, r("b", 500, "2026-03-11T00:00:00Z")], reps, T("2026-03-09T00:00:00Z"), T("2026-03-12T00:00:00Z"));
    expect(d).toEqual({ value: 600, quality: "reliable" });
  });
  it("conflicts are excluded from current odometer and make distance Partial (ODO-006, US-E16-04)", () => {
    const rs = [r("a", 50_000, "2026-03-01T00:00:00Z"), r("b", 49_000, "2026-03-05T00:00:00Z", "conflict"), r("c", 50_900, "2026-03-09T00:00:00Z")];
    expect(currentOdometer(rs, [])?.value).toBe(50_900);
    expect(validDistance(rs, [], T("2026-03-01T00:00:00Z"), T("2026-03-31T00:00:00Z"))).toEqual({ value: 900, quality: "partial" });
  });
  it("Worked Example E3: all readings Conflict → distance Unavailable", () => {
    const rs = [r("a", 1, "2026-03-02T00:00:00Z", "conflict"), r("b", 2, "2026-03-05T00:00:00Z", "conflict")];
    expect(validDistance(rs, [], T("2026-03-01T00:00:00Z"), T("2026-03-31T00:00:00Z"))).toEqual({ value: null, quality: "unavailable" });
  });
});

describe("fuel flags (E09)", () => {
  const vehicle = { primaryFuelType: "PET92", primaryTankCapacity: 60, secondaryFuelType: "CNG", secondaryTankCapacity: 15 };
  const base: FuelCheckInput = {
    vehicle, fuelType: "PET92", quantity: 40, grossMinor: 80_000, at: T("2026-03-01T10:00:00Z"),
    reference: null, nearby: [], receiptRef: null, hasAssignment: true, odometer: "valid",
  };
  it("US-E09-02: 63 L in a 60 L tank is accepted (+5%), 64 L is a Conflict", () => {
    expect(fuelFlags({ ...base, quantity: 63 })).toEqual([]);
    expect(fuelFlags({ ...base, quantity: 64 })).toEqual(["tank_exceeded"]);
  });
  it("US-E09-03: same vehicle, quantity and amount 20 minutes later is a possible duplicate; 60 minutes is not", () => {
    const nearby = [{ id: "x", at: T("2026-03-01T10:00:00Z"), quantity: 40, grossMinor: 80_000, receiptRef: null }];
    expect(fuelFlags({ ...base, at: T("2026-03-01T10:20:00Z"), nearby })).toEqual(["possible_duplicate"]);
    expect(fuelFlags({ ...base, at: T("2026-03-01T11:00:00Z"), nearby })).toEqual([]);
  });
  it("US-E09-04: wrong fuel type and price > +20% are warnings", () => {
    expect(fuelFlags({ ...base, fuelType: "DSL", quantity: 40 })).toEqual(["fuel_type_mismatch"]);
    // reference 10.00/L, paid 13.00/L
    expect(fuelFlags({ ...base, grossMinor: 52_000, reference: { priceMinor: 1_000, official: false } })).toEqual(["price_deviation"]);
    expect(fuelFlags({ ...base, grossMinor: 46_000, reference: { priceMinor: 1_000, official: false } })).toEqual([]);
  });
  it("US-E09-10: with an official price the tolerance is ±2%", () => {
    expect(fuelFlags({ ...base, grossMinor: 40_800, reference: { priceMinor: 1_000, official: true } })).toEqual([]); // +2%
    expect(fuelFlags({ ...base, grossMinor: 41_200, reference: { priceMinor: 1_000, official: true } })).toEqual(["price_deviation"]); // +3%
  });
  it("US-E09-09: CNG uses the gas tank capacity", () => {
    expect(fuelFlags({ ...base, fuelType: "CNG", quantity: 15.5, grossMinor: 10_000 })).toEqual([]);
    expect(fuelFlags({ ...base, fuelType: "CNG", quantity: 16, grossMinor: 10_000 })).toEqual(["tank_exceeded"]);
  });
  it("US-E09-05: no valid assignment is a warning → under review, never rejected", () => {
    const f = fuelFlags({ ...base, hasAssignment: false });
    expect(f).toEqual(["no_assignment"]);
    expect(initialFuelStatus(f)).toBe("under_review");
    expect(initialFuelStatus([])).toBe("accepted");
  });
});

describe("Full-to-Full (Worked Example E1, US-E09-07/09)", () => {
  const e = (id: string, km: number, q: number, full: boolean, over: Partial<CycleEntry> = {}): CycleEntry => ({
    id, at: T("2026-03-01T00:00:00Z") + km * 1000, fuelType: "PET92", quantity: q, isFull: full, status: "accepted", flags: [], odometerCum: km, odometerTrusted: true, ...over,
  });
  const E1 = [e("1", 10_000, 50, true), e("2", 10_300, 20, false), e("3", 10_600, 40, true)];
  it("E1: 60 L over 600 km = 10.0 L/100km, Reliable; entry 1 opens the cycle", () => {
    const cycles = fullToFullCycles(E1);
    expect(cycles).toEqual([expect.objectContaining({ startId: "1", endId: "3", quantity: 60, km: 600, per100: 10, quality: "reliable" })]);
    expect(consumption(cycles)).toEqual({ value: 10, quality: "reliable" });
  });
  it("E1: purchased liters (110) are separate from consumption", () => {
    expect(E1.reduce((s, x) => s + x.quantity, 0)).toBe(110);
  });
  it("E1: if entry 2 is a Conflict the cycle is Partial and not used as Reliable", () => {
    const cycles = fullToFullCycles([E1[0]!, { ...E1[1]!, flags: ["tank_exceeded"], status: "under_review" }, E1[2]!]);
    expect(cycles[0]!.quality).toBe("partial");
    expect(consumption(cycles)).toEqual({ value: null, quality: "unavailable" });
  });
  it("a single Full → consumption Unavailable", () => {
    expect(consumption(fullToFullCycles([E1[0]!]))).toEqual({ value: null, quality: "unavailable" });
  });
  it("voided entries are ignored; an untrusted boundary reading makes the cycle Partial", () => {
    expect(fullToFullCycles([E1[0]!, { ...E1[1]!, status: "voided" }, E1[2]!])[0]).toMatchObject({ quantity: 40, quality: "reliable" });
    expect(fullToFullCycles([E1[0]!, E1[1]!, { ...E1[2]!, odometerTrusted: false }])[0]!.quality).toBe("partial");
  });
  it("US-E09-09: bi-fuel cycles are computed per fuel type", () => {
    const cng = (id: string, km: number, q: number) => e(id, km, q, true, { fuelType: "CNG" });
    const cycles = fullToFullCycles([E1[0]!, cng("g1", 10_100, 10), E1[1]!, cng("g2", 10_500, 12), E1[2]!]);
    expect(cycles.map((c) => [c.fuelType, c.quantity, c.km])).toEqual([["CNG", 12, 400], ["PET92", 60, 600]]);
  });
});

describe("costs (E15, Worked Example E3)", () => {
  it("US-E15-01: insurance net 1,000 + tax 140 is stored as net/tax/gross", () => {
    expect(money(100_000, 14_000, "EGP")).toEqual({ netMinor: 100_000, taxMinor: 14_000, grossMinor: 114_000, currency: "EGP" });
    expect(() => money(10.5, 0, "EGP")).toThrow();
  });
  it("US-E15-04: fuel tax is not recoverable in Egypt → gross; maintenance VAT is → net", () => {
    expect(reportedCost({ netMinor: 80_000, grossMinor: 80_000 }, EGYPT.taxRecoverable.fuel)).toBe(80_000);
    expect(reportedCost({ netMinor: 100_000, grossMinor: 114_000 }, EGYPT.taxRecoverable.corrective)).toBe(100_000);
  });
  it("US-E15-03: 5,000 over 2,500 valid km = 2.00/km Reliable; E3: 0 km → Unavailable", () => {
    expect(costPerKm(500_000, { value: 2_500, quality: "reliable" })).toEqual({ value: 200, quality: "reliable" }); // 200 piasters = 2.00
    expect(costPerKm(500_000, { value: 0, quality: "reliable" })).toEqual({ value: null, quality: "unavailable" });
    expect(costPerKm(500_000, { value: null, quality: "unavailable" })).toEqual({ value: null, quality: "unavailable" });
  });
});

describe("corrections (E16)", () => {
  it("money fields and cost records are financial; odometer is not", () => {
    expect(isFinancialCorrection("fuel_entry", ["netMinor"])).toBe(true);
    expect(isFinancialCorrection("fuel_entry", ["odometer"])).toBe(false);
    expect(isFinancialCorrection("meter_reading", ["value"])).toBe(false);
    expect(isFinancialCorrection("cost_record", ["description"])).toBe(true);
  });
  it("PRD §5.3: fleet manager approves non-financial, finance approves financial, admin both", () => {
    expect(canApproveCorrection(RBAC_MATRIX.fleet_manager, false)).toBe(true);
    expect(canApproveCorrection(RBAC_MATRIX.fleet_manager, true)).toBe(false);
    expect(canApproveCorrection(RBAC_MATRIX.finance_reviewer, true)).toBe(true);
    expect(canApproveCorrection(RBAC_MATRIX.finance_reviewer, false)).toBe(false);
    expect(canApproveCorrection(RBAC_MATRIX.company_admin, true)).toBe(true);
    expect(canApproveCorrection(RBAC_MATRIX.driver, false)).toBe(false);
  });
});
