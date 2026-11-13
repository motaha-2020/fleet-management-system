import request from "supertest";
import pg from "pg";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import type { INestApplication } from "@nestjs/common";
import { adminUrlFor, controlDb, ensureControlDb, JOBS, newId, Provisioner, SecretBox, schema } from "@fleet/db";
import { createApp } from "../bootstrap.js";
import type { AppConfig } from "../config.js";
import type { JobQueue } from "../infra/infra.module.js";
import { AuthService } from "../auth/auth.service.js";
import type { Mailer, MailMessage } from "../infra/mailer.js";
import type { PushMessage, PushResult, PushSender } from "../infra/push.js";

/** Records pushes; tokens in `unregistered` are answered like Expo's DeviceNotRegistered. */
export class TestPush implements PushSender {
  readonly name = "test";
  readonly sent: PushMessage[] = [];
  readonly unregistered = new Set<string>();
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    return messages.map((m) => {
      if (this.unregistered.has(m.to)) return { ok: false as const, error: "DeviceNotRegistered", unregistered: true };
      this.sent.push(m);
      return { ok: true as const, id: `t-${this.sent.length}` };
    });
  }
}

/** Records emails; `failNext` makes the next sends throw (delivery failure, NTF-003). */
export class TestMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  failNext = 0;
  async send(m: MailMessage) {
    if (this.failNext > 0) { this.failNext--; throw new Error("smtp unavailable"); }
    this.sent.push(m);
    return { provider: "test" };
  }
}

/**
 * Integration harness: a throw-away control plane DB, inline provisioning (no pg-boss), and a mailbox, so
 * tests sign in with the emailed code like a real user.
 */
export class Harness {
  readonly sfx = randomBytes(3).toString("hex");
  readonly controlName = `fleet_test_${this.sfx}`;
  readonly admin: string;
  readonly controlUrl: string;
  readonly masterKey = randomBytes(32).toString("base64");
  private readonly pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  private readonly slugs: string[] = [];
  controlPool!: pg.Pool;
  app!: INestApplication;
  http!: ReturnType<typeof request>;
  readonly mail = new TestMailer();
  readonly push = new TestPush();
  /** Jobs other than provisioning that the API queued (e.g. alerts.scan). */
  readonly queued: { name: string; data: object }[] = [];

  constructor(adminUrl: string) {
    this.admin = adminUrl;
    this.controlUrl = adminUrlFor(adminUrl, this.controlName);
  }

  config(): AppConfig {
    const u = new URL(this.admin);
    return {
      controlDatabaseUrl: this.controlUrl, adminDatabaseUrl: this.admin, tenantDbHost: u.hostname, tenantDbPort: Number(u.port || 5432),
      masterKey: this.masterKey, jwtPrivateKeyPem: this.pem, port: 0, corsOrigins: ["http://localhost:3000"], secureCookies: false,
      storage: { driver: "fs", dir: `${tmpdir()}/fleet-test-files-${this.sfx}` },
      mail: { smtpUrl: null, from: "Fleet <no-reply@test>" }, webUrl: "http://localhost:3000",
      rateLimit: { authPerMinute: 10_000, generalPerMinute: 100_000 }, breachedPasswordCheck: false, push: { driver: "log", accessToken: null },
    };
  }

  async start(platformAdmin = { email: "root@platform.test", password: "platform-admin-pass" }) {
    await ensureControlDb(this.admin, this.controlUrl);
    this.controlPool = new pg.Pool({ connectionString: this.controlUrl });
    const { db, pool } = controlDb(this.controlUrl);
    await db.insert(schema.identities).values({ id: newId(), email: platformAdmin.email, displayName: "Root", passwordHash: await AuthService.hashPassword(platformAdmin.password), isPlatformAdmin: true });
    await pool.end();
    const c = this.config();
    const queue: JobQueue = {
      send: async (name, data) => {
        if (name !== JOBS.provisionTenant) { this.queued.push({ name, data }); return; }
        await new Provisioner({ control: this.controlPool, adminUrl: c.adminDatabaseUrl, secrets: new SecretBox(this.masterKey), tenantDbHost: c.tenantDbHost, tenantDbPort: c.tenantDbPort })
          .provision((data as { tenantId: string }).tenantId);
      },
      stop: async () => {},
    };
    this.app = await createApp(c, { queue, mailer: this.mail, push: this.push, logger: process.env.TEST_LOGS ? undefined : false });
    await this.app.init();
    this.http = request(this.app.getHttpServer());
  }

