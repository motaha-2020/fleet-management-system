import { describe, expect, it } from "vitest";
import {
  maintenanceDue, addMonths, effectiveInterval, templateMatches, worstStatus,
  canTransitionDefect, canTransitionWorkOrder, downtimeMs, invoiceAllocation,
  evaluateReadiness, checkRuleSetting, checkOverride, blockingReasons, type ReadinessInput, type DocState,
} from "./index.js";

describe("maintenance due (US-E10-01..03)", () => {
  const oil = { km: 10_000, months: 6 };
  const base = { cumKm: 40_000, date: "2026-01-01", estimated: false };
  it("US-E10-02: 49,600 km on 1 March → Upcoming (400 km left)", () => {
    const d = maintenanceDue(oil, base, { date: "2026-03-01", cumKm: 49_600, kmPerDay: null });
    expect(d).toMatchObject({ status: "upcoming", dueKm: 50_000, dueDate: "2026-07-01", remainingKm: 400, quality: "reliable" });
  });
  it("US-E10-02: 2 July with only 45,000 km → Overdue (the date came first)", () => {
    expect(maintenanceDue(oil, base, { date: "2026-07-02", cumKm: 45_000, kmPerDay: null }).status).toBe("overdue");
  });
  it("is Due exactly at the due point and Overdue past it", () => {
    expect(maintenanceDue(oil, base, { date: "2026-03-01", cumKm: 50_000, kmPerDay: null }).status).toBe("due");
    expect(maintenanceDue(oil, base, { date: "2026-03-01", cumKm: 50_001, kmPerDay: null }).status).toBe("overdue");
    expect(maintenanceDue(oil, base, { date: "2026-02-01", cumKm: 41_000, kmPerDay: null }).status).toBe("ok");
  });
  it("US-E10-03: no previous service → Unknown baseline with no due date", () => {
    expect(maintenanceDue(oil, null, { date: "2026-03-01", cumKm: 49_600, kmPerDay: 50 })).toMatchObject({ status: "unknown_baseline", dueDate: null, quality: "unavailable" });
  });
  it("US-E10-03: a baseline on a conflicting reading gives an Estimated forecast", () => {
    expect(maintenanceDue(oil, { ...base, estimated: true }, { date: "2026-03-01", cumKm: 45_000, kmPerDay: null }).quality).toBe("estimated");
  });
  it("forecasts from recent movement and takes the earlier of km and date", () => {
    // 5,000 km left at 100 km/day → 50 days → 20 April, before 1 July
    expect(maintenanceDue(oil, base, { date: "2026-03-01", cumKm: 45_000, kmPerDay: 100 }).forecastDate).toBe("2026-04-20");
    expect(maintenanceDue(oil, base, { date: "2026-03-01", cumKm: 45_000, kmPerDay: 10 }).forecastDate).toBe("2026-07-01");
  });
  it("adds months with end-of-month clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-08-15", 6)).toBe("2027-02-15");
  });
  it("US-E10-01: a vehicle override replaces the template interval for that vehicle only", () => {
    expect(effectiveInterval({ km: 10_000, months: 6 }, { km: 7_500 })).toEqual({ km: 7_500, months: 6 });
    expect(effectiveInterval({ km: 10_000, months: 6 }, null)).toEqual({ km: 10_000, months: 6 });
  });
  it("matches the most specific template", () => {
    const v = { make: "Toyota", model: "Hiace" };
    expect(templateMatches({ make: null, model: null }, v)).toBe(0);
    expect(templateMatches({ make: "toyota", model: null }, v)).toBe(2);
    expect(templateMatches({ make: "Toyota", model: "Hiace" }, v)).toBe(3);
    expect(templateMatches({ make: "Isuzu", model: null }, v)).toBe(-1);
    expect(worstStatus(["ok", "upcoming", "overdue", "due"])).toBe("overdue");
  });
});

