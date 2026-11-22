import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

/** Owner (16 Nov 2026): the system runs in Tunisia — dinars with 3 decimals, Tunisian plates, fuels and IDs. */
run("tunisia", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  let vehicleId = "";
  const post = (path: string, body: object = {}) => h.http.post(path).set(bearer(co.token)).send(body);
  const vehicle = (over: object = {}) => ({
    branchId: co.hq, fleetNumber: "T-1", registrationNumber: "123 TU 4567", make: "Peugeot", model: "Partner", year: 2023,
    primaryFuelType: "SSP", primaryTankCapacity: 55, meterType: "distance", requiredLicenseCategory: "B", ownershipType: "leased", ...over,
  });

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "tn", { countryCode: "TN" });
  });
  afterAll(() => h.stop());

  it("a Tunisian company works in dinars, Tunis time", async () => {
    const c = await h.http.get("/company").set(bearer(co.token));
    expect(c.body).toMatchObject({ countryCode: "TN", currency: "TND", timezone: "Africa/Tunis" });
    // The head office made at provisioning follows the country, not the column default (Cairo, Friday).
    const b = await h.http.get("/branches").set(bearer(co.token));
    expect(b.body.items[0]).toMatchObject({ code: "HQ", timezone: "Africa/Tunis", weekendDays: [6, 0] });
  });

  it("123 TU 4567 and 123 تونس 4567 are the same vehicle", async () => {
    const v = await post("/vehicles", vehicle());
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    vehicleId = v.body.id;
    const again = await post("/vehicles", vehicle({ fleetNumber: "T-2", registrationNumber: "123 تونس 4567" }));
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    // Egyptian fuel types are not Tunisian.
    expect((await post("/vehicles", vehicle({ fleetNumber: "T-3", registrationNumber: "200 TU 1", primaryFuelType: "PET92" }))).status).toBe(422);
  });

  it("checks the 8-digit national ID card number", async () => {
    const bad = await post("/drivers", { branchId: co.hq, fullName: "سائق", username: `tn.bad.${h.sfx}`, nationalId: "1234" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.nationalId).toBe("invalid_national_id");
    const ok = await post("/drivers", { branchId: co.hq, fullName: "محمد بن علي", username: `tn.ok.${h.sfx}`, nationalId: "08123456", licenseCategories: ["B"], licenseExpiry: "2030-01-01" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it("fuel in millimes is compared with the price the company admin entered", async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    expect((await post("/meter-readings", { vehicleId, value: 10_000, eventAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), opening: true })).status).toBe(201);
    // 2.525 TND per litre = 2525 millimes.
    expect((await post("/company/fuel-prices", { fuelType: "SSP", priceMinor: 2_525, effectiveFrom: at })).status).toBe(201);
    const ok = await post("/fuel-entries", { vehicleId, odometer: 10_300, fuelType: "SSP", quantity: 40, amountMinor: 101_000, isFull: true, payment: "card" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ currency: "TND", grossMinor: 101_000, unitPriceMinor: 2_525, referencePriceMinor: 2_525 });
    expect(ok.body.flags).not.toContain("price_deviation");
    const high = await post("/fuel-entries", { vehicleId, odometer: 10_600, fuelType: "SSP", quantity: 40, amountMinor: 404_000, isFull: true, payment: "card" });
    expect(high.body.flags).toContain("price_deviation");
  });
});
