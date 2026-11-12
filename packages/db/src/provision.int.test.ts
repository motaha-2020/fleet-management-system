import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { ensureControlDb, Provisioner, SecretBox, TenantPools, controlDb, newId, adminUrlFor, latestVersion } from "./index.js";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const run = ADMIN ? describe : describe.skip;

run("tenant provisioning (integration, real PostgreSQL)", () => {
  const suffix = randomBytes(3).toString("hex");
  const controlName = `fleet_test_control_${suffix}`;
  const controlUrl = adminUrlFor(ADMIN!, controlName);
  const secrets = new SecretBox(randomBytes(32).toString("base64"));
  const slugs = [`ta${suffix}`, `tb${suffix}`];
  let control: pg.Pool;
  const cdbs: pg.Pool[] = [];
  const tenantPools = () => {
    const c = controlDb(controlUrl);
    cdbs.push(c.pool);
    return new TenantPools(c.db, secrets);
  };
  let prov: Provisioner;
  const ids: string[] = [];

  beforeAll(async () => {
    await ensureControlDb(ADMIN!, controlUrl);
    control = new pg.Pool({ connectionString: controlUrl });
    const u = new URL(ADMIN!);
    prov = new Provisioner({ control, adminUrl: ADMIN!, secrets, tenantDbHost: u.hostname, tenantDbPort: Number(u.port || 5432) });
    for (const slug of slugs) {
      const id = newId();
      ids.push(id);
      await control.query("INSERT INTO tenants (id, slug, name, country_code, status) VALUES ($1,$2,$3,'EG','provisioning')", [id, slug, `Co ${slug}`]);
    }
  });

  afterAll(async () => {
    await control?.end();
    await Promise.all(cdbs.map((p) => p.end()));
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    for (const s of slugs) {
      await admin.query(`DROP DATABASE IF EXISTS fleet_t_${s} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS fleet_t_${s}_app`);
    }
    await admin.query(`DROP DATABASE IF EXISTS ${controlName} WITH (FORCE)`);
    await admin.end();
  });

  it("provisions isolated tenants and is idempotent", async () => {
    for (const id of ids) await prov.provision(id);
    await prov.provision(ids[0]!); // re-run on active tenant is a no-op
    const { rows } = await control.query("SELECT status FROM tenants WHERE id = ANY($1)", [ids]);
    expect(rows.map((r) => r.status)).toEqual(["active", "active"]);
    const loc = await control.query("SELECT schema_version FROM tenant_db_locations WHERE tenant_id=$1", [ids[0]]);
    expect(loc.rows[0].schema_version).toBe(latestVersion("tenant"));
  });

  it("app role sees its seeded data through TenantPools", async () => {
    const pools = tenantPools();
    const { pool } = await pools.get(ids[0]!);
    const b = await pool.query("SELECT code FROM branches");
    expect(b.rows).toEqual([{ code: "HQ" }]);
    const c = await pool.query("SELECT currency, timezone FROM company");
    expect(c.rows[0]).toEqual({ currency: "EGP", timezone: "Africa/Cairo" });
    await pools.closeAll();
  });

  it("tenant A's role cannot connect to tenant B's database", async () => {
    const loc = await control.query("SELECT db_role, db_password_enc FROM tenant_db_locations WHERE tenant_id=$1", [ids[0]]);
    const u = new URL(ADMIN!);
    const c = new pg.Client({ host: u.hostname, port: Number(u.port || 5432), database: `fleet_t_${slugs[1]}`, user: loc.rows[0].db_role, password: secrets.open(loc.rows[0].db_password_enc) });
    await expect(c.connect()).rejects.toThrow(/permission denied|not permitted/i);
  });

  it("app role cannot DELETE and audit log is append-only", async () => {
    const pools = tenantPools();
    const { pool } = await pools.get(ids[0]!);
    await expect(pool.query("DELETE FROM branches")).rejects.toThrow(/permission denied/);
    await pool.query("INSERT INTO audit_log (action) VALUES ('test')");
    await expect(pool.query("UPDATE audit_log SET action='x'")).rejects.toThrow(/permission denied|append-only/);
    await pools.closeAll();
  });

  it("database enforces registration uniqueness among non-disposed vehicles", async () => {
    const pools = tenantPools();
    const { pool } = await pools.get(ids[0]!);
    const br = (await pool.query("SELECT id FROM branches")).rows[0].id;
    const ins = (fleet: string, status = "active") => pool.query(
      `INSERT INTO vehicles (id, branch_id, fleet_number, registration_number, registration_normalized, make, model, year,
        primary_fuel_type, primary_tank_capacity, meter_type, required_license_category, ownership_type, status, created_by,
        disposed_at, disposal_reason)
       VALUES ($1,$2,$3,'ط ب ع 1','طبع1','Toyota','Hiace',2022,'PET92',70,'distance','PRO3','owned',$4,$1,
        CASE WHEN $4 = 'disposed' THEN DATE '2026-01-01' END, CASE WHEN $4 = 'disposed' THEN 'sold' END)`, [newId(), br, fleet, status]);
    await ins("F1", "disposed");
    await ins("F2");
    await expect(ins("F3")).rejects.toThrow(/vehicles_registration_uq/);
    // A disposed vehicle must carry its disposal record (VEH-006)
    await expect(pool.query(`UPDATE vehicles SET status='disposed' WHERE fleet_number='F2'`)).rejects.toThrow(/vehicles_disposal_complete/);
    await pools.closeAll();
  });

  it("marks tenant failed with the failing step and reason", async () => {
    const id = newId();
    await control.query("INSERT INTO tenants (id, slug, name, country_code, status) VALUES ($1,$2,'X','ZZ','provisioning')", [id, `tc${suffix}`]);
    slugs.push(`tc${suffix}`);
    await expect(prov.provision(id)).rejects.toThrow(/country template/);
    const { rows } = await control.query("SELECT status, failure_reason FROM tenants WHERE id=$1", [id]);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].failure_reason).toMatch(/^seed:/);
  });
});
