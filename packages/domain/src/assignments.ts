import type { IsoDate } from "./dates.js";
import { driverEligibility, type EligibilityReason, type EmploymentStatus } from "./driver.js";
import type { VehicleStatus } from "./vehicle.js";

/** Time in epoch ms. `end === null` means open-ended. Periods are half-open [start, end). */
export interface Period { start: number; end: number | null }
export const overlaps = (a: Period, b: Period) => (a.end === null || b.start < a.end) && (b.end === null || a.start < b.end);
export const contains = (p: Period, t: number) => p.start <= t && (p.end === null || t < p.end);

export type AssignmentRole = "primary" | "secondary";
export interface AssignmentLike extends Period { id: string; vehicleId: string; driverId: string; role: AssignmentRole }

export type AssignmentConflict = { kind: "vehicle_primary" | "driver_primary" | "same_pair"; withId: string };

/**
 * ASN-002..004: one primary driver per vehicle at a time; a driver is primary on one vehicle at a time
 * (configurable); the same driver cannot hold two overlapping assignments on the same vehicle.
 * The database enforces the same rules with exclusion constraints; this gives the user a precise message.
 */
export function assignmentConflicts(candidate: Omit<AssignmentLike, "id"> & { id?: string }, existing: readonly AssignmentLike[], driverSinglePrimary = true): AssignmentConflict[] {
  const out: AssignmentConflict[] = [];
  for (const e of existing) {
    if (e.id === candidate.id || !overlaps(e, candidate)) continue;
    if (e.vehicleId === candidate.vehicleId && e.driverId === candidate.driverId) out.push({ kind: "same_pair", withId: e.id });
    else if (candidate.role === "primary" && e.role === "primary" && e.vehicleId === candidate.vehicleId) out.push({ kind: "vehicle_primary", withId: e.id });
    else if (driverSinglePrimary && candidate.role === "primary" && e.role === "primary" && e.driverId === candidate.driverId) out.push({ kind: "driver_primary", withId: e.id });
  }
  return out;
}

export type AssignmentBlock = EligibilityReason | "vehicle_not_active";

/**
 * Hard blocks for assigning (US-E07-01, ASN-005): the license category must match (R4, no override),
 * the driver must be eligible, and only active vehicles can be assigned (US-E05-02).
 * Full readiness rules (documents, defects) join in M4.
 */
export function assignmentBlocks(
  vehicle: { status: VehicleStatus; requiredLicenseCategory: string },
  driver: { employmentStatus: EmploymentStatus; licenseExpiry: IsoDate | null; licenseCategories: readonly string[] },
  today: IsoDate,
  graceDays = 0,
): AssignmentBlock[] {
  const reasons: AssignmentBlock[] = [];
  if (vehicle.status !== "active") reasons.push("vehicle_not_active");
  reasons.push(...driverEligibility(driver, today, graceDays, vehicle.requiredLicenseCategory).reasons);
  return reasons;
}

export interface HandoverLike { at: number; fromDriverId: string | null; toDriverId: string }
export interface CustodySegment { start: number; end: number; driverId: string | null; source: "assignment" | "handover" | "gap" }

/**
 * ASN-009: who held the vehicle at every moment in [from, to). Custody starts with a primary
 * assignment, moves with handovers, and ends when the holder's assignment ends. Gaps are explicit
 * (driverId = null, "No custodian recorded").
 */
export function custodyTimeline(primary: readonly AssignmentLike[], handovers: readonly HandoverLike[], from: number, to: number): CustodySegment[] {
  type Ev = { at: number; order: number; apply: (cur: { driverId: string | null; source: CustodySegment["source"] }) => { driverId: string | null; source: CustodySegment["source"] } };
  const events: Ev[] = [];
  for (const a of primary) {
    events.push({ at: a.start, order: 1, apply: () => ({ driverId: a.driverId, source: "assignment" }) });
    if (a.end !== null) events.push({ at: a.end, order: 0, apply: (cur) => (cur.driverId === a.driverId ? { driverId: null, source: "gap" } : cur) });
  }
  for (const h of handovers) events.push({ at: h.at, order: 2, apply: () => ({ driverId: h.toDriverId, source: "handover" }) });
  events.sort((x, y) => x.at - y.at || x.order - y.order);

  let cur: { driverId: string | null; source: CustodySegment["source"] } = { driverId: null, source: "gap" };
  const segments: CustodySegment[] = [];
  let segStart = from;
  const push = (end: number) => {
    if (end <= segStart) return;
    const last = segments[segments.length - 1];
    if (last && last.driverId === cur.driverId && last.end === segStart) last.end = end;
    else segments.push({ start: segStart, end, driverId: cur.driverId, source: cur.source });
    segStart = end;
  };
  for (const e of events) {
    if (e.at >= to) break;
    if (e.at > from) push(e.at);
    cur = e.apply(cur);
  }
  push(to);
  return segments;
}