describe("defects, work orders, visits (US-E10-04..07)", () => {
  it("follows the state machines", () => {
    expect(canTransitionDefect("reported", "triaged")).toBe(true);
    expect(canTransitionDefect("triaged", "converted")).toBe(true);
    expect(canTransitionDefect("converted", "rejected")).toBe(false);
    expect(canTransitionWorkOrder("open", "in_progress")).toBe(true);
    expect(canTransitionWorkOrder("completed", "closed")).toBe(true);
    expect(canTransitionWorkOrder("completed", "cancelled")).toBe(false);
    expect(canTransitionWorkOrder("closed", "open")).toBe(false);
  });
  it("US-E10-07: invoice 1,000 with breakdown 400 + 500 → 100 unallocated; a larger breakdown is refused", () => {
    expect(invoiceAllocation(100_000, 40_000, 50_000, null)).toEqual({ ok: true, allocated: 90_000, unallocated: 10_000 });
    expect(invoiceAllocation(100_000, 60_000, 50_000, null).ok).toBe(false);
  });
  it("US-E10-06: downtime runs from off-road to return to service", () => {
    expect(downtimeMs(1_000, 4_600_000, 9_999_999)).toBe(4_599_000);
    expect(downtimeMs(1_000, null, 2_000)).toBe(1_000);
    expect(downtimeMs(null, null, 2_000)).toBe(0);
  });
});

