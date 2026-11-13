import type { JobQueue } from "../infra/infra.module.js";

/** Background jobs of the alert engine (E13), run by the jobs process (`dist/jobs.js`). */
export const ALERT_JOBS = {
  /** Scan one company now (after an event that should alert without waiting for the night). */
  scan: "alerts.scan",
  /** Cron: fan out a scan to every active company (D: ALERT_SCAN_CRON). */
  daily: "alerts.daily",
} as const;

export async function enqueueAlertScan(queue: JobQueue, tenantId: string) {
  try {
    await queue.send(ALERT_JOBS.scan, { tenantId }, { singletonKey: tenantId });
  } catch (e) {
    // The daily scan catches up; the request that caused it must not fail because of the queue.
    console.error(`[alerts] could not queue a scan for ${tenantId}: ${(e as Error).message}`);
  }
}

/** US-E16-03: recalculate the months corrections touched (dashboard shows "Recalculating" until done). */
export const KPI_JOBS = { recalculate: "kpi.recalculate" } as const;

export async function enqueueKpiRecalculation(queue: JobQueue, tenantId: string) {
  try {
    await queue.send(KPI_JOBS.recalculate, { tenantId }, { singletonKey: tenantId });
  } catch (e) {
    // The nightly job catches up on pending months; the approval must not fail because of the queue.
    console.error(`[kpi] could not queue a recalculation for ${tenantId}: ${(e as Error).message}`);
  }
}
