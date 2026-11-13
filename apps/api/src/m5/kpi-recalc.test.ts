import { describe, expect, it } from "vitest";
import { monthEnd, monthsBetween } from "./kpi-recalc.js";

describe("US-E16-03: months a correction touches", () => {
  it("lists each month once, across a year end", () => {
    expect(monthsBetween("2026-03-14", "2026-03-30")).toEqual(["2026-03-01"]);
    expect(monthsBetween("2026-11-20", "2027-02-02")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
  });
  it("ends a month on its last day, leap years included", () => {
    expect(monthEnd("2028-02-01")).toBe("2028-02-29");
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
  });
});
