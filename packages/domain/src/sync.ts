import { DEFAULTS } from "@fleet/config";

/**
 * E14 rules for offline events, pure so the device and the server agree (Architecture §8).
 * Times are epoch milliseconds.
 */

export type SyncTimeFlag = "clock_drift" | "time_unverified";

export interface GrantWindow {
  issuedAt: number;
  expiresAt: number;
}

export interface EventClock {
  /** Wall clock on the device when the action was taken. */
  deviceTime: number;
  /** Monotonic ms between receiving the grant and the action; null when unknown (reboot, no native clock). */
  elapsedMs: number | null;
}

export interface ClockCheck {
  /** Best estimate of the true time of the action: grant issue time + monotonic elapsed. Null when unknown. */
  estimatedAt: number | null;
  /** deviceTime − estimatedAt; null when there is no estimate. */
  driftMs: number | null;
  flags: SyncTimeFlag[];
  /** Time to record the event at: the estimate when the device clock drifted, otherwise the device time. */
  eventAt: number;
}

/**
 * OFF-006 / US-E14-03: compare the device clock with the server-anchored estimate.
 * Both times are kept; the record uses the estimate when the device clock is off.
 */
export function checkEventClock(e: EventClock, grant: GrantWindow, driftLimitMs = DEFAULTS.SYNC_CLOCK_DRIFT_MINUTES * 60_000): ClockCheck {
  if (e.elapsedMs === null || e.elapsedMs < 0) {
    return { estimatedAt: null, driftMs: null, flags: ["time_unverified"], eventAt: e.deviceTime };
  }
  const estimatedAt = grant.issuedAt + e.elapsedMs;
  const driftMs = e.deviceTime - estimatedAt;
  const drifted = Math.abs(driftMs) > driftLimitMs;
  return { estimatedAt, driftMs, flags: drifted ? ["clock_drift"] : [], eventAt: drifted ? estimatedAt : e.deviceTime };
}

/**
 * OFF-002/003 / US-E14-01: an action is allowed offline while its grant is valid. Measured with the
 * monotonic elapsed time when known (cannot be moved by changing the phone clock), otherwise the device time.
 */
export function withinGrant(e: EventClock, grant: GrantWindow): boolean {
  if (e.elapsedMs !== null && e.elapsedMs >= 0) return e.elapsedMs <= grant.expiresAt - grant.issuedAt;
  return e.deviceTime >= grant.issuedAt && e.deviceTime <= grant.expiresAt;
}

export function grantWindow(issuedAt: number, hours = DEFAULTS.OFFLINE_GRANT_HOURS): GrantWindow {
  return { issuedAt, expiresAt: issuedAt + hours * 3_600_000 };
}

/**
 * OFF-007 / US-E14-04: events of one device are applied strictly in device_seq order. Given the highest
 * seq applied so far and the seqs waiting, returns the seqs that can be applied now (the run with no gap),
 * in order. Anything after a gap waits for the missing event.
 */
export function applicableRun(lastAppliedSeq: number, waiting: readonly number[]): number[] {
  const set = new Set(waiting);
  const run: number[] = [];
  for (let next = lastAppliedSeq + 1; set.has(next); next++) run.push(next);
  return run;
}
