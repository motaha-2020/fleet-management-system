import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { newId } from "@fleet/db";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const DAY = 86_400_000;
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const at = (n: number) => new Date(Date.now() + n * DAY).toISOString();

type Reason = { code: string; subject: string | null; risk: string; outcome: string; overrideId: string | null };
type Item = { code: string; intervalKm: number | null; overridden: boolean; templateId: string; baseline: { sourceType: string; odometer: number | null } | null; due: { status: string; remainingKm: number | null; forecastDate: string | null; quality: string } };

run("Fleet API — M4 maintenance & readiness (integration)", () => {
  const h = new Harness(ADMIN!);
  let co: Awaited<ReturnType<Harness["company"]>>;
  const s: Record<string, string> = {};
  const tk: Record<string, string> = {};
  const post = (path: string, token: string | undefined, body?: object) => h.http.post(path).set(bearer(token)).send(body ?? {});
  const patch = (path: string, token: string | undefined, body?: object) => h.http.patch(path).set(bearer(token)).send(body ?? {});
  const get = (path: string, token: string | undefined) => h.http.get(path).set(bearer(token));
  const items = async (vehicleId: string) => (await get(`/vehicles/${vehicleId}/maintenance`, co.token)).body.items as Item[];
  const item = async (vehicleId: string, code: string) => (await items(vehicleId)).find((i) => i.code === code)!;
  const readiness = async (q: string, token = co.token) => (await get(`/readiness?${q}`, token)).body as { outcome: string; reasons: Reason[] };
  const driver = async (name: string, over: Record<string, unknown> = {}) =>
    (await post("/drivers", co.token, { branchId: co.hq, fullName: name, username: `${name}.${h.sfx}`, licenseCategories: ["PRO3"], licenseExpiry: "2030-01-01", ...over })).body.id as string;

  beforeAll(async () => {
    await h.start();
    const platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "m4");
    const fm = await post("/users", co.token, { email: `fm@${co.slug}.test`, displayName: "FM", role: "fleet_manager", branchIds: [co.hq] });
    tk.fm = (await h.acceptInvite(`fm@${co.slug}.test`, fm.body.inviteToken, "fleet-manager-pass-1")).body.accessToken;
    const veh = async (fleet: string) => (await post("/vehicles", co.token, vehicleBody(co.hq, { fleetNumber: fleet, registrationNumber: `${fleet} 1`, secondaryFuelType: null, secondaryTankCapacity: null }))).body.id as string;
    s.v1 = await veh("M1");
    s.v2 = await veh("M2");
    s.d1 = await driver("mdrv");
    s.d2 = await driver("mdrv2");
    s.d3 = await driver("mexp", { licenseExpiry: "2020-01-01" });
    expect((await post("/meter-readings", co.token, { vehicleId: s.v1, value: 10_000, eventAt: at(-40), opening: true })).status).toBe(201);
    expect((await post("/meter-readings", co.token, { vehicleId: s.v1, value: 13_000, eventAt: at(-1) })).status).toBe(201);
    expect((await post("/assignments", co.token, { vehicleId: s.v2, driverId: s.d1, role: "primary", startsAt: at(-5) })).status).toBe(201);
    const code = await post(`/drivers/${s.d1}/activation-code`, co.token);
    tk.d1 = (await h.http.post("/auth/driver/activate").send({ username: `mdrv.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" })).body.accessToken;
  });
  afterAll(() => h.stop());

  // ---------------------------------------------------------------- E10 templates & due status
  it("MNT-001/002: the most specific active template applies; only the company admin manages templates", async () => {
    const generic = await post("/maintenance/templates", co.token, { name: "Generic", items: [{ code: "GEN", name: "General check", intervalMonths: 12 }] });
    expect(generic.status).toBe(201);
    const hiace = await post("/maintenance/templates", co.token, {
      name: "Hiace", make: "toyota", model: "HIACE",
      items: [{ code: "oil", name: "Engine oil", intervalKm: 5_000, intervalMonths: 6 }, { code: "BRAKE", name: "Brakes", intervalKm: 20_000, safety: true }],
    });
    expect(hiace.status).toBe(201);
    expect(hiace.body.items.map((i: { code: string }) => i.code)).toEqual(["BRAKE", "OIL"]);
    s.tpl = hiace.body.id;
    s.oilItem = hiace.body.items.find((i: { code: string }) => i.code === "OIL").id;
    expect((await post("/maintenance/templates", tk.fm, { name: "X", items: [{ code: "X1", name: "X1", intervalKm: 1 }] })).status).toBe(403);
    expect((await post("/maintenance/templates", co.token, { name: "Bad", items: [{ code: "NOI", name: "No interval" }] })).status).toBe(422);
    const list = await items(s.v1!);
    expect(list.map((i) => i.code).sort()).toEqual(["BRAKE", "OIL"]);
    expect(list.every((i) => i.templateId === s.tpl)).toBe(true);
  });

  it("US-E10-02/03: no baseline → Unknown; baseline → due point, status and forecast from recent km/day", async () => {
    expect((await item(s.v1!, "BRAKE")).due.status).toBe("unknown_baseline");
    const r = await post(`/vehicles/${s.v1}/maintenance/OIL/baseline`, tk.fm, { doneOn: day(-30), odometer: 8_400 });
    expect(r.status).toBe(200);
    expect(r.body.currentOdometer).toBe(13_000);
    expect(r.body.kmPerDay).toBe(100);
    const oil = r.body.items.find((i: Item) => i.code === "OIL") as Item;
    expect(oil.due).toMatchObject({ status: "upcoming", remainingKm: 400, quality: "reliable" });
    expect(oil.due.forecastDate! >= day(3) && oil.due.forecastDate! <= day(5)).toBe(true);
    expect((await post(`/vehicles/${s.v1}/maintenance/OIL/baseline`, tk.fm, { doneOn: day(5), odometer: 1 })).status).toBe(422);
    expect((await post(`/vehicles/${s.v1}/maintenance/NOPE/baseline`, tk.fm, { doneOn: day(-1), odometer: 1 })).status).toBe(404);
    const due = await get("/maintenance/due?status=upcoming", tk.fm);
    expect(due.body.items).toEqual([expect.objectContaining({ vehicleId: s.v1, code: "OIL", fleetNumber: "M1" })]);
    expect((await get("/maintenance/due", tk.fm)).body.items.some((x: { code: string; vehicleId: string }) => x.vehicleId === s.v2 && x.code === "BRAKE")).toBe(true);
  });

  it("US-E10-01: a per-vehicle interval leaves the template and other vehicles untouched", async () => {
    const r = await post(`/vehicles/${s.v1}/maintenance/OIL/override`, tk.fm, { intervalKm: 3_000, intervalMonths: null });
    expect(r.status).toBe(200);
    expect(r.body.items.find((i: Item) => i.code === "OIL")).toMatchObject({ intervalKm: 3_000, overridden: true, due: expect.objectContaining({ status: "overdue", remainingKm: -1_600 }) });
    expect(await item(s.v2!, "OIL")).toMatchObject({ intervalKm: 5_000, overridden: false });
    // A template change reaches vehicles that follow it, not the overridden one.
    expect((await patch(`/maintenance/template-items/${s.oilItem}`, co.token, { intervalKm: 6_000 })).status).toBe(200);
    expect((await item(s.v2!, "OIL")).intervalKm).toBe(6_000);
    expect((await item(s.v1!, "OIL")).intervalKm).toBe(3_000);
    const audit = await get(`/audit?entityType=vehicle&entityId=${s.v1}`, co.token);
    expect(audit.body.items.some((a: { action: string }) => a.action === "maintenance.override_set")).toBe(true);
  });

  // ---------------------------------------------------------------- E12 readiness & enforcement
  it("US-E12-02/03: overdue safety maintenance restricts the vehicle (R3); ordinary overdue only warns", async () => {
    await post(`/vehicles/${s.v1}/maintenance/BRAKE/override`, tk.fm, { intervalKm: 10_000, intervalMonths: null });
    await post(`/vehicles/${s.v1}/maintenance/BRAKE/baseline`, tk.fm, { doneOn: day(-400), odometer: 0 });
    const r = await readiness(`vehicleId=${s.v1}`);
    expect(r.outcome).toBe("restricted");
    expect(r.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "maintenance_overdue_safety", subject: "BRAKE", risk: "R3", outcome: "restricted" }),
      expect.objectContaining({ code: "maintenance_overdue", subject: "OIL", risk: "R2", outcome: "warning" }),
      expect.objectContaining({ code: "doc_missing", subject: "EG_VEH_LICENSE", risk: "R2", outcome: "warning" }),
    ]));
    const a = await post("/assignments", co.token, { vehicleId: s.v1, driverId: s.d2, role: "primary" });
    expect(a.status).toBe(422);
    expect(a.body.error).toMatchObject({ code: "not_eligible", fields: { vehicleId: "maintenance_overdue_safety:BRAKE" } });
    const list = await get("/readiness/vehicles", tk.fm);
    expect(list.body.items.find((x: { vehicleId: string }) => x.vehicleId === s.v1)).toMatchObject({ outcome: "restricted", codes: expect.arrayContaining(["maintenance_overdue_safety"]) });
  });

  it("US-E12-04: R3 can be overridden with reason and bounded expiry; R4 never; revocable and audited", async () => {
    const base = { ruleCode: "maintenance_overdue_safety", entityType: "vehicle", entityId: s.v1, subject: "BRAKE", reason: "Brakes checked by workshop, part on order" };
    expect((await post("/readiness/overrides", tk.fm, { ...base, expiresAt: at(40) })).body.error.fields.expiresAt).toBe("expiry_too_far");
    expect((await post("/readiness/overrides", tk.fm, { ...base, subject: "OIL" })).status).toBe(422);
    const o = await post("/readiness/overrides", tk.fm, { ...base, expiresAt: at(7) });
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ risk: "R3", active: true });
    expect((await post("/readiness/overrides", tk.fm, { ...base, expiresAt: at(7) })).status).toBe(409);
    const r = await readiness(`vehicleId=${s.v1}`);
    expect(r.outcome).toBe("warning");
    expect(r.reasons.find((x) => x.code === "maintenance_overdue_safety")).toMatchObject({ outcome: "warning", overrideId: o.body.id });
    const lic = await post("/readiness/overrides", tk.fm, { ruleCode: "license_expired", entityType: "driver", entityId: s.d3, reason: "Renewal in progress", expiresAt: at(3) });
    expect(lic.status).toBe(403);
    expect((await post("/readiness/overrides", tk.d1, { ...base, expiresAt: at(7) })).status).toBe(403);
    // While overridden the assignment goes through.
    const a = await post("/assignments", co.token, { vehicleId: s.v1, driverId: s.d2, role: "primary" });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect((await post(`/readiness/overrides/${o.body.id}/revoke`, tk.fm)).body.active).toBe(false);
    expect((await readiness(`vehicleId=${s.v1}`)).outcome).toBe("restricted");
    const audit = await get(`/audit?entityType=vehicle&entityId=${s.v1}`, co.token);
    expect(audit.body.items.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(["readiness.overridden", "readiness.override_revoked"]));
    // The driver's own license (R4) shows in the driver's readiness.
    const d3 = await readiness(`driverId=${s.d3}`);
    expect(d3.reasons.find((x) => x.code === "license_expired")).toMatchObject({ risk: "R4", outcome: "restricted" });
  });

  // ---------------------------------------------------------------- visits
  it("US-E10-06/07: completing a visit needs the invoice total, books one cost, records the odometer, resets baselines", async () => {
    const body = { vehicleId: s.v1, type: "preventive", visitDate: day(0), odometer: 13_050, items: ["BRAKE", "OIL"] };
    expect((await post("/maintenance/visits", tk.fm, { ...body, complete: true })).body.error.fields.netMinor).toBe("invoice_required");
    expect((await post("/maintenance/visits", tk.fm, { ...body, netMinor: 100, partsMinor: 500 })).body.error.fields.partsMinor).toBe("breakdown_exceeds_total");
    expect((await post("/maintenance/visits", tk.fm, { ...body, items: ["TIRES"] })).body.error.fields.items).toBe("unknown_item:TIRES");
    const v = await post("/maintenance/visits", tk.fm, { ...body, netMinor: 100_000, taxMinor: 14_000, partsMinor: 50_000, laborMinor: 30_000, invoiceRef: "INV-77", complete: true });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body).toMatchObject({ status: "completed", grossMinor: 114_000, unallocatedMinor: 34_000, readingStatus: "valid", items: ["BRAKE", "OIL"] });
    expect(v.body.costId).toBeTruthy();
    const costs = (await get(`/costs?vehicleId=${s.v1}`, co.token)).body.items.filter((c: { sourceType: string }) => c.sourceType === "maintenance");
    expect(costs).toEqual([expect.objectContaining({ id: v.body.costId, category: "preventive", grossMinor: 114_000, sourceId: v.body.id })]);
    expect((await post(`/maintenance/visits/${v.body.id}/complete`, tk.fm)).body.costId).toBe(v.body.costId);
    const brake = await item(s.v1!, "BRAKE");
    expect(brake.baseline).toMatchObject({ sourceType: "visit", odometer: 13_050 });
    expect(brake.due.status).toBe("ok");
    expect((await readiness(`vehicleId=${s.v1}`)).reasons.some((x) => x.code.startsWith("maintenance"))).toBe(false);
    const odo = await get(`/vehicles/${s.v1}/odometer`, co.token);
    expect(JSON.stringify(odo.body)).toContain("maintenance");
    expect((await get("/maintenance/visits?vehicleId=" + s.v1, tk.fm)).body.items).toHaveLength(1);
  });

  // ---------------------------------------------------------------- defects & work orders
  it("US-E10-04 / US-E12-02: a driver reports a not-drivable defect; the vehicle is restricted until triage; fuel still goes in", async () => {
    const d = await post("/defects", tk.d1, { vehicleId: s.v2, description: "Brake pedal soft", severity: "high", drivable: false });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body).toMatchObject({ driverId: s.d1, status: "reported", hasPhoto: false });
    s.def1 = d.body.id;
    const photo = await h.http.post(`/defects/${s.def1}/photo`).set(bearer(tk.d1)).set("content-type", "application/octet-stream").send(PNG);
    expect(photo.status).toBe(200);
    expect(photo.body.hasPhoto).toBe(true);
    expect((await get(`/defects/${s.def1}/photo`, tk.fm)).status).toBe(200);
    const r = await readiness(`vehicleId=${s.v2}`, tk.d1);
    expect(r.reasons.find((x) => x.code === "defect_not_drivable")).toMatchObject({ risk: "R3", outcome: "restricted" });
    const fuel = await post("/fuel-entries", tk.d1, { vehicleId: s.v2, odometer: 500, fuelType: "PET92", quantity: 30, amountMinor: 45_000, isFull: true, payment: "card" });
    expect(fuel.status).toBe(201);
    expect(fuel.body.flags).toContain("vehicle_restricted");
    expect(fuel.body.status).toBe("accepted");
    expect((await post(`/defects/${s.def1}/triage`, tk.d1)).status).toBe(403);
    expect((await post(`/defects/${s.def1}/triage`, tk.fm)).body.status).toBe("triaged");
    expect((await readiness(`vehicleId=${s.v2}`)).reasons.some((x) => x.code === "defect_not_drivable")).toBe(false);
  });

  it("US-E10-04 offline: defect.report syncs, its photo resumes as a defect_photo upload, and the read set carries readiness", async () => {
    const g = await post("/sync/grant", tk.d1);
    expect(g.status).toBe(200);
    const eventId = newId();
    const res = await post("/sync/events", tk.d1, { events: [{ eventId, type: "defect.report", deviceSeq: 1, deviceTime: new Date().toISOString(), grantId: g.body.grant.grantId, elapsedMs: 1_000, payload: { vehicleId: s.v2, description: "Steering pulls left", severity: "critical", drivable: false } }] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ status: "accepted", recordId: eventId });
    s.def2 = eventId;
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    const up = await post("/uploads", tk.d1, { recordType: "defect_photo", recordId: eventId, totalBytes: PNG.length, sha256 });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    const chunk = await h.http.patch(`/uploads/${up.body.uploadId}`).set(bearer(tk.d1)).set("content-type", "application/octet-stream").set("upload-offset", "0").send(PNG);
    expect(chunk.body.completed).toBe(true);
    const list = await get(`/defects?vehicleId=${s.v2}&status=open`, tk.fm);
    expect(list.body.items.find((x: { id: string }) => x.id === eventId)).toMatchObject({ hasPhoto: true, severity: "critical" });
    const g2 = await post("/sync/grant", tk.d1);
    expect(g2.body.readSet.readiness).toEqual([expect.objectContaining({ vehicleId: s.v2, outcome: "restricted", reasons: expect.arrayContaining([expect.objectContaining({ code: "defect_not_drivable" })]) })]);
  });

  it("US-E10-05 / WO-003..006: convert to a not-drivable work order (R4), lifecycle, downtime, close rules", async () => {
    expect((await post(`/defects/${s.def1}/duplicate`, tk.fm, { duplicateOf: s.def1, reason: "same" })).body.error.fields.duplicateOf).toBe("self");
    expect((await post(`/defects/${s.def1}/duplicate`, tk.fm, { duplicateOf: s.def2, reason: "Same steering issue" })).body.status).toBe("duplicate");
    const wo = await post(`/defects/${s.def2}/convert`, tk.fm, { title: "Fix steering", notDrivable: true });
    expect(wo.status, JSON.stringify(wo.body)).toBe(201);
    expect(wo.body).toMatchObject({ defectId: s.def2, status: "open", notDrivable: true });
    expect(wo.body.offRoadAt).toBeTruthy();
    expect((await post(`/defects/${s.def2}/convert`, tk.fm, { title: "Again", notDrivable: false })).status).toBe(409);
    const r = await readiness(`vehicleId=${s.v2}`);
    expect(r.reasons.find((x) => x.code === "wo_not_drivable")).toMatchObject({ risk: "R4", outcome: "restricted" });
    expect(r.reasons.some((x) => x.code === "defect_not_drivable")).toBe(false);
    const sec = await post("/assignments", co.token, { vehicleId: s.v2, driverId: s.d2, role: "secondary" });
    expect(sec.body.error.fields.vehicleId).toBe("wo_not_drivable");
    expect((await post("/readiness/overrides", tk.fm, { ruleCode: "wo_not_drivable", entityType: "vehicle", entityId: s.v2, reason: "Need it today", expiresAt: at(1) })).status).toBe(403);

    expect((await post(`/work-orders/${wo.body.id}/status`, tk.fm, { status: "closed" })).status).toBe(409);
    expect((await post(`/work-orders/${wo.body.id}/status`, tk.fm, { status: "in_progress" })).body.status).toBe("in_progress");
    const done = await post(`/work-orders/${wo.body.id}/status`, tk.fm, { status: "completed" });
    expect(done.body.returnToServiceAt).toBeTruthy();
    expect(done.body.downtimeHours).toBeGreaterThanOrEqual(0);
    expect((await readiness(`vehicleId=${s.v2}`)).reasons.some((x) => x.code === "wo_not_drivable")).toBe(false);
    expect((await post(`/work-orders/${wo.body.id}/status`, tk.fm, { status: "closed" })).body.error.fields.reason).toBe("visit_or_reason_required");
    expect((await post(`/work-orders/${wo.body.id}/status`, tk.fm, { status: "closed", reason: "Fixed under warranty, no invoice" })).body).toMatchObject({ status: "closed", closeReason: "Fixed under warranty, no invoice" });
    expect((await get("/work-orders?status=active", tk.fm)).body.items.some((w: { id: string }) => w.id === wo.body.id)).toBe(false);
  });

  it("US-E10-08: a work order with a completed visit closes without a reason", async () => {
    const wo = await post("/work-orders", tk.fm, { vehicleId: s.v1, type: "corrective", title: "Replace wipers", scheduledFor: day(2) });
    expect(wo.body.status).toBe("scheduled");
    const v = await post("/maintenance/visits", tk.fm, { vehicleId: s.v1, workOrderId: wo.body.id, type: "corrective", visitDate: day(0), odometer: 13_060, netMinor: 5_000, complete: true });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    await post(`/work-orders/${wo.body.id}/status`, tk.fm, { status: "completed" });
    const closed = await post(`/work-orders/${wo.body.id}/status`, tk.fm, { status: "closed" });
    expect(closed.body).toMatchObject({ status: "closed", hasCompletedVisit: true });
    expect((await post("/maintenance/visits", tk.fm, { vehicleId: s.v1, workOrderId: wo.body.id, type: "corrective", visitDate: day(0) })).status).toBe(409);
  });

  it("US-E12-01: the company may raise a rule's risk, never lower it", async () => {
    const rules = await get("/readiness/rules", tk.d1);
    expect(rules.status).toBe(200);
    expect(rules.body.items.find((r: { code: string }) => r.code === "doc_missing")).toMatchObject({ defaultRisk: "R2", companyRisk: null, configurable: true });
    expect((await post("/readiness/rules/doc_missing", co.token, { risk: "R1" })).body.error.fields.risk).toBe("lower_than_default");
    expect((await post("/readiness/rules/doc_expired", co.token, { risk: "R4" })).body.error.fields.risk).toBe("not_configurable");
    expect((await post("/readiness/rules/doc_missing", tk.fm, { risk: "R3" })).status).toBe(403);
    const set = await post("/readiness/rules/doc_missing", co.token, { risk: "R3" });
    expect(set.body).toMatchObject({ companyRisk: "R3" });
    const r = await readiness(`vehicleId=${s.v1}`);
    expect(r.outcome).toBe("restricted");
    expect(r.reasons.find((x) => x.code === "doc_missing")).toMatchObject({ risk: "R3", outcome: "restricted" });
  });
});
