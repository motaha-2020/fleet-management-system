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
