import { describe, expect, it } from "vitest";
import { EGYPT, RBAC_MATRIX, ROLES, ACTIONS } from "@fleet/config";
import {
  authorize, branchFilter, canAccessBranch, uuidv7, UUID_RE,
  normalizeRegistration, toWesternDigits, validateVehicleDraft, isValidVin,
  formatActivationCode, normalizeActivationCode, ACTIVATION_ALPHABET, type VehicleDraft,
} from "./index.js";

describe("uuidv7", () => {
  const rnd = new Uint8Array(10).fill(0xab);
  it("has version 7, RFC variant and canonical form", () => {
    const id = uuidv7(1_700_000_000_000, rnd);
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });
  it("sorts by time", () => {
    const a = uuidv7(1_700_000_000_000, rnd);
    const b = uuidv7(1_700_000_000_001, new Uint8Array(10));
    expect(a < b).toBe(true);
  });
  it("encodes the timestamp in the first 48 bits", () => {
    const id = uuidv7(0x0123_4567_89ab, rnd);
    expect(id.startsWith("01234567-89ab")).toBe(true);
  });
});

describe("authorization (RBAC matrix PRD §5.3)", () => {
  it("platform admin cannot read tenant vehicles (no access without break-glass)", () => {
    expect(authorize("platform_admin", "vehicle.read").allowed).toBe(false);
  });
  it("only company admin and fleet manager can write vehicles", () => {
    const writers = ROLES.filter((r) => authorize(r, "vehicle.write").allowed);
    expect(writers.sort()).toEqual(["company_admin", "fleet_manager"]);
  });
  it("fleet manager is branch scoped, company admin is tenant wide", () => {
    expect(authorize("fleet_manager", "vehicle.write")).toEqual({ allowed: true, scope: "branches" });
    expect(authorize("company_admin", "vehicle.write")).toEqual({ allowed: true, scope: "all" });
  });
  it("every matrix entry refers to known actions", () => {
    for (const role of ROLES) for (const a of Object.keys(RBAC_MATRIX[role])) expect(ACTIONS).toContain(a);
  });
  it("branch filter and access checks", () => {
    const p = { role: "fleet_manager" as const, branchIds: ["b1"] };
    expect(branchFilter(p, "all")).toBeNull();
    expect(branchFilter(p, "branches")).toEqual(["b1"]);
    expect(canAccessBranch(p, "branches", "b1")).toBe(true);
    expect(canAccessBranch(p, "branches", "b2")).toBe(false);
    expect(canAccessBranch(p, "all", "b2")).toBe(true);
  });
});

describe("registration numbers", () => {
  it("converts Arabic-Indic digits", () => {
    expect(toWesternDigits("١٢٣٤ ۵۶")).toBe("1234 56");
  });
  it("treats spacing, dashes and digit sets as the same plate", () => {
    expect(normalizeRegistration("ط ب ع ١٢٣٤")).toBe(normalizeRegistration("طبع-1234"));
  });
  it("folds alef/yaa/taa-marbuta variants", () => {
    expect(normalizeRegistration("أ ى ة 5")).toBe(normalizeRegistration("ا ي ه 5"));
  });
});

describe("validateVehicleDraft (US-E05-01)", () => {
  const ok: VehicleDraft = {
    fleetNumber: "F-001", registrationNumber: "ط ب ع 1234", vin: null, make: "Toyota", model: "Hiace",
    year: 2022, primaryFuelType: "PET92", primaryTankCapacity: 70, secondaryFuelType: "CNG",
    secondaryTankCapacity: 15, meterType: "distance", requiredLicenseCategory: "PRO3", ownershipType: "owned",
  };
  it("accepts a valid bi-fuel vehicle", () => {
    expect(validateVehicleDraft(ok, EGYPT, 2026)).toEqual({});
  });
  it("rejects missing tank capacity and license category, naming the fields", () => {
    const e = validateVehicleDraft({ ...ok, primaryTankCapacity: null, requiredLicenseCategory: null }, EGYPT, 2026);
    expect(e).toEqual({ primaryTankCapacity: "required", requiredLicenseCategory: "required" });
  });
  it("requires secondary tank capacity for bi-fuel and rejects duplicate fuel", () => {
    expect(validateVehicleDraft({ ...ok, secondaryTankCapacity: null }, EGYPT, 2026)).toEqual({ secondaryTankCapacity: "required" });
    expect(validateVehicleDraft({ ...ok, secondaryFuelType: "PET92" }, EGYPT, 2026).secondaryFuelType).toBe("same_as_primary");
  });
  it("rejects unknown codes, bad VIN and future model year", () => {
    const e = validateVehicleDraft({ ...ok, primaryFuelType: "XX", vin: "123", year: 2030 }, EGYPT, 2026);
    expect(Object.keys(e).sort()).toEqual(["primaryFuelType", "vin", "year"]);
  });
  it("VIN check excludes I, O, Q", () => {
    expect(isValidVin("1HGCM82633A004352")).toBe(true);
    expect(isValidVin("1HGCM82633A00435O")).toBe(false);
  });
});

describe("activation codes", () => {
  it("uses only the unambiguous alphabet and the requested length", () => {
    const bytes = new Uint8Array(32).map((_, i) => i * 37);
    const code = formatActivationCode(bytes, 8);
    expect(code).toHaveLength(8);
    for (const c of code) expect(ACTIVATION_ALPHABET).toContain(c);
  });
  it("skips biased bytes and fails when random runs out", () => {
    expect(() => formatActivationCode(new Uint8Array(16).fill(255), 8)).toThrow();
  });
  it("normalizes user input", () => {
    expect(normalizeActivationCode(" ab2c-d٣ ")).toBe("AB2CD3");
  });
});
