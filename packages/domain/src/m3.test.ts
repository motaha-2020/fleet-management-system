import { describe, expect, it } from "vitest";
import { applicableRun, checkEventClock, grantWindow, withinGrant } from "./index.js";

const H = 3_600_000;
const M = 60_000;
const issued = Date.parse("2026-11-01T08:00:00Z");
const grant = grantWindow(issued); // 72 h

describe("Offline Grant window (US-E14-01)", () => {
  it("allows an offline action 71 hours after the last check", () => {
    expect(withinGrant({ deviceTime: issued + 71 * H, elapsedMs: 71 * H }, grant)).toBe(true);
  });
  it("refuses a new action 73 hours after the last check", () => {
    expect(withinGrant({ deviceTime: issued + 73 * H, elapsedMs: 73 * H }, grant)).toBe(false);
  });
  it("uses the monotonic time, so moving the phone clock back does not extend the grant", () => {
    // 80 h really passed; the driver set the phone clock back to look like 10 h
    expect(withinGrant({ deviceTime: issued + 10 * H, elapsedMs: 80 * H }, grant)).toBe(false);
  });
  it("falls back to the device time when the monotonic time is unknown (after a reboot)", () => {
    expect(withinGrant({ deviceTime: issued + 71 * H, elapsedMs: null }, grant)).toBe(true);
    expect(withinGrant({ deviceTime: issued + 73 * H, elapsedMs: null }, grant)).toBe(false);
  });
});

describe("clock integrity (US-E14-03)", () => {
  it("flags a device clock two hours ahead and records the estimated time, keeping both", () => {
    const c = checkEventClock({ deviceTime: issued + 5 * H + 2 * H, elapsedMs: 5 * H }, grant);
    expect(c).toEqual({ estimatedAt: issued + 5 * H, driftMs: 2 * H, flags: ["clock_drift"], eventAt: issued + 5 * H });
  });
  it("accepts small differences without a flag and keeps the device time", () => {
    const c = checkEventClock({ deviceTime: issued + 5 * H + 3 * M, elapsedMs: 5 * H }, grant);
    expect(c.flags).toEqual([]);
    expect(c.eventAt).toBe(issued + 5 * H + 3 * M);
  });
  it("marks the time unverified when there is no monotonic reading", () => {
    expect(checkEventClock({ deviceTime: issued + H, elapsedMs: null }, grant)).toMatchObject({ flags: ["time_unverified"], estimatedAt: null, eventAt: issued + H });
  });
});

describe("ordering by device sequence (US-E14-04)", () => {
  it("applies the run without gaps and holds what comes after a gap", () => {
    expect(applicableRun(0, [2])).toEqual([]);
    expect(applicableRun(0, [2, 1])).toEqual([1, 2]);
    expect(applicableRun(3, [4, 5, 7])).toEqual([4, 5]);
    expect(applicableRun(5, [])).toEqual([]);
  });
});
