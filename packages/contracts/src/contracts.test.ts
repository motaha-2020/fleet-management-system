import { describe, expect, it } from "vitest";
import { buildOpenApi, buildPath, CreateVehicleRequest, routes } from "./index.js";

describe("contract", () => {
  it("builds paths with encoded params", () => {
    expect(buildPath("/drivers/:id/activation-code", { id: "a b" })).toBe("/drivers/a%20b/activation-code");
    expect(() => buildPath("/vehicles/:id", {})).toThrow();
  });
  it("every route has a unique method+path", () => {
    const keys = Object.values(routes).map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("generates an OpenAPI document covering every route", () => {
    const doc = buildOpenApi();
    const ops = Object.values(doc.paths).flatMap((p) => Object.keys(p));
    expect(ops).toHaveLength(Object.keys(routes).length);
  });
  it("vehicle create defaults status to active", () => {
    const v = CreateVehicleRequest.parse({
      branchId: "0190f1e2-0000-7000-8000-000000000000", fleetNumber: "F1", registrationNumber: "ABC 1",
      make: "Toyota", model: "Corolla", year: 2020, primaryFuelType: "PET92", primaryTankCapacity: 50,
      meterType: "distance", requiredLicenseCategory: "PRIVATE", ownershipType: "owned",
    });
    expect(v.status).toBe("active");
  });
});
