import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@fleet/db";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

run("Fleet API — M6 hardening (integration)", () => {
  const h = new Harness(ADMIN!);
  let platform = "";
  let co: Awaited<ReturnType<Harness["company"]>>;
  const s: Record<string, string> = {};
  const post = (path: string, token: string | undefined, body?: object) => h.http.post(path).set(bearer(token)).send(body ?? {});

  beforeAll(async () => {
    await h.start();
    platform = (await h.login("root@platform.test", "platform-admin-pass")).body.accessToken;
    co = await h.company(platform, "m6");
  });
  afterAll(() => h.stop());

  it("security headers on every response", async () => {
    const r = await h.http.get("/health");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });

  it("invites are emailed with the accept link; a common password is refused and the link still works", async () => {
    const email = `ops@${co.slug}.test`;
    const r = await post("/users", co.token, { email, displayName: "Ops Lead", role: "finance_reviewer" });
    expect(r.status).toBe(201);
    const mail = h.mail.sent.find((m) => m.to === email)!;
    expect(mail.subject).toContain("دعوة للانضمام");
    expect(mail.text).toContain(`http://localhost:3000/accept-invite?token=${encodeURIComponent(r.body.inviteToken)}`);
    const weak = await h.http.post("/auth/accept-invite").send({ token: r.body.inviteToken, password: "password1234" });
    expect(weak.status).toBe(422);
    expect(weak.body.error.fields.password).toBe("too_common");
    const ok = await h.http.post("/auth/accept-invite").send({ token: r.body.inviteToken, password: "a-much-better-passphrase" });
    expect(ok.status).toBe(200);
    // the platform's company-admin invite is emailed too
    expect(h.mail.sent.some((m) => m.to === co.email)).toBe(true);
  });

  it("MFA recovery codes: shown once at enrolment, each works once, regenerating needs a current code", async () => {
    const slug = h.slug("rc");
    const email = `admin@${slug}.test`;
    const t = await post("/platform/tenants", platform, { name: "Recovery Co", slug, countryCode: "EG", adminEmail: email, adminName: "RC Admin" });
    expect(t.status).toBe(202);
    const enrolled = await h.acceptInvite(email, t.body.adminInviteToken, "recovery-admin-pass");
    expect(enrolled.status).toBe(200);
    const codes = enrolled.body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(codes.every((c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c))).toBe(true);
    const login = () => h.http.post("/auth/login").send({ email, password: "recovery-admin-pass" });
    const c1 = await login();
    const viaCode = await h.http.post("/auth/mfa").send({ mfaToken: c1.body.mfaToken, code: codes[0]!.toLowerCase() });
    expect(viaCode.status).toBe(200);
    expect(viaCode.body.recoveryCodes).toBeUndefined();
    const again = await h.http.post("/auth/mfa").send({ mfaToken: (await login()).body.mfaToken, code: codes[0] });
    expect(again.status).toBe(401);
    const token = viaCode.body.accessToken as string;
    expect((await post("/me/mfa/recovery-codes", token, { code: "000000" })).status).toBe(401);
    const fresh = await post("/me/mfa/recovery-codes", token, { code: await h.code(email) });
    expect(fresh.status).toBe(200);
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect((await h.http.post("/auth/mfa").send({ mfaToken: (await login()).body.mfaToken, code: codes[1] })).status).toBe(401); // old set is gone
    expect((await h.http.post("/auth/mfa").send({ mfaToken: (await login()).body.mfaToken, code: fresh.body.recoveryCodes[0] })).status).toBe(200);
  });

  it("US-E02-06: no grant → no tenant data; approved grant → read-only for 24 h, every view in the customer's audit", async () => {
    expect((await h.http.get("/vehicles").set(bearer(platform))).status).toBe(403);
    expect((await post(`/platform/tenants/${co.tenantId}/support-access`, platform, { reason: "short" })).status).toBe(422);
    const req = await post(`/platform/tenants/${co.tenantId}/support-access`, platform, { reason: "Customer ticket #431: fuel report totals look wrong" });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe("requested");
    expect((await post(`/platform/support-access/${req.body.id}/session`, platform)).status).toBe(409);
    // The company admin sees and approves the request
    const list = await h.http.get("/support-access").set(bearer(co.token));
    expect(list.body.items).toEqual([expect.objectContaining({ id: req.body.id, reason: expect.stringContaining("#431"), requestedByName: "Root" })]);
    const ok = await post(`/support-access/${req.body.id}/decision`, co.token, { approve: true });
    expect(ok.body.status).toBe("approved");
    const hours = (Date.parse(ok.body.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect((await post(`/support-access/${req.body.id}/decision`, co.token, { approve: false })).status).toBe(409);

    const s = await post(`/platform/support-access/${req.body.id}/session`, platform);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.user).toMatchObject({ role: "viewer", tenant: { id: co.tenantId }, support: { grantId: req.body.id } });
    const support = s.body.accessToken as string;
    expect((await h.http.get("/vehicles").set(bearer(support))).status).toBe(200);
    expect((await h.http.get("/me").set(bearer(support))).body.support.grantId).toBe(req.body.id);
    const write = await post("/branches", support, { code: "X1", name: "Nope" });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("support_read_only");
    const audit = (await h.http.get("/audit?entityType=support_access").set(bearer(co.token))).body.items as { action: string; after: { path?: string } }[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["support.requested", "support.approved", "support.session_opened", "support.viewed"]));
    expect(audit.some((a) => a.action === "support.viewed" && a.after.path === "/vehicles")).toBe(true);

    // Revoked → the session stops at once
    expect((await post(`/support-access/${req.body.id}/revoke`, co.token)).body.status).toBe("revoked");
    expect((await h.http.get("/vehicles").set(bearer(support))).status).toBe(401);

    // Expired grants stop too
    const r2 = await post(`/platform/tenants/${co.tenantId}/support-access`, platform, { reason: "Follow-up on ticket #431 numbers" });
    await post(`/support-access/${r2.body.id}/decision`, co.token, { approve: true });
    const s2 = (await post(`/platform/support-access/${r2.body.id}/session`, platform)).body.accessToken as string;
    await h.controlPool.query("UPDATE break_glass_grants SET expires_at = now() - interval '1 minute' WHERE id = $1", [r2.body.id]);
    expect((await h.http.get("/vehicles").set(bearer(s2))).status).toBe(401);
    expect((await h.http.get("/platform/support-access").set(bearer(platform))).body.items.find((g: { id: string }) => g.id === r2.body.id).status).toBe("expired");
  });

  it("US-E19-02 / NFR-008: a sync failure shows in monitoring with the tenant and the reason within seconds", async () => {
    const d = await post("/drivers", co.token, { branchId: co.hq, fullName: "Ops Driver", username: `ops.${h.sfx}`, licenseCategories: ["PRO3"], licenseExpiry: "2030-01-01" });
    const code = await post(`/drivers/${d.body.id}/activation-code`, co.token);
    const drv = (await h.http.post("/auth/driver/activate").send({ username: `ops.${h.sfx}`, code: code.body.code, deviceName: "P", platform: "android" })).body.accessToken as string;
    const g = await post("/sync/grant", drv);
    const ev = { eventId: newId(), type: "odometer.record", deviceSeq: 1, deviceTime: new Date().toISOString(), grantId: g.body.grant.grantId, elapsedMs: 10, payload: { vehicleId: newId(), odometer: 5 } };
    const r = await post("/sync/events", drv, { events: [ev] });
    expect(r.body.results[0]).toMatchObject({ status: "rejected", code: "unknown_vehicle" });
    const ops = await h.http.get("/platform/ops?kind=sync&sinceMinutes=5").set(bearer(platform));
    expect(ops.status).toBe(200);
    expect(ops.body.items[0]).toMatchObject({ tenantId: co.tenantId, tenantName: "Company m6", kind: "sync", severity: "error", code: "rejected:unknown_vehicle", detail: expect.objectContaining({ eventId: ev.eventId }) });
    const sum = await h.http.get("/platform/ops/summary?sinceMinutes=5").set(bearer(platform));
    expect(sum.body.rows).toEqual(expect.arrayContaining([expect.objectContaining({ tenantId: co.tenantId, kind: "sync", errors: 1 })]));
    expect((await h.http.get("/platform/ops").set(bearer(co.token))).status).toBe(403);
    s.driverToken = drv;
    s.driverId = d.body.id;
  });

  it("US-E19-04 / PRV-002: the driver's permission decision is recorded on the device and visible to the office", async () => {
    const r = await post("/me/consents", s.driverToken, { kind: "camera", decision: "denied", decidedAt: new Date().toISOString(), appVersion: "1.4.0" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await post("/me/consents", s.driverToken, { kind: "camera", decision: "granted", decidedAt: new Date(Date.now() + 1000).toISOString() });
    const list = await h.http.get(`/consents?driverId=${s.driverId}`).set(bearer(co.token));
    expect(list.body.items.map((c: { decision: string }) => c.decision)).toEqual(["granted", "denied"]);
    expect(list.body.items[1]).toMatchObject({ kind: "camera", appVersion: "1.4.0", driverId: s.driverId });
    expect(list.body.items[1].deviceId).toBeTruthy();
    expect((await post("/me/consents", co.token, { kind: "camera", decision: "granted", decidedAt: new Date().toISOString() })).status).toBe(403);
  });

  it("NTF-001 push: a driver device registers its token; alerts are pushed; an unregistered token is dropped", async () => {
    const token = "ExponentPushToken[abcDEF1234567890xyz]";
    expect((await post("/me/push-token", s.driverToken, { token: "not-a-token" })).status).toBe(422);
    expect((await post("/me/push-token", co.token, { token })).status).toBe(403);
    expect((await post("/me/push-token", s.driverToken, { token })).status).toBe(200);
    const v = await post("/vehicles", co.token, vehicleBody(co.hq, { fleetNumber: "PU-1", registrationNumber: "PU 1", secondaryFuelType: null, secondaryTankCapacity: null }));
    const d1 = await post("/defects", s.driverToken, { vehicleId: v.body.id, description: "Mirror cracked", severity: "low", drivable: true });
    expect(d1.status).toBe(201);
    expect((await post(`/defects/${d1.body.id}/reject`, co.token, { reason: "Already replaced yesterday" })).status).toBe(200);
    await post("/alerts/scan", co.token); // delivers queued notifications
    const pushed = h.push.sent.find((m) => m.to === token)!;
    expect(pushed.title).toContain("تم رفض بلاغك");
    expect(pushed.body).toContain("Already replaced yesterday");
    expect(pushed.data).toMatchObject({ alertId: expect.any(String) });
    let log = (await h.http.get("/notifications").set(bearer(co.token))).body.items as { channel: string; status: string; provider: string }[];
    expect(log.find((n) => n.channel === "push")).toMatchObject({ status: "sent", provider: expect.stringMatching(/^test:t-/) });

    // The app was uninstalled: the provider says the token is gone → failed once, token removed, no more pushes
    h.push.unregistered.add(token);
    const d2 = await post("/defects", s.driverToken, { vehicleId: v.body.id, description: "Horn weak", severity: "low", drivable: true });
    await post(`/defects/${d2.body.id}/reject`, co.token, { reason: "Within tolerance after test" });
    await post("/alerts/scan", co.token);
    log = (await h.http.get("/notifications?status=failed").set(bearer(co.token))).body.items;
    expect(log.find((n) => n.channel === "push")).toMatchObject({ status: "failed" });
    const [{ push_token }] = (await h.controlPool.query("SELECT push_token FROM devices WHERE push_token IS NOT NULL OR push_token_at IS NOT NULL ORDER BY push_token_at DESC LIMIT 1")).rows;
    expect(push_token).toBeNull();
    const ops = await h.http.get("/platform/ops?kind=notification&sinceMinutes=5").set(bearer(platform));
    expect(ops.body.items[0]).toMatchObject({ code: "push_token_unregistered", tenantId: co.tenantId });
  });

  it("US-E03-03 / GEN-007: a policy change does not re-judge history unless made retroactive explicitly", async () => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const v = (await post("/vehicles", co.token, vehicleBody(co.hq, { fleetNumber: "PO-1", registrationNumber: "PO 1", primaryTankCapacity: 70, secondaryFuelType: null, secondaryTankCapacity: null }))).body.id;
    const fuel = (eventAt: string, odometer: number) => post("/fuel-entries", co.token, { vehicleId: v, eventAt, odometer, fuelType: "PET92", quantity: 72, amountMinor: 108_000, isFull: true, payment: "card" });
    const old = await fuel(new Date(Date.now() - 86_400_000).toISOString(), 1_000);
    expect(old.status, JSON.stringify(old.body)).toBe(201);
    expect(old.body).toMatchObject({ status: "accepted" }); // 72 L in 70 L is within the default 5%
    expect(old.body.flags).not.toContain("tank_exceeded");

    expect((await post("/policies/fuel_tank_tolerance_pct", co.token, { value: 2, effectiveFrom: day(-1), reason: "Stricter tank check" })).body.error.fields.effectiveFrom).toBe("effective_from_in_past");
    expect((await post("/policies/fuel_tank_tolerance_pct", co.token, { value: 90, effectiveFrom: day(0), reason: "x".repeat(5) })).body.error.fields.value).toBe("out_of_range");
    const set = await post("/policies/fuel_tank_tolerance_pct", co.token, { value: 2, effectiveFrom: day(0), reason: "Stricter tank check from today" });
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    expect(set.body).toMatchObject({ retroactive: false, recalculated: 0 });

    // History is not re-judged; a new record follows the new threshold
    expect((await h.http.get(`/fuel-entries/${old.body.id}`).set(bearer(co.token))).body).toMatchObject({ status: "accepted" });
    const fresh = await fuel(new Date().toISOString(), 1_100);
    expect(fresh.body.flags).toContain("tank_exceeded");
    expect(fresh.body.status).toBe("under_review");

    // Explicitly retroactive: yesterday's entry is recalculated (status, cost) and audited
    const retro = await post("/policies/fuel_tank_tolerance_pct", co.token, { value: 1, effectiveFrom: day(-1), reason: "Audit finding: apply from yesterday", retroactive: true });
    expect(retro.status).toBe(201);
    expect(retro.body).toMatchObject({ retroactive: true });
    expect(retro.body.recalculated).toBeGreaterThanOrEqual(1);
    const after = (await h.http.get(`/fuel-entries/${old.body.id}`).set(bearer(co.token))).body;
    expect(after).toMatchObject({ status: "under_review" });
    expect(after.flags).toContain("tank_exceeded");
    const costs = (await h.http.get(`/costs?vehicleId=${v}&category=fuel`).set(bearer(co.token))).body.items;
    expect(costs).toEqual([]);
    const audit = (await h.http.get(`/audit?entityType=fuel_entry&entityId=${old.body.id}`).set(bearer(co.token))).body.items;
    expect(audit.some((a: { action: string; after: { cause?: string } }) => a.action === "fuel.recalculated" && a.after.cause === "policy_change")).toBe(true);

    const list = (await h.http.get("/policies").set(bearer(co.token))).body.items.find((p: { key: string }) => p.key === "fuel_tank_tolerance_pct");
    expect(list).toMatchObject({ default: 5, current: 2 }); // today's version (2%) is in force today; 1% applies to yesterday
    expect(list.versions).toHaveLength(2);
    expect((await h.http.get("/policies").set(bearer(s.driverToken))).status).toBe(403);
  });
});
