import { describe, expect, it } from "vitest";
import {
  budgetThreshold, budgetVariance, canTransitionAlert, dedupKey, leadLevel, leadSeverity, pickOwner, reconcileAlerts, type DesiredAlert,
} from "./index.js";

const want = (key: string, over: Partial<DesiredAlert> = {}): DesiredAlert => ({
  dedupKey: key, type: "doc_expired", severity: "high", level: 0, entityType: "vehicle", entityId: "v1", branchId: "b1", subject: null, params: {}, ...over,
});

describe("E13 alerts", () => {
  it("US-E13-01: the daily scan does not create a second alert for an open cause", () => {
    const key = dedupKey("doc_expired", "v1", "EG_VEH_LICENSE");
    const first = reconcileAlerts([want(key)], [], ["doc_expired"]);
    expect(first.create).toHaveLength(1);
    const again = reconcileAlerts([want(key)], [{ id: "a1", dedupKey: key, type: "doc_expired", severity: "high", level: 0 }], ["doc_expired"]);
    expect(again).toEqual({ create: [], escalate: [], resolve: [] });
  });

  it("DOC-009: 30 → 14 → 7 days escalates the same alert instead of creating new ones", () => {
    const leads = [30, 14, 7];
    expect([31, 30, 20, 14, 10, 7, 1].map((d) => leadLevel(d, leads))).toEqual([null, 30, 30, 14, 14, 7, 7]);
    expect(leads.map((l) => leadSeverity(l, leads))).toEqual(["low", "medium", "high"]);
    const key = dedupKey("doc_expiring", "v1", "EG_VEH_LICENSE");
    const r = reconcileAlerts([want(key, { type: "doc_expiring", severity: "medium", level: 14 })], [{ id: "a1", dedupKey: key, type: "doc_expiring", severity: "low", level: 30 }], ["doc_expiring"]);
    expect(r.create).toEqual([]);
    expect(r.escalate).toEqual([{ id: "a1", to: expect.objectContaining({ severity: "medium", level: 14 }) }]);
  });

  it("US-E13-03 / ALR-004: a cause that is gone auto-resolves; types not scanned are left alone", () => {
    const active = [
      { id: "a1", dedupKey: "doc_expired:v1:X", type: "doc_expired", severity: "high" as const, level: 0 },
      { id: "a2", dedupKey: "defect_rejected:d1", type: "defect_rejected", severity: "low" as const, level: 0 },
    ];
    expect(reconcileAlerts([], active, ["doc_expired"]).resolve.map((a) => a.id)).toEqual(["a1"]);
  });

  it("US-E13-02: Acknowledged is not Resolved; Closed only after Resolved", () => {
    expect(canTransitionAlert("open", "acknowledged")).toBe(true);
    expect(canTransitionAlert("acknowledged", "closed")).toBe(false);
    expect(canTransitionAlert("resolved", "closed")).toBe(true);
    expect(canTransitionAlert("closed", "open")).toBe(false);
  });

  it("US-E13-02 / ALR-005: a disabled primary owner falls back to the escalation owner", () => {
    const members = [
      { identityId: "fm-off", role: "fleet_manager", branchIds: ["b1"], active: false },
      { identityId: "fm-b2", role: "fleet_manager", branchIds: ["b2"], active: true },
      { identityId: "ca", role: "company_admin", branchIds: [], active: true },
    ];
    expect(pickOwner(members, "fleet_manager", "b1")).toEqual({ ownerId: "ca", escalationOwnerId: "ca", fellBack: true });
    expect(pickOwner(members, "fleet_manager", "b2")).toEqual({ ownerId: "fm-b2", escalationOwnerId: "ca", fellBack: false });
  });

  it("FUEL-015: budget thresholds 80% / 100% and the variance KPI", () => {
    expect(budgetThreshold(7_900, 10_000, [80, 100])).toBeNull();
    expect(budgetThreshold(8_000, 10_000, [80, 100])).toBe(80);
    expect(budgetThreshold(12_000, 10_000, [80, 100])).toBe(100);
    expect(budgetThreshold(1, 0, [80, 100])).toBeNull();
    expect(budgetVariance(12_000, 10_000)).toEqual({ amount: 2_000, percent: 20 });
  });
});

import { availability, consumption, costPerKm, dataCoverage, documentCompliance, fullToFullCycles, maintenanceCompliance, maintenanceOnTime, overlapHours, percent, syncSuccess } from "./index.js";

describe("US-E18-04: KPI dictionary conformance (PRD §26.1, Gap Analysis Annex E)", () => {
  it("E1 Full-to-Full = 10.0 L/100 km; a conflicting partial makes the cycle Partial", () => {
    const e = (id: string, odo: number, q: number, full: boolean, flags: string[] = []) => ({ id, at: odo, fuelType: "PET92", quantity: q, isFull: full, status: "accepted" as const, flags, odometerCum: odo, odometerTrusted: true });
    expect(consumption(fullToFullCycles([e("1", 10_000, 50, true), e("2", 10_300, 20, false), e("3", 10_600, 40, true)]))).toEqual({ value: 10, quality: "reliable" });
    const bad = fullToFullCycles([e("1", 10_000, 50, true), e("2", 10_300, 20, false, ["odometer_conflict"]), e("3", 10_600, 40, true)]);
    expect(bad[0]!.quality).toBe("partial");
    expect(consumption(bad)).toEqual({ value: null, quality: "unavailable" });
  });
  it("E3 cost/km with no valid distance is Unavailable, not 0 or ∞", () => {
    expect(costPerKm(500_000, { value: null, quality: "unavailable" })).toEqual({ value: null, quality: "unavailable" });
    expect(costPerKm(500_000, { value: 0, quality: "reliable" }).value).toBeNull();
  });
  it("compliance, availability, coverage and sync rates; zero denominators are Unavailable", () => {
    expect(documentCompliance([{ mandatory: true, ok: true }, { mandatory: true, ok: false }, { mandatory: false, ok: false }])).toEqual({ value: 50, quality: "reliable" });
    expect(documentCompliance([])).toEqual({ value: null, quality: "unavailable" });
    expect(maintenanceOnTime({ date: "2026-01-01", km: 40_000 }, { km: 10_000, months: 6 }, { date: "2026-06-30", km: 49_000 })).toBe(true);
    expect(maintenanceOnTime({ date: "2026-01-01", km: 40_000 }, { km: 10_000, months: 6 }, { date: "2026-07-02", km: 45_000 })).toBe(false);
    expect(maintenanceOnTime({ date: "2026-01-01", km: 40_000 }, { km: 10_000, months: 6 }, { date: "2026-03-01", km: 50_100 })).toBe(false);
    expect(maintenanceCompliance(3, 1, 0)).toEqual({ value: 75, quality: "reliable" });
    expect(availability(720, 36)).toEqual({ value: 95, quality: "reliable" });
    expect(availability(0, 0).quality).toBe("unavailable");
    const h = 3_600_000;
    expect(overlapHours(0, 10 * h, 5 * h, 20 * h)).toBe(5);
    expect(overlapHours(0, null, 5 * h, 20 * h)).toBe(15);
    expect(dataCoverage(["reliable", "partial", "reliable", "unavailable"])).toEqual({ value: 50, quality: "reliable" });
    expect(syncSuccess(97, 100).value).toBe(97);
    expect(percent(1, 3).value).toBe(33.3);
  });
});