  async stop() {
    await this.app?.close();
    await this.controlPool?.end();
    const admin = new pg.Client({ connectionString: this.admin });
    await admin.connect();
    for (const s of this.slugs) {
      await admin.query(`DROP DATABASE IF EXISTS fleet_t_${s.replace(/-/g, "_")} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS fleet_t_${s.replace(/-/g, "_")}_app`);
    }
    await admin.query(`DROP DATABASE IF EXISTS ${this.controlName} WITH (FORCE)`);
    await admin.end();
  }

  slug(prefix: string) {
    const s = `${prefix}${this.sfx}`;
    this.slugs.push(s);
    return s;
  }

  /** The newest sign-in code emailed to an account. */
  lastCode(account: string): string {
    const m = [...this.mail.sent].reverse().find((x) => x.to === account && /d{6}/.test(x.subject));
    if (!m) throw new Error(`no sign-in code emailed to ${account}`);
    return /(d{6})/.exec(m.subject)![1]!;
  }

  /** Completes a login response that asks for the emailed code. */
  async finishMfa(account: string, res: request.Response): Promise<request.Response> {
    if (res.status !== 200 || !res.body.mfaToken) return res;
    return this.http.post("/auth/mfa").send({ mfaToken: res.body.mfaToken, code: this.lastCode(account) });
  }

  async login(email: string, password: string, tenantSlug?: string): Promise<request.Response> {
    const r = await this.finishMfa(email, await this.http.post("/auth/login").send({ email, password, tenantSlug }));
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  }

  async acceptInvite(account: string, token: string, password: string): Promise<request.Response> {
    return this.finishMfa(account, await this.http.post("/auth/accept-invite").send({ token, password }));
  }

  /** Platform admin creates a company; its admin accepts the invite. Returns tokens and ids. */
  async company(platformToken: string, prefix: string) {
    const slug = this.slug(prefix);
    const email = `admin@${slug}.test`;
    const r = await this.http.post("/platform/tenants").set(bearer(platformToken)).send({ name: `Company ${prefix}`, slug, countryCode: "EG", adminEmail: email, adminName: `Admin ${prefix}` });
    if (r.status !== 202) throw new Error(`create tenant: ${r.status} ${JSON.stringify(r.body)}`);
    const a = await this.acceptInvite(email, r.body.adminInviteToken, "company-admin-pass");
    if (a.status !== 200) throw new Error(`accept: ${a.status} ${JSON.stringify(a.body)}`);
    const branches = await this.http.get("/branches").set(bearer(a.body.accessToken));
    return { slug, tenantId: r.body.tenant.id as string, email, token: a.body.accessToken as string, hq: branches.body.items[0].id as string, inviteToken: r.body.adminInviteToken as string };
  }

  tenantDb(slug: string) {
    return new pg.Client({ connectionString: adminUrlFor(this.admin, `fleet_t_${slug.replace(/-/g, "_")}`) });
  }
}

export const bearer = (t: string | undefined) => ({ authorization: `Bearer ${t}` });

export const vehicleBody = (branchId: string, over: Record<string, unknown> = {}) => ({
  branchId, fleetNumber: "F-001", registrationNumber: "ط ب ع ١٢٣٤", make: "Toyota", model: "Hiace", year: 2022,
  primaryFuelType: "PET92", primaryTankCapacity: 70, secondaryFuelType: "CNG", secondaryTankCapacity: 15,
  meterType: "distance", requiredLicenseCategory: "PRO3", ownershipType: "owned", ...over,
});
