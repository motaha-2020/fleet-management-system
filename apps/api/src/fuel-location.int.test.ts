import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

/** Owner decision (14 Nov 2026): a fuel entry carries where it was made (the fuel station), shown on a map. */
run("fuel entry location", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  let vehicleId = "";

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "fuelloc");
    vehicleId = (await h.http.post("/vehicles").set(bearer(co.token)).send(vehicleBody(co.hq, { secondaryFuelType: null, secondaryTankCapacity: null }))).body.id;
    await h.http.post("/meter-readings").set(bearer(co.token)).send({ vehicleId, value: 10_000, eventAt: new Date(Date.now() - 86_400_000).toISOString(), opening: true });
  });
  afterAll(() => h.stop());

  it("keeps the location on the entry and on the reading it makes", async () => {
    const r = await h.http.post("/fuel-entries").set(bearer(co.token)).send({
      vehicleId, odometer: 10_150, fuelType: "PET92", quantity: 30, amountMinor: 45_000, isFull: true, payment: "card",
      location: { lat: 30.061234, lng: 31.245678, accuracyM: 12.4 }, locationStatus: "ok",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.location).toEqual({ lat: 30.061234, lng: 31.245678, accuracyM: 12 });
    expect(r.body.locationStatus).toBe("ok");
    const list = await h.http.get("/fuel-entries").set(bearer(co.token)).query({ vehicleId });
    expect(list.body.items[0].location).toMatchObject({ lat: 30.061234, lng: 31.245678 });
    const odo = await h.http.get(`/vehicles/${vehicleId}/odometer`).set(bearer(co.token));
    const reading = odo.body.readings.find((x: { id: string }) => x.id === r.body.readingId);
    expect(reading.location).toMatchObject({ lat: 30.061234, lng: 31.245678 });
  });

  it("a refused location never blocks the entry", async () => {
    const r = await h.http.post("/fuel-entries").set(bearer(co.token)).send({
      vehicleId, odometer: 10_400, fuelType: "PET92", quantity: 20, amountMinor: 30_000, isFull: true, payment: "card", location: null, locationStatus: "denied",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ location: null, locationStatus: "denied" });
    // Entries from the office without any location stay as before.
    const plain = await h.http.post("/fuel-entries").set(bearer(co.token)).send({ vehicleId, odometer: 10_600, fuelType: "PET92", quantity: 20, amountMinor: 30_000, isFull: true, payment: "card" });
    expect(plain.body).toMatchObject({ location: null, locationStatus: null });
  });
});
