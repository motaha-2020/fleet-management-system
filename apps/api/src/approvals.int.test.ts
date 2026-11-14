import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;
const DAY = 86_400_000;

type Item = { type: string; id: string; canDecide: boolean; byDriver: boolean; odometer: number | null };

/**
 * Owner decision (14 Nov 2026): readings, fuel, costs and maintenance count only after approval — by the fleet
 * manager for drivers' records, by the company admin for office staff's records; automatic per type if the company
 * admin chooses.
 */
run("approvals", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  let fm = "";
  let driver = "";
  let vehicleId = "";
  const post = (path: string, token: string, body: object = {}) => h.http.post(path).set(bearer(token)).send(body);
  const inbox = async (token: string) => (await h.http.get("/approvals").set(bearer(token))).body.items as Item[];
  const current = async () => (await h.http.get(`/vehicles/${vehicleId}/odometer`).set(bearer(co.token))).body.current?.value as number | undefined;

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "appr", { approvals: "manual" });
    const inv = await post("/users", co.token, { email: `fm@${co.slug}.test`, displayName: "FM", role: "fleet_manager", branchIds: [co.hq] });
    fm = (await h.acceptInvite(`fm@${co.slug}.test`, inv.body.inviteToken, "fleet-manager-pass-1")).body.accessToken;
    vehicleId = (await post("/vehicles", co.token, vehicleBody(co.hq, { secondaryFuelType: null, secondaryTankCapacity: null }))).body.id;
    // The company admin's own records are approved at once (nobody above them).
    const opening = await post("/meter-readings", co.token, { vehicleId, value: 50_000, eventAt: new Date(Date.now() - 5 * DAY).toISOString(), opening: true });
    expect(opening.body.approvalStatus).toBe("approved");
    const d = await post("/drivers", co.token, { branchId: co.hq, fullName: "سائق الاعتماد", username: `appr.${h.sfx}`, licenseCategories: ["PRO3"] });
    await post("/assignments", co.token, { vehicleId, driverId: d.body.id, role: "primary", startsAt: new Date(Date.now() - 4 * DAY).toISOString() });
    const code = await post(`/drivers/${d.body.id}/activation-code`, co.token);
    driver = (await h.http.post("/auth/driver/activate").send({ username: `appr.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" })).body.accessToken;
  });
  afterAll(() => h.stop());

  it("a driver's reading waits for the fleet manager and does not count until approved", async () => {
    const r = await post("/meter-readings", driver, { vehicleId, value: 50_300, eventAt: new Date(Date.now() - 3 * DAY).toISOString() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.approvalStatus).toBe("pending");
    expect(await current()).toBe(50_000);
    const items = await inbox(fm);
    const it = items.find((i) => i.id === r.body.id)!;
    expect(it).toMatchObject({ type: "odometer", byDriver: true, canDecide: true, odometer: 50_300 });
    expect((await post(`/approvals/odometer/${r.body.id}/approve`, fm)).status).toBe(200);
    expect(await current()).toBe(50_300);
    expect((await post(`/approvals/odometer/${r.body.id}/approve`, fm)).status).toBe(409);
  });

  it("a rejected reading never counts, and the driver is told why", async () => {
    const r = await post("/meter-readings", driver, { vehicleId, value: 59_999, eventAt: new Date(Date.now() - 2 * DAY).toISOString() });
    expect((await post(`/approvals/odometer/${r.body.id}/reject`, fm, { reason: "الصورة مش واضحة" })).status).toBe(200);
    expect(await current()).toBe(50_300);
    const alerts = await h.http.get("/alerts").set(bearer(driver));
    expect(alerts.body.items.some((a: { type: string }) => a.type === "record_rejected")).toBe(true);
  });

  it("fuel waits for approval even without findings; approving makes its cost and reading count", async () => {
    const e = await post("/fuel-entries", driver, { vehicleId, odometer: 50_500, fuelType: "PET92", quantity: 30, amountMinor: 45_000, isFull: true, payment: "card" });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    expect(e.body.status).toBe("under_review");
    const costsBefore = (await h.http.get("/costs").set(bearer(co.token))).body.items.length;
    expect((await inbox(fm)).find((i) => i.id === e.body.id)).toMatchObject({ type: "fuel", canDecide: true });
    expect((await post(`/approvals/fuel/${e.body.id}/approve`, fm)).status).toBe(200);
    expect((await h.http.get("/costs").set(bearer(co.token))).body.items.length).toBe(costsBefore + 1);
    expect(await current()).toBe(50_500);
  });

  it("what the fleet manager records is approved by the company admin, not by the fleet manager", async () => {
    const c = await post("/costs", fm, { category: "tolls", vehicleId, netMinor: 2_500, expenseDate: new Date().toISOString().slice(0, 10) });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.status).toBe("pending");
    expect((await inbox(fm)).find((i) => i.id === c.body.id)?.canDecide).toBe(false);
    expect((await post(`/approvals/cost/${c.body.id}/approve`, fm)).status).toBe(403);
    expect((await inbox(co.token)).find((i) => i.id === c.body.id)?.canDecide).toBe(true);
    expect((await post(`/approvals/cost/${c.body.id}/approve`, co.token)).status).toBe(200);
    const list = await h.http.get("/costs").set(bearer(co.token));
    expect(list.body.items.find((x: { id: string }) => x.id === c.body.id).status).toBe("active");
  });

  it("a finished maintenance visit counts (cost, baseline) only once approved", async () => {
    const v = await post("/maintenance/visits", fm, { vehicleId, type: "preventive", visitDate: new Date().toISOString().slice(0, 10), odometer: 50_700, netMinor: 80_000, items: [], complete: true });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body.status).toBe("pending_approval");
    expect(v.body.costId).toBeNull();
    expect((await post(`/approvals/maintenance/${v.body.id}/approve`, co.token)).status).toBe(200);
    const after = await h.http.get("/maintenance/visits").query({ vehicleId }).set(bearer(co.token));
    expect(after.body.items.find((x: { id: string }) => x.id === v.body.id)).toMatchObject({ status: "completed", costId: expect.any(String) });
    expect(await current()).toBe(50_700);
  });

  it("the company admin can make a type automatic", async () => {
    expect((await post("/approval-settings", fm, { type: "odometer", mode: "auto" })).status).toBe(403);
    const s = await post("/approval-settings", co.token, { type: "odometer", mode: "auto" });
    expect(s.body.items.find((x: { type: string }) => x.type === "odometer").mode).toBe("auto");
    const r = await post("/meter-readings", driver, { vehicleId, value: 50_900, eventAt: new Date().toISOString() });
    expect(r.body.approvalStatus).toBe("approved");
    expect(await current()).toBe(50_900);
  });
});
