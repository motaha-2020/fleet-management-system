/**
 * Worker: same data packages as the API, different entry point (Architecture §3).
 * M0 consumes tenant provisioning; KPIs, alerts and notifications join in later milestones.
 */
import pg from "pg";
import { PgBoss } from "pg-boss";
import { JOBS, Provisioner, SecretBox, type ProvisionTenantJob } from "@fleet/db";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required environment variable ${k}`);
  return v;
};

const controlUrl = env("CONTROL_DATABASE_URL");
const control = new pg.Pool({ connectionString: controlUrl, max: 5 });
const provisioner = new Provisioner({
  control,
  adminUrl: env("DATABASE_ADMIN_URL"),
  secrets: new SecretBox(env("MASTER_KEY")),
  tenantDbHost: process.env.TENANT_DB_HOST ?? "localhost",
  tenantDbPort: Number(process.env.TENANT_DB_PORT ?? 5432),
});

const boss = new PgBoss({ connectionString: controlUrl, schema: "pgboss" });
boss.on("error", (e) => console.error("[worker] queue error", e));
await boss.start();
await boss.createQueue(JOBS.provisionTenant).catch(() => {});

await boss.work<ProvisionTenantJob>(JOBS.provisionTenant, async (jobs) => {
  for (const job of jobs) {
    const started = Date.now();
    console.log(`[worker] provisioning tenant ${job.data.tenantId}`);
    try {
      await provisioner.provision(job.data.tenantId);
      console.log(`[worker] tenant ${job.data.tenantId} active in ${Date.now() - started}ms`);
    } catch (e) {
      console.error(`[worker] tenant ${job.data.tenantId} failed: ${(e as Error).message}`);
      throw e; // pg-boss retries (steps are idempotent)
    }
  }
});
console.log("[worker] ready");

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await control.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
