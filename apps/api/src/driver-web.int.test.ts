import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** Owner decision (14 Nov 2026): a driver web version (online), next to the phone app, not instead of it. */
run("driver web version", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  let driverId = "", vehicleId = "", phone = "";
  const code = async () => (await h.http.post(`/drivers/${driverId}/activation-code`).set(bearer(co.token))).body.code as string;
  const webSignIn = async () => h.http.post("/auth/driver/web-activate").send({ username: `web.${h.sfx}`, code: await code() });

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "dweb");
    vehicleId = (await h.http.post("/vehicles").set(bearer(co.token)).send(vehicleBody(co.hq, { secondaryFuelType: null, secondaryTankCapacity: null }))).body.id;
    await h.http.post("/meter-readings").set(bearer(co.token)).send({ vehicleId, value: 5_000, eventAt: new Date(Date.now() - 86_400_000).toISOString(), opening: true });
    driverId = (await h.http.post("/drivers").set(bearer(co.token)).send({ branchId: co.hq, fullName: "سائق الويب", username: `web.${h.sfx}`, licenseCategories: ["PRO3"], licenseExpiry: "2030-01-01" })).body.id;
    await h.http.post("/assignments").set(bearer(co.token)).send({ vehicleId, driverId, role: "primary", startsAt: new Date(Date.now() - 3_600_000).toISOString() });
    phone = (await h.http.post("/auth/driver/activate").send({ username: `web.${h.sfx}`, code: await code(), deviceName: "P", platform: "android" })).body.accessToken;
  });
  afterAll(() => h.stop());

  it("a browser signs in with the username and a code, in a cookie, without signing out the phone", async () => {
    const r = await webSignIn();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.user).toMatchObject({ role: "driver" });
    expect(r.body.refreshToken).toBeUndefined();
    expect(String(r.headers["set-cookie"])).toContain("fleet_rt=");
    expect((await h.http.get("/vehicles").set(bearer(r.body.accessToken))).status).toBe(200);
    expect((await h.http.get("/vehicles").set(bearer(phone))).status).toBe(200);
    // A second browser replaces the first browser, still not the phone.
    const again = await webSignIn();
    expect((await h.http.get("/vehicles").set(bearer(r.body.accessToken))).status).toBe(401);
    expect((await h.http.get("/vehicles").set(bearer(again.body.accessToken))).status).toBe(200);
    expect((await h.http.get("/vehicles").set(bearer(phone))).status).toBe(200);
    expect((await h.http.post("/auth/driver/web-activate").send({ username: `web.${h.sfx}`, code: "WRONG-CODE" })).status).toBe(401);
  });

  it("a reading from the browser carries the meter photo and the place", async () => {
    const web = (await webSignIn()).body.accessToken as string;
    const r = await h.http.post("/meter-readings").set(bearer(web)).send({ vehicleId, value: 5_120, photoTakenAt: new Date().toISOString(), location: { lat: 30.05, lng: 31.23, accuracyM: 15 }, locationStatus: "ok" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ location: { lat: 30.05, lng: 31.23 }, hasPhoto: false });
    const p = await h.http.post(`/meter-readings/${r.body.id}/photo`).set(bearer(web)).set("content-type", "image/png").send(PNG);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.hasPhoto).toBe(true);
    expect((await h.http.post(`/meter-readings/${r.body.id}/photo`).set(bearer(web)).set("content-type", "image/png").send(PNG)).status).toBe(409);
  });
});
