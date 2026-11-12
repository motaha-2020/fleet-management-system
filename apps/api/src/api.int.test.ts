import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pg from "pg";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { adminUrlFor, controlDb, ensureControlDb, newId, Provisioner, SecretBox, schema } from "@fleet/db";
import { createApp } from "./bootstrap.js";
import type { AppConfig } from "./config.js";
import type { JobQueue } from "./infra/infra.module.js";
import { AuthService } from "./auth/auth.service.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

run("Fleet API — M0 walking skeleton (integration)", () => {
  const sfx = randomBytes(3).toString("hex");
  const controlName = `fleet_test_api_${sfx}`;
  const controlUrl = adminUrlFor(ADMIN!, controlName);
  const masterKey = randomBytes(32).toString("base64");
  const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const slugA = `a${sfx}`;
  const slugB = `b${sfx}`;
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let controlPool: pg.Pool;

  const config = (): AppConfig => ({
    controlDatabaseUrl: controlUrl,
    adminDatabaseUrl: ADMIN!,
    tenantDbHost: new URL(ADMIN!).hostname,
    tenantDbPort: Number(new URL(ADMIN!).port || 5432),
    masterKey,
    jwtPrivateKeyPem: pem,
    port: 0,
    corsOrigins: ["http://localhost:3000"],
    secureCookies: false,
  });

  // Runs provisioning inline instead of through pg-boss, so the test is deterministic.
  const inlineQueue = (): JobQueue => ({
    async send(_name, data) {
      const c = config();
      await new Provisioner({ control: controlPool, adminUrl: c.adminDatabaseUrl, secrets: new SecretBox(masterKey), tenantDbHost: c.tenantDbHost, tenantDbPort: c.tenantDbPort })
        .provision((data as { tenantId: string }).tenantId);
    },
    async stop() {},
  });

  const bearer = (t: string | undefined) => ({ authorization: `Bearer ${t}` });
  const state: Record<string, string> = {};

  beforeAll(async () => {
    await ensureControlDb(ADMIN!, controlUrl);
    controlPool = new pg.Pool({ connectionString: controlUrl });
    const { db, pool } = controlDb(controlUrl);
    await db.insert(schema.identities).values({ id: newId(), email: "root@platform.test", displayName: "Root", passwordHash: await AuthService.hashPassword("platform-admin-pass"), isPlatformAdmin: true });
    await pool.end();
    app = await createApp(config(), { queue: inlineQueue(), logger: false });
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await controlPool?.end();
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    for (const s of [slugA, slugB]) {
      await admin.query(`DROP DATABASE IF EXISTS fleet_t_${s} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS fleet_t_${s}_app`);
    }
    await admin.query(`DROP DATABASE IF EXISTS ${controlName} WITH (FORCE)`);
    await admin.end();
  });

  it("rejects unauthenticated requests", async () => {
    const r = await http.get("/vehicles");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("unauthorized");
  });

  it("platform admin logs in and provisions two tenants (US-E01-01)", async () => {
    const login = await http.post("/auth/login").send({ email: "root@platform.test", password: "platform-admin-pass" });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("platform_admin");
    expect(login.body.refreshToken).toBeUndefined(); // web: cookie only
    expect(String(login.headers["set-cookie"])).toMatch(/fleet_rt=.*HttpOnly/);
    state.platform = login.body.accessToken;

    for (const [slug, key] of [[slugA, "A"], [slugB, "B"]] as const) {
      const r = await http.post("/platform/tenants").set(bearer(state.platform)).send({ name: `Company ${key}`, slug, countryCode: "EG", adminEmail: `admin${key}@co.test`, adminName: `Admin ${key}` });
      expect(r.status).toBe(202);
      state[`invite${key}`] = r.body.adminInviteToken;
      state[`tenant${key}`] = r.body.tenant.id;
      const t = await http.get(`/platform/tenants/${r.body.tenant.id}`).set(bearer(state.platform));
      expect(t.body.status).toBe("active");
      expect(t.body.schemaVersion).toBe(1);
    }
    const dup = await http.post("/platform/tenants").set(bearer(state.platform)).send({ name: "Dup", slug: slugA, countryCode: "EG", adminEmail: "x@co.test", adminName: "Xavier" });
    expect(dup.status).toBe(409);
  });

  it("platform admin has no access to tenant data (no break-glass)", async () => {
    expect((await http.get("/vehicles").set(bearer(state.platform))).status).toBe(403);
  });

  it("company admins accept invites; an invite works only once", async () => {
    for (const k of ["A", "B"]) {
      const r = await http.post("/auth/accept-invite").send({ token: state[`invite${k}`], password: "company-admin-pass" });
      expect(r.status).toBe(200);
      expect(r.body.user.role).toBe("company_admin");
      expect(r.body.user.tenant.slug).toBe(k === "A" ? slugA : slugB);
      state[`admin${k}`] = r.body.accessToken;
    }
    const again = await http.post("/auth/accept-invite").send({ token: state.inviteA, password: "company-admin-pass" });
    expect(again.status).toBe(400);
    const branches = await http.get("/branches").set(bearer(state.adminA));
    expect(branches.body.items).toHaveLength(1);
    state.branchA = branches.body.items[0].id;
  });

  const vehicle = (over: Record<string, unknown> = {}) => ({
    branchId: state.branchA, fleetNumber: "F-001", registrationNumber: "ط ب ع ١٢٣٤", make: "Toyota", model: "Hiace", year: 2022,
    primaryFuelType: "PET92", primaryTankCapacity: 70, secondaryFuelType: "CNG", secondaryTankCapacity: 15,
    meterType: "distance", requiredLicenseCategory: "PRO3", ownershipType: "owned", ...over,
  });

  it("creates a vehicle and enforces US-E05-01 rules", async () => {
    const id = newId();
    const r = await http.post("/vehicles").set(bearer(state.adminA)).send({ ...vehicle(), id, tenantId: state.tenantB });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id, fleetNumber: "F-001", status: "active", primaryTankCapacity: 70 });
    state.vehicleA = id;

    const retry = await http.post("/vehicles").set(bearer(state.adminA)).send({ ...vehicle(), id });
    expect(retry.status).toBe(200); // idempotent

    const dup = await http.post("/vehicles").set(bearer(state.adminA)).send(vehicle({ fleetNumber: "F-002", registrationNumber: "طبع-1234" }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.fields.registrationNumber).toContain(id); // names the conflicting vehicle

    const missing = await http.post("/vehicles").set(bearer(state.adminA)).send(vehicle({ fleetNumber: "F-003", registrationNumber: "X 1", primaryTankCapacity: null, requiredLicenseCategory: null }));
    expect(missing.status).toBe(422);
    expect(Object.keys(missing.body.error.fields).sort()).toEqual(["primaryTankCapacity", "requiredLicenseCategory"]);
  });

  it("isolates tenants: B cannot see A's vehicle, and tenantId in the body was ignored (US-E01-02)", async () => {
    expect((await http.get(`/vehicles/${state.vehicleA}`).set(bearer(state.adminB))).status).toBe(404);
    expect((await http.get("/vehicles").set(bearer(state.adminB))).body.items).toEqual([]);
    expect((await http.get(`/vehicles/${state.vehicleA}`).set(bearer(state.adminA))).status).toBe(200);
    const branchesB = await http.get("/branches").set(bearer(state.adminB));
    const crossBranch = await http.post("/vehicles").set(bearer(state.adminB)).send(vehicle({ fleetNumber: "Z", registrationNumber: "Z 9" }));
    expect(crossBranch.status).toBe(422); // A's branch id does not exist in B's database
    expect(branchesB.body.items[0].id).not.toBe(state.branchA);
  });

  it("driver: create, issue code, activate device, see vehicles (SEC-005)", async () => {
    const d = await http.post("/drivers").set(bearer(state.adminA)).send({ branchId: state.branchA, fullName: "أحمد علي", username: `ahmed.${sfx}` });
    expect(d.status).toBe(201);
    state.driverA = d.body.id;
    const taken = await http.post("/drivers").set(bearer(state.adminB)).send({ branchId: (await http.get("/branches").set(bearer(state.adminB))).body.items[0].id, fullName: "Other Person", username: `ahmed.${sfx}` });
    expect(taken.status).toBe(409);

    const code = await http.post(`/drivers/${state.driverA}/activation-code`).set(bearer(state.adminA));
    expect(code.status).toBe(200);
    expect(code.body.code).toMatch(/^[2-9A-Z]{8}$/);
    expect((await http.post(`/drivers/${state.driverA}/activation-code`).set(bearer(state.adminB))).status).toBe(404);

    const wrong = await http.post("/auth/driver/activate").send({ username: `ahmed.${sfx}`, code: "AAAAAAAA", deviceName: "Phone", platform: "android" });
    expect(wrong.status).toBe(401);

    const ok = await http.post("/auth/driver/activate").send({ username: `ahmed.${sfx}`, code: code.body.code.toLowerCase(), deviceName: "Phone", platform: "android" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe("driver");
    expect(ok.body.refreshToken).toBeTruthy(); // device: body
    state.driverToken = ok.body.accessToken;
    state.driverRefresh = ok.body.refreshToken;

    const reused = await http.post("/auth/driver/activate").send({ username: `ahmed.${sfx}`, code: code.body.code, deviceName: "Other", platform: "android" });
    expect(reused.status).toBe(401);

    const list = await http.get("/vehicles").set(bearer(state.driverToken));
    expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([state.vehicleA]);
    expect((await http.post("/vehicles").set(bearer(state.driverToken)).send(vehicle({ fleetNumber: "D" }))).status).toBe(403);
    const me = await http.get("/drivers").set(bearer(state.driverToken));
    expect(me.body.items.map((x: { id: string }) => x.id)).toEqual([state.driverA]);

    const drivers = await http.get("/drivers").set(bearer(state.adminA));
    expect(drivers.body.items[0].hasActiveDevice).toBe(true);
  });

  it("refresh tokens rotate, and reusing an old one revokes the session family", async () => {
    const r1 = await http.post("/auth/refresh").send({ refreshToken: state.driverRefresh });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(state.driverRefresh);
    const reuse = await http.post("/auth/refresh").send({ refreshToken: state.driverRefresh });
    expect(reuse.status).toBe(401);
    const r2 = await http.post("/auth/refresh").send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(401); // whole family revoked
  });

  it("web refresh works from the HttpOnly cookie", async () => {
    const login = await http.post("/auth/login").send({ email: "adminA@co.test", password: "company-admin-pass" });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const r = await http.post("/auth/refresh").set("cookie", cookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.user.tenant.slug).toBe(slugA);
  });

  it("issuing a new code revokes the old device immediately", async () => {
    expect((await http.get("/vehicles").set(bearer(state.driverToken))).status).toBe(200);
    await http.post(`/drivers/${state.driverA}/activation-code`).set(bearer(state.adminA));
    const r = await http.get("/vehicles").set(bearer(state.driverToken));
    expect(r.status).toBe(401);
  });

  it("locks the account after 5 failed logins (D-SEC-LOCKOUT)", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await http.post("/auth/login").send({ email: "adminB@co.test", password: "wrong-password" })).status).toBe(401);
    }
    const locked = await http.post("/auth/login").send({ email: "adminB@co.test", password: "company-admin-pass" });
    expect(locked.status).toBe(423);
  });

  it("writes an append-only audit trail in the tenant database", async () => {
    const c = new pg.Client({ connectionString: adminUrlFor(ADMIN!, `fleet_t_${slugA}`) });
    await c.connect();
    const { rows } = await c.query("SELECT action, entity_id FROM audit_log WHERE entity_type IS NOT NULL ORDER BY id");
    await c.end();
    expect(rows.map((r) => r.action)).toEqual(["vehicle.created", "driver.created", "driver.activation_code_issued", "driver.activation_code_issued"]);
  });

  it("serves the OpenAPI document generated from the contract", async () => {
    const r = await http.get("/openapi.json");
    expect(r.status).toBe(200);
    expect(r.body.paths["/vehicles"].post.operationId).toBe("createVehicle");
  });
});
