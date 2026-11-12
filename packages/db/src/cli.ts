import pg from "pg";
import { SecretBox } from "./crypto.js";
import { ensureControlDb } from "./control.js";
import { Provisioner } from "./provision.js";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const cmd = process.argv[2];
if (cmd === "migrate") {
  const control = await ensureControlDb(env("DATABASE_ADMIN_URL"), env("CONTROL_DATABASE_URL"));
  console.log(`control plane: v${control.from} → v${control.to}`);
  const pool = new pg.Pool({ connectionString: env("CONTROL_DATABASE_URL") });
  const prov = new Provisioner({
    control: pool, adminUrl: env("DATABASE_ADMIN_URL"), secrets: new SecretBox(env("MASTER_KEY")),
    tenantDbHost: process.env.TENANT_DB_HOST ?? "localhost", tenantDbPort: Number(process.env.TENANT_DB_PORT ?? 5432),
  });
  const report = await prov.migrateAllTenants();
  for (const r of report) console.log(`tenant ${r.slug}: ${r.ok ? `OK v${r.version}` : `FAILED ${r.error}`}`);
  await pool.end();
  if (report.some((r) => !r.ok)) process.exitCode = 1;
} else {
  console.error("usage: cli.js migrate");
  process.exitCode = 2;
}
