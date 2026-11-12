import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@fleet/db";
import { Harness, bearer, vehicleBody } from "./test/harness.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

run("Fleet API — M0 walking skeleton (integration)", () => {
  const h = new Harness(ADMIN!);
  const state: Record<string, string> = {};
  let slugA = "";
  let slugB = "";

  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it("rejects unauthenticated requests", async () => {
    const r = await h.http.get("/vehicles");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("unauthorized");
  });

  it("platform admin must enrol MFA before any session exists (SEC-004)", async () => {
    const step1 = await h.http.post("/auth/login").send({ email: "root@platform.test", password: "platform-admin-pass" });
    expect(step1.status).toBe(200);
    expect(step1.body.mfa).toBe("enroll");
    expect(step1.body.accessToken).toBeUndefined();
    expect(step1.headers["set-cookie"]).toBeUndefined();
    expect(step1.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const bad = await h.http.post("/auth/mfa").send({ mfaToken: step1.body.mfaToken, code: "000000" });
    expect(bad.status).toBe(401);
    const login = await h.finishMfa("root@platform.test", step1);
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("platform_admin");
    expect(login.body.user.mfaEnabled).toBe(true);
    expect(login.body.refreshToken).toBeUndefined(); // web: cookie only
    expect(String(login.headers["set-cookie"])).toMatch(/fleet_rt=.*HttpOnly/);
    state.platform = login.body.accessToken;
    // Second login asks to verify (not enrol again)
    const again = await h.http.post("/auth/login").send({ email: "root@platform.test", password: "platform-admin-pass" });
    expect(again.body.mfa).toBe("verify");
    expect(again.body.secret).toBeUndefined();
  });

  it("platform admin provisions two tenants (US-E01-01)", async () => {
    slugA = h.slug("a");
    slugB = h.slug("b");
    for (const [slug, key] of [[slugA, "A"], [slugB, "B"]] as const) {
      const r = await h.http.post("/platform/tenants").set(bearer(state.platform)).send({ name: `Company ${key}`, slug, countryCode: "EG", adminEmail: `admin${key}@co.test`, adminName: `Admin ${key}` });
      expect(r.status).toBe(202);
      state[`invite${key}`] = r.body.adminInviteToken;
      state[`tenant${key}`] = r.body.tenant.id;
      const t = await h.http.get(`/platform/tenants/${r.body.tenant.id}`).set(bearer(state.platform));
      expect(t.body.status).toBe("active");
      expect(t.body.schemaVersion).toBe(2);
    }
    const dup = await h.http.post("/platform/tenants").set(bearer(state.platform)).send({ name: "Dup", slug: slugA, countryCode: "EG", adminEmail: "x@co.test", adminName: "Xavier" });
    expect(dup.status).toBe(409);
  });

  it("platform admin has no access to tenant data (no break-glass)", async () => {
    expect((await h.http.get("/vehicles").set(bearer(state.platform))).status).toBe(403);
  });

  it("company admins accept invites with MFA; an invite works only once", async () => {
    for (const k of ["A", "B"]) {
      const r = await h.acceptInvite(`admin${k}@co.test`, state[`invite${k}`]!, "company-admin-pass");
      expect(r.status).toBe(200);
      expect(r.body.user.role).toBe("company_admin");
      expect(r.body.user.tenant.slug).toBe(k === "A" ? slugA : slugB);
      state[`admin${k}`] = r.body.accessToken;
    }
    const again = await h.http.post("/auth/accept-invite").send({ token: state.inviteA, password: "company-admin-pass" });
    expect(again.status).toBe(400);
    const branches = await h.http.get("/branches").set(bearer(state.adminA));
    expect(branches.body.items).toHaveLength(1);
    state.branchA = branches.body.items[0].id;
  });

  it("creates a vehicle and enforces US-E05-01 rules", async () => {
    const id = newId();
    const r = await h.http.post("/vehicles").set(bearer(state.adminA)).send({ ...vehicleBody(state.branchA!), id, tenantId: state.tenantB });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id, fleetNumber: "F-001", status: "active", primaryTankCapacity: 70, disposal: null });
    state.vehicleA = id;

    const retry = await h.http.post("/vehicles").set(bearer(state.adminA)).send({ ...vehicleBody(state.branchA!), id });
    expect(retry.status).toBe(200); // idempotent

    const dup = await h.http.post("/vehicles").set(bearer(state.adminA)).send(vehicleBody(state.branchA!, { fleetNumber: "F-002", registrationNumber: "طبع-1234" }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.registrationNumber).toContain(id); // names the conflicting vehicle

    const missing = await h.http.post("/vehicles").set(bearer(state.adminA)).send(vehicleBody(state.branchA!, { fleetNumber: "F-003", registrationNumber: "X 1", primaryTankCapacity: null, requiredLicenseCategory: null }));
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.error.fields).sort()).toEqual(["primaryTankCapacity", "requiredLicenseCategory"]);
  });

  it("isolates tenants: B cannot see A's vehicle, and tenantId in the body was ignored (US-E01-02)", async () => {
    expect((await h.http.get(`/vehicles/${state.vehicleA}`).set(bearer(state.adminB))).status).toBe(404);
    expect((await h.http.get("/vehicles").set(bearer(state.adminB))).body.items).toEqual([]);
    expect((await h.http.get(`/vehicles/${state.vehicleA}`).set(bearer(state.adminA))).status).toBe(200);
    const crossBranch = await h.http.post("/vehicles").set(bearer(state.adminB)).send(vehicleBody(state.branchA!, { fleetNumber: "Z", registrationNumber: "Z 9" }));
    expect(crossBranch.status).toBe(422); // A's branch id does not exist in B's database
  });

  it("driver: create, issue code, activate device, see vehicles (SEC-005)", async () => {
    const d = await h.http.post("/drivers").set(bearer(state.adminA)).send({ branchId: state.branchA, fullName: "أحمد علي", username: `ahmed.${h.sfx}` });
    expect(d.status).toBe(201);
    state.driverA = d.body.id;
    const branchB = (await h.http.get("/branches").set(bearer(state.adminB))).body.items[0].id;
    const taken = await h.http.post("/drivers").set(bearer(state.adminB)).send({ branchId: branchB, fullName: "Other Person", username: `ahmed.${h.sfx}` });
    expect(taken.status).toBe(409);

    const code = await h.http.post(`/drivers/${state.driverA}/activation-code`).set(bearer(state.adminA));
    expect(code.status).toBe(200);
    expect(code.body.code).toMatch(/^[2-9A-Z]{8}$/);
    expect((await h.http.post(`/drivers/${state.driverA}/activation-code`).set(bearer(state.adminB))).status).toBe(404);

    const wrong = await h.http.post("/auth/driver/activate").send({ username: `ahmed.${h.sfx}`, code: "AAAAAAAA", deviceName: "Phone", platform: "android" });
    expect(wrong.status).toBe(401);
    const ok = await h.http.post("/auth/driver/activate").send({ username: `ahmed.${h.sfx}`, code: code.body.code.toLowerCase(), deviceName: "Phone", platform: "android" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe("driver");
    expect(ok.body.refreshToken).toBeTruthy(); // device: body
    state.driverToken = ok.body.accessToken;
    state.driverRefresh = ok.body.refreshToken;

    const reused = await h.http.post("/auth/driver/activate").send({ username: `ahmed.${h.sfx}`, code: code.body.code, deviceName: "Other", platform: "android" });
    expect(reused.status).toBe(401);

    const list = await h.http.get("/vehicles").set(bearer(state.driverToken));
    expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([state.vehicleA]);
    expect((await h.http.post("/vehicles").set(bearer(state.driverToken)).send(vehicleBody(state.branchA!, { fleetNumber: "D" }))).status).toBe(403);
    const me = await h.http.get("/drivers").set(bearer(state.driverToken));
    expect(me.body.items.map((x: { id: string }) => x.id)).toEqual([state.driverA]);
    const drivers = await h.http.get("/drivers").set(bearer(state.adminA));
    expect(drivers.body.items[0].hasActiveDevice).toBe(true);
  });

  it("refresh tokens rotate, and reusing an old one revokes the session family", async () => {
    const r1 = await h.http.post("/auth/refresh").send({ refreshToken: state.driverRefresh });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(state.driverRefresh);
    expect((await h.http.post("/auth/refresh").send({ refreshToken: state.driverRefresh })).status).toBe(401);
    expect((await h.http.post("/auth/refresh").send({ refreshToken: r1.body.refreshToken })).status).toBe(401); // whole family revoked
  });

  it("web refresh works from the HttpOnly cookie", async () => {
    const login = await h.login("adminA@co.test", "company-admin-pass");
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const r = await h.http.post("/auth/refresh").set("cookie", cookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.user.tenant.slug).toBe(slugA);
  });

  it("web session ends after 30 minutes idle (D-SEC-WEBIDLE)", async () => {
    const login = await h.login("adminA@co.test", "company-admin-pass");
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    await h.controlPool.query("UPDATE refresh_tokens SET created_at = now() - interval '31 minutes' WHERE revoked_at IS NULL AND device_id IS NULL");
    const r = await h.http.post("/auth/refresh").set("cookie", cookie).send({});
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("session_idle");
  });

  it("issuing a new code revokes the old device immediately", async () => {
    const fresh = await h.http.post(`/drivers/${state.driverA}/activation-code`).set(bearer(state.adminA));
    const act = await h.http.post("/auth/driver/activate").send({ username: `ahmed.${h.sfx}`, code: fresh.body.code, deviceName: "Phone 2", platform: "android" });
    expect((await h.http.get("/vehicles").set(bearer(act.body.accessToken))).status).toBe(200);
    await h.http.post(`/drivers/${state.driverA}/activation-code`).set(bearer(state.adminA));
    expect((await h.http.get("/vehicles").set(bearer(act.body.accessToken))).status).toBe(401);
  });

  it("locks the account after 5 failed logins (D-SEC-LOCKOUT)", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await h.http.post("/auth/login").send({ email: "adminB@co.test", password: "wrong-password" })).status).toBe(401);
    }
    const locked = await h.http.post("/auth/login").send({ email: "adminB@co.test", password: "company-admin-pass" });
    expect(locked.status).toBe(423);
  });

  it("writes an append-only audit trail in the tenant database", async () => {
    const c = h.tenantDb(slugA);
    await c.connect();
    const { rows } = await c.query("SELECT action FROM audit_log WHERE entity_type IS NOT NULL ORDER BY id");
    await c.end();
    expect(rows.map((r) => r.action)).toEqual(["vehicle.created", "driver.created", "driver.activation_code_issued", "driver.activation_code_issued", "driver.activation_code_issued"]);
  });

  it("serves the OpenAPI document generated from the contract", async () => {
    const r = await h.http.get("/openapi.json");
    expect(r.status).toBe(200);
    expect(r.body.paths["/vehicles"].post.operationId).toBe("createVehicle");
    expect(r.body.paths["/vendors"].get.parameters[0].in).toBe("query");
  });
});
