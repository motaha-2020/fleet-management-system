import { describe, expect, it } from "vitest";
import { COUNTRY_TEMPLATES, DEFAULT_COUNTRY, TUNISIA, fromMinorUnits, minorFactor, toMinorUnits } from "@fleet/config";
import { isValidTunisianNationalId, normalizeRegistration, validateVehicleDraft } from "./index.js";

/** Owner (16 Nov 2026): the system runs in Tunisia. */
describe("Tunisia profile", () => {
  it("is the default country, in dinars with 3 decimals", () => {
    expect(DEFAULT_COUNTRY).toBe("TN");
    expect(COUNTRY_TEMPLATES.TN).toBe(TUNISIA);
    expect(TUNISIA).toMatchObject({ currency: "TND", currencyMinorUnits: 3, timezone: "Africa/Tunis", phonePrefix: "+216" });
  });

  it("converts money with the currency's own decimals", () => {
    expect(minorFactor("TND")).toBe(1000);
    expect(minorFactor("EGP")).toBe(100);
    expect(toMinorUnits(2.525, "TND")).toBe(2525);
    expect(toMinorUnits(101, "TND")).toBe(101_000);
    expect(fromMinorUnits(2525, "TND")).toBe(2.525);
    expect(toMinorUnits(17.75, "EGP")).toBe(1775);
  });

  it("treats 123 TU 4567 and 123 تونس 4567 as the same plate", () => {
    expect(normalizeRegistration("123 TU 4567")).toBe(normalizeRegistration("123 تونس 4567"));
    expect(normalizeRegistration("١٢٣ تونس ٤٥٦٧")).toBe("123TU4567");
    expect(normalizeRegistration("123-tu-4567")).toBe("123TU4567");
  });

  it("checks the national ID card number (8 digits)", () => {
    expect(isValidTunisianNationalId("08123456")).toBe(true);
    expect(isValidTunisianNationalId("1234567")).toBe(false);
    expect(isValidTunisianNationalId("123456789")).toBe(false);
  });

  it("accepts a vehicle with Tunisian fuel and licence category", () => {
    const errors = validateVehicleDraft({
      fleetNumber: "T-1", registrationNumber: "123 TU 4567", make: "Peugeot", model: "Partner", year: 2023,
      primaryFuelType: "SSP", primaryTankCapacity: 55, meterType: "distance", requiredLicenseCategory: "B", ownershipType: "leased",
    }, TUNISIA, 2026);
    expect(errors).toEqual({});
  });

  it("has the Tunisian documents, all with a French name", () => {
    const codes = TUNISIA.documentTypes.map((d) => d.code);
    expect(codes).toEqual(expect.arrayContaining(["TN_VEH_REGISTRATION", "TN_VEH_INSURANCE", "TN_VEH_INSPECTION", "TN_VEH_TAX", "TN_DRV_LICENSE", "TN_DRV_CIN"]));
    expect(TUNISIA.documentTypes.every((d) => !!d.name.fr)).toBe(true);
    expect(TUNISIA.fuelTypes.every((f) => !!f.name.fr)).toBe(true);
  });
});
