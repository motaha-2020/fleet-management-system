import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Harness, bearer } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

run("Fleet API — M6 hardening (integration)", () => {
  const h = new Harness(ADMIN!);
  let platform = "";
  let co: Awaited<ReturnType<Harness["company"]>>;
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
});