describe("readiness (E12)", () => {
  const today = "2026-11-12";
  const now = Date.parse("2026-11-12T10:00:00Z");
  const vehicle = (over: Partial<NonNullable<ReadinessInput["vehicle"]>> = {}): NonNullable<ReadinessInput["vehicle"]> => ({
    id: "v1", status: "active", requiredLicenseCategory: "PRO3", documents: [], maintenance: [], notDrivableWorkOrder: false, notDrivableDefect: false, ...over,
  });
  const driver = (over: Partial<NonNullable<ReadinessInput["driver"]>> = {}): NonNullable<ReadinessInput["driver"]> => ({
    id: "d1", employmentStatus: "active", licenseExpiry: "2030-01-01", licenseCategories: ["PRO3"], documents: [], ...over,
  });
  const doc = (typeCode: string, risk: DocState["risk"], current: DocState["current"], mandatory = true): DocState => ({ typeCode, risk, mandatory, current });

  it("US-E12-02: pending R2 driver document + expired R4 insurance → Restricted, with every reason", () => {
    const r = evaluateReadiness({
      today, now,
      vehicle: vehicle({ documents: [doc("EG_VEH_INS_MANDATORY", "R4", { status: "verified", validity: "expired" })] }),
      driver: driver({ documents: [doc("EG_DRV_NATIONAL_ID", "R2", { status: "pending", validity: "valid" })] }),
    });
    expect(r.outcome).toBe("restricted");
    expect(r.reasons.map((x) => [x.code, x.risk, x.outcome])).toEqual([
      ["doc_expired", "R4", "restricted"], ["doc_pending", "R2", "warning"],
    ]);
  });
  it("US-E12-02: only an R2 finding → Allowed with Warning", () => {
    expect(evaluateReadiness({ today, now, driver: driver({ documents: [doc("X", "R2", { status: "pending", validity: "valid" })] }) }).outcome).toBe("warning");
  });
  it("US-E12-04: optional missing → nothing; mandatory missing is 'missing mandatory evidence' at the configured risk", () => {
    expect(evaluateReadiness({ today, now, vehicle: vehicle({ documents: [doc("OPT", "R4", null, false)] }) })).toEqual({ outcome: "allowed", reasons: [] });
    const missing = { today, now, vehicle: vehicle({ documents: [doc("EG_VEH_LICENSE", "R4", null)] }) };
    expect(evaluateReadiness(missing).outcome).toBe("warning"); // default R2
    expect(evaluateReadiness({ ...missing, settings: { doc_missing: "R4" } })).toMatchObject({ outcome: "restricted", reasons: [{ code: "doc_missing", risk: "R4" }] });
  });
  it("US-E12-04: the restriction goes away when the document is verified and re-evaluated", () => {
    const after = evaluateReadiness({ today, now, vehicle: vehicle({ documents: [doc("EG_VEH_LICENSE", "R4", { status: "verified", validity: "valid" })] }), settings: { doc_missing: "R4" } });
    expect(after.outcome).toBe("allowed");
  });
  it("US-E10-06: an open not-drivable work order is R4; overdue maintenance: safety R3, normal R2", () => {
    expect(evaluateReadiness({ today, now, vehicle: vehicle({ notDrivableWorkOrder: true }) }).reasons[0]).toMatchObject({ code: "wo_not_drivable", risk: "R4", outcome: "restricted" });
    const m = evaluateReadiness({ today, now, vehicle: vehicle({ maintenance: [{ code: "BRAKES", safety: true, status: "overdue" }, { code: "OIL", safety: false, status: "overdue" }, { code: "TYRES", safety: true, status: "due" }] }) });
    expect(m.reasons.map((x) => [x.code, x.subject, x.outcome])).toEqual([["maintenance_overdue_safety", "BRAKES", "restricted"], ["maintenance_overdue", "OIL", "warning"]]);
  });
  it("license category and driver eligibility come through as R4", () => {
    const r = evaluateReadiness({ today, now, vehicle: vehicle({ requiredLicenseCategory: "PRO1" }), driver: driver({ employmentStatus: "suspended" }) });
    expect(blockingReasons(r).map((x) => x.code).sort()).toEqual(["employment_suspended", "license_category"]);
  });
  it("US-E12-03: an R3 override turns Restricted into Warning until it expires; R4 cannot be overridden", () => {
    const input: ReadinessInput = {
      today, now, vehicle: vehicle({ maintenance: [{ code: "BRAKES", safety: true, status: "overdue" }], notDrivableWorkOrder: true }),
      overrides: [
        { id: "o1", ruleCode: "maintenance_overdue_safety", entityType: "vehicle", entityId: "v1", subject: "BRAKES", expiresAt: now + 3_600_000 },
        { id: "o2", ruleCode: "wo_not_drivable", entityType: "vehicle", entityId: "v1", subject: null, expiresAt: now + 3_600_000 },
      ],
    };
    const r = evaluateReadiness(input);
    expect(r.reasons.find((x) => x.code === "maintenance_overdue_safety")).toMatchObject({ outcome: "warning", overrideId: "o1" });
    expect(r.reasons.find((x) => x.code === "wo_not_drivable")).toMatchObject({ outcome: "restricted", overrideId: null });
    // Expired override: the restriction comes back by itself
    const later = evaluateReadiness({ ...input, now: now + 7_200_000, vehicle: vehicle({ maintenance: [{ code: "BRAKES", safety: true, status: "overdue" }] }) });
    expect(later.outcome).toBe("restricted");
  });
  it("US-E12-03: overrides need an expiry; R4 never; R1 needs none", () => {
    expect(checkOverride("R4", now + 1000, now, 30)).toBe("r4_no_override");
    expect(checkOverride("R3", now - 1, now, 30)).toBe("expiry_required");
    expect(checkOverride("R3", now + 31 * 86_400_000, now, 30)).toBe("expiry_too_far");
    expect(checkOverride("R2", now + 86_400_000, now, 30)).toBeNull();
    expect(checkOverride("R1", now + 86_400_000, now, 30)).toBe("nothing_to_override");
  });
  it("US-E12-01: a company may raise a rule's risk but never lower it", () => {
    expect(checkRuleSetting("license_expired", "R2")).toBe("lower_than_default");
    expect(checkRuleSetting("maintenance_overdue", "R3")).toBeNull();
    expect(checkRuleSetting("doc_expired", "R4")).toBe("not_configurable");
    const raised = evaluateReadiness({ today, now, vehicle: vehicle({ maintenance: [{ code: "OIL", safety: false, status: "overdue" }] }), settings: { maintenance_overdue: "R3" } });
    expect(raised.outcome).toBe("restricted");
    const lowered = evaluateReadiness({ today, now, driver: driver({ licenseExpiry: "2026-01-01" }), settings: { license_expired: "R2" } });
    expect(lowered.outcome).toBe("restricted"); // ignored: cannot go below R4
  });
  it("authorization: no valid assignment is R3 when checked", () => {
    expect(evaluateReadiness({ today, now, driver: driver(), vehicle: vehicle(), assignment: { exists: false } }).reasons[0]).toMatchObject({ code: "no_assignment", risk: "R3" });
  });
});
