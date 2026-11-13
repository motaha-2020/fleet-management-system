import pg from "pg";
import { randomBytes } from "node:crypto";
import { COUNTRY_TEMPLATES } from "@fleet/config";
import { SecretBox } from "./crypto.js";
import { tenantDbName, tenantRoleName, q } from "./ident.js";
import { migrate, applyTenantGrants, MigrationError } from "./migrate.js";
import { newId } from "./ids.js";

export interface ProvisionerOptions {
  /** Control plane pool (app connection). */
  control: pg.Pool;
  /** Superuser/admin URL able to CREATE ROLE / CREATE DATABASE. */
  adminUrl: string;
  tenantDbHost: string;
  tenantDbPort: number;
  secrets: SecretBox;
}

export const PROVISION_STEPS = ["db_location", "create_role", "create_database", "migrate", "seed", "activate"] as const;
type Step = (typeof PROVISION_STEPS)[number];

export function adminUrlFor(adminUrl: string, database: string) {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * Idempotent tenant provisioning (TEN-001, Architecture §6.3).
 * Each step is safe to re-run; progress is recorded in provisioning_steps.
 * Any failure leaves the tenant in `failed` (not loginable) with the reason.
 */
export class Provisioner {
  constructor(private readonly o: ProvisionerOptions) {}

  async provision(tenantId: string): Promise<void> {
    const { rows } = await this.o.control.query<{ slug: string; name: string; country_code: string; status: string }>(
      "SELECT slug, name, country_code, status FROM tenants WHERE id = $1", [tenantId]);
    const t = rows[0];
    if (!t) throw new Error(`tenant ${tenantId} not found`);
    if (t.status === "active") return;
    if (t.status !== "provisioning" && t.status !== "failed") throw new Error(`cannot provision tenant in status ${t.status}`);
    await this.o.control.query("UPDATE tenants SET status='provisioning', failure_reason=NULL, updated_at=now() WHERE id=$1", [tenantId]);

    const dbName = tenantDbName(t.slug);
    const role = tenantRoleName(t.slug);
    let current: Step = "db_location";
    const admin = new pg.Client({ connectionString: this.o.adminUrl });
    await admin.connect();
    try {
      // 1. Location + credentials (generated once, stored encrypted)
      await this.o.control.query(
        `INSERT INTO tenant_db_locations (tenant_id, host, port, db_name, db_role, db_password_enc)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, this.o.tenantDbHost, this.o.tenantDbPort, dbName, role, this.o.secrets.seal(randomBytes(24).toString("base64url"))]);
      const loc = await this.o.control.query<{ db_password_enc: string }>("SELECT db_password_enc FROM tenant_db_locations WHERE tenant_id=$1", [tenantId]);
      const password = this.o.secrets.open(loc.rows[0]!.db_password_enc);
      await this.done(tenantId, current);

      // 2. Role
      current = "create_role";
      const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
      if (!exists.rowCount) await admin.query(`CREATE ROLE ${q(role)} LOGIN`);
      await admin.query(`ALTER ROLE ${q(role)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${admin.escapeLiteral(password)}`);
      await this.done(tenantId, current);

      // 3. Database: only this tenant's role may connect
      current = "create_database";
      const dbExists = await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [dbName]);
      if (!dbExists.rowCount) await admin.query(`CREATE DATABASE ${q(dbName)}`);
      await admin.query(`REVOKE ALL ON DATABASE ${q(dbName)} FROM PUBLIC`);
      await admin.query(`GRANT CONNECT ON DATABASE ${q(dbName)} TO ${q(role)}`);
      await this.done(tenantId, current);

      // 4. Schema
      current = "migrate";
      await this.migrateTenant(tenantId, dbName, role);
      await this.done(tenantId, current);

      // 5. Seed company + default branch
      current = "seed";
      const country = COUNTRY_TEMPLATES[t.country_code];
      if (!country) throw new Error(`no country template for ${t.country_code}`);
      const tdb = new pg.Client({ connectionString: adminUrlFor(this.o.adminUrl, dbName) });
      await tdb.connect();
      try {
        await tdb.query(
          `INSERT INTO company (id, name, country_code, currency, timezone) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [newId(), t.name, country.code, country.currency, country.timezone]);
        await tdb.query(`INSERT INTO branches (id, code, name) VALUES ($1,'HQ','الفرع الرئيسي') ON CONFLICT (code) DO NOTHING`, [newId()]);
        await tdb.query(`INSERT INTO audit_log (action, after) SELECT 'tenant.seeded', '{}'::jsonb WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action='tenant.seeded')`);
      } finally {
        await tdb.end();
      }
      await this.done(tenantId, current);

      // 6. Activate
      current = "activate";
      await this.o.control.query("UPDATE tenants SET status='active', updated_at=now() WHERE id=$1", [tenantId]);
      await this.o.control.query("INSERT INTO platform_audit (tenant_id, action) VALUES ($1, 'tenant.activated')", [tenantId]);
      await this.done(tenantId, current);
    } catch (e) {
      const reason = `${current}: ${(e as Error).message}`;
      await this.o.control.query(
        `INSERT INTO provisioning_steps (tenant_id, step, status, detail) VALUES ($1,$2,'failed',$3)
         ON CONFLICT (tenant_id, step) DO UPDATE SET status='failed', detail=EXCLUDED.detail, at=now()`, [tenantId, current, reason]);
      await this.o.control.query("UPDATE tenants SET status='failed', failure_reason=$2, updated_at=now() WHERE id=$1", [tenantId, reason]);
      await this.o.control.query("INSERT INTO platform_audit (tenant_id, action, detail) VALUES ($1,'tenant.provision_failed',$2)", [tenantId, { reason }]);
      throw e;
    } finally {
      await admin.end();
    }
  }

  /**
   * Permanently delete a company (platform admin, after suspending it): its database and role are dropped and its
   * control-plane rows removed, including its data key, so any of its encrypted files left in storage or backups can no
   * longer be read. Safe to re-run if a step failed. The platform audit trail is kept.
   */
  async deprovision(tenantId: string): Promise<{ slug: string; dbName: string }> {
    const { rows } = await this.o.control.query<{ slug: string }>("SELECT slug FROM tenants WHERE id = $1", [tenantId]);
    const t = rows[0];
    if (!t) throw new Error(`tenant ${tenantId} not found`);
    const loc = await this.o.control.query<{ db_name: string; db_role: string }>("SELECT db_name, db_role FROM tenant_db_locations WHERE tenant_id = $1", [tenantId]);
    const dbName = loc.rows[0]?.db_name ?? tenantDbName(t.slug);
    const role = loc.rows[0]?.db_role ?? tenantRoleName(t.slug);
    // Nobody can sign in or use a session from here on, even if a later step fails.
    await this.o.control.query("UPDATE tenants SET status='terminated', updated_at=now() WHERE id=$1", [tenantId]);

    const admin = new pg.Client({ connectionString: this.o.adminUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${q(dbName)} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${q(role)}`);
    } finally {
      await admin.end();
    }

    const c = await this.o.control.connect();
    try {
      await c.query("BEGIN");
      const m = "(SELECT id FROM memberships WHERE tenant_id = $1)";
      await c.query(`DELETE FROM refresh_tokens WHERE membership_id IN ${m} OR device_id IN (SELECT id FROM devices WHERE tenant_id = $1)`, [tenantId]);
      await c.query(`DELETE FROM login_codes WHERE membership_id IN ${m}`, [tenantId]);
      for (const table of ["devices", "activation_codes", "invites", "break_glass_grants", "memberships", "provisioning_steps", "tenant_migrations", "tenant_keys", "tenant_db_locations"]) {
        await c.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      }
      await c.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    return { slug: t.slug, dbName };
  }

  /** Migrate one tenant DB and record the result in the control plane (TEN-006). */
  async migrateTenant(tenantId: string, dbName: string, role: string) {
    const tdb = new pg.Client({ connectionString: adminUrlFor(this.o.adminUrl, dbName) });
    await tdb.connect();
    try {
      const { to } = await migrate(tdb, "tenant");
      await applyTenantGrants(tdb, role);
      await this.o.control.query("UPDATE tenant_db_locations SET schema_version=$2 WHERE tenant_id=$1", [tenantId, to]);
      await this.o.control.query(
        `INSERT INTO tenant_migrations (tenant_id, version, status) VALUES ($1,$2,'success')
         ON CONFLICT (tenant_id, version) DO UPDATE SET status='success', error=NULL, at=now()`, [tenantId, to]);
      return to;
    } catch (e) {
      if (e instanceof MigrationError) {
        await this.o.control.query("UPDATE tenant_db_locations SET schema_version=$2 WHERE tenant_id=$1", [tenantId, e.reachedVersion]);
        await this.o.control.query(
          `INSERT INTO tenant_migrations (tenant_id, version, status, error) VALUES ($1,$2,'failed',$3)
           ON CONFLICT (tenant_id, version) DO UPDATE SET status='failed', error=EXCLUDED.error, at=now()`,
          [tenantId, e.migration.version, e.message]);
      }
      throw e;
    } finally {
      await tdb.end();
    }
  }

  /** Run pending migrations on every provisioned tenant; one failure doesn't stop the others. */
  async migrateAllTenants(): Promise<{ tenantId: string; slug: string; ok: boolean; version?: number; error?: string }[]> {
    const { rows } = await this.o.control.query<{ id: string; slug: string; db_name: string; db_role: string }>(
      `SELECT t.id, t.slug, l.db_name, l.db_role FROM tenants t JOIN tenant_db_locations l ON l.tenant_id=t.id
       WHERE t.status IN ('active','suspended') ORDER BY t.created_at`);
    const report = [];
    for (const r of rows) {
      try {
        report.push({ tenantId: r.id, slug: r.slug, ok: true, version: await this.migrateTenant(r.id, r.db_name, r.db_role) });
      } catch (e) {
        report.push({ tenantId: r.id, slug: r.slug, ok: false, error: (e as Error).message });
      }
    }
    return report;
  }

  private async done(tenantId: string, step: Step) {
    await this.o.control.query(
      `INSERT INTO provisioning_steps (tenant_id, step, status) VALUES ($1,$2,'done')
       ON CONFLICT (tenant_id, step) DO UPDATE SET status='done', detail=NULL, at=now()`, [tenantId, step]);
  }
}

/** Background job names shared by the API (producer) and the worker (consumer). */
export const JOBS = { provisionTenant: "tenant.provision" } as const;
export interface ProvisionTenantJob { tenantId: string }
