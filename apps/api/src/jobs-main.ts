/**
 * Jobs process (Architecture §3): the same modules as the API, no HTTP. Runs the alert engine (E13):
 * a nightly scan of every active company and on-demand scans queued by the API after events.
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { DEFAULTS } from "@fleet/config";
import { schema, TenantPools, type Db } from "@fleet/db";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config.js";
import { CONTROL_DB, TENANT_POOLS } from "./infra/tokens.js";
import { AlertService } from "./m5/alert.service.js";
import { ALERT_JOBS, KPI_JOBS } from "./m5/jobs.js";
import { KpiSnapshotService } from "./m5/kpi-snapshot.service.js";
import { OpsLog } from "./infra/ops-log.js";
import { companyOf } from "./m2/common.js";
import { localDate } from "@fleet/domain";

const config = loadConfig();
const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), { logger: ["error", "warn", "log"] });
const alerts = app.get(AlertService);
const pools = app.get<TenantPools>(TENANT_POOLS);
const control = app.get<Db>(CONTROL_DB);
const ops = app.get(OpsLog);
const kpi = app.get(KpiSnapshotService);

/** US-E16-03: recalculate months waiting after corrections; the nightly run also keeps last month's snapshot. */
const recalcTenant = async (tenantId: string, nightly = false) => {
  const db = (await pools.get(tenantId)).db;
  const r = await kpi.process(db);
  if (r.processed) console.log(`[jobs] kpi ${tenantId}: recalculated ${r.months.join(", ")}`);
  if (nightly) {
    const { company } = await companyOf(db);
    await kpi.closeMonth(db, localDate(new Date(), company.timezone));
  }
};

const scanTenant = async (tenantId: string) => {
  const started = Date.now();
  const r = await alerts.scan((await pools.get(tenantId)).db, tenantId);
  console.log(`[jobs] alerts ${tenantId}: +${r.created} ↑${r.escalated} ✓${r.resolved} ✉${r.notified} in ${Date.now() - started}ms`);
};

const boss = new PgBoss({ connectionString: config.controlDatabaseUrl, schema: "pgboss" });
boss.on("error", (e) => console.error("[jobs] queue error", e));
await boss.start();
for (const q of [ALERT_JOBS.scan, ALERT_JOBS.daily, KPI_JOBS.recalculate]) await boss.createQueue(q).catch(() => {});
await boss.schedule(ALERT_JOBS.daily, DEFAULTS.ALERT_SCAN_CRON);

await boss.work<{ tenantId: string }>(ALERT_JOBS.scan, async (jobs) => {
  for (const j of jobs) {
    try { await scanTenant(j.data.tenantId); } catch (e) {
      await ops.record({ tenantId: j.data.tenantId, kind: "job", severity: "error", code: "alert_scan_failed", detail: { error: (e as Error).message.slice(0, 300) } });
      throw e; // pg-boss retries
    }
  }
});
await boss.work(ALERT_JOBS.daily, async () => {
  const tenants = await control.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.status, "active"));
  for (const t of tenants) {
    // One failing company must not stop the others; the failure is logged (NFR-008).
    try { await scanTenant(t.id); } catch (e) {
      await ops.record({ tenantId: t.id, kind: "job", severity: "error", code: "alert_scan_failed", detail: { error: (e as Error).message.slice(0, 300) } });
    }
    try { await recalcTenant(t.id, true); } catch (e) {
      await ops.record({ tenantId: t.id, kind: "job", severity: "error", code: "kpi_recalc_failed", detail: { error: (e as Error).message.slice(0, 300) } });
    }
  }
});
await boss.work<{ tenantId: string }>(KPI_JOBS.recalculate, async (jobs) => {
  for (const j of jobs) {
    try { await recalcTenant(j.data.tenantId); } catch (e) {
      await ops.record({ tenantId: j.data.tenantId, kind: "job", severity: "error", code: "kpi_recalc_failed", detail: { error: (e as Error).message.slice(0, 300) } });
      throw e; // pg-boss retries
    }
  }
});
console.log("[jobs] ready");

const shutdown = async () => {
  await boss.stop({ graceful: true });
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
