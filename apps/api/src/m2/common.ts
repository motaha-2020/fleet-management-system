import { HttpStatus } from "@nestjs/common";
import { and, eq, gt, isNull, lt, lte, or } from "drizzle-orm";
import { COUNTRY_TEMPLATES, DEFAULTS } from "@fleet/config";
import { schema, type Db } from "@fleet/db";
import { canAccessBranch, custodyTimeline } from "@fleet/domain";
import type { RequestContext } from "../auth/context.js";
import { AppError, notFound, validation } from "../infra/errors.js";
import type { Tx } from "../fleet/tenant-db.js";

export type DbOrTx = Db | Tx;
const A = schema.assignments;

/** Assignments of a driver active at `at` (or now). */
export function activeAssignmentWhere(at: Date) {
  return and(eq(A.status, "active"), lte(A.startsAt, at), or(isNull(A.endsAt), gt(A.endsAt, at)));
}

/** Vehicle ids the driver holds an active assignment on at `at` — the "assigned" scope (E07). */
export async function driverVehicleIds(db: DbOrTx, driverId: string | null | undefined, at = new Date()): Promise<string[]> {
  if (!driverId) return [];
  const rows = await db.select({ v: A.vehicleId }).from(A).where(and(eq(A.driverId, driverId), activeAssignmentWhere(at)));
  return [...new Set(rows.map((r) => r.v))];
}

export async function hasAssignment(db: DbOrTx, driverId: string, vehicleId: string, at: Date) {
  const [row] = await db.select({ id: A.id }).from(A).where(and(eq(A.driverId, driverId), eq(A.vehicleId, vehicleId), activeAssignmentWhere(at))).limit(1);
  return !!row;
}

type VehicleRow = typeof schema.vehicles.$inferSelect;

/**
 * Can this user act on this vehicle under the granted scope? Drivers: only vehicles they are assigned
 * to now ("assigned"), or — for recording a fact that happened (fuel without assignment, FUEL-008) —
 * active vehicles of their branch ("own" + allowUnassigned).
 */
export async function vehicleInScope(db: DbOrTx, ctx: RequestContext, v: VehicleRow, opts: { allowUnassigned?: boolean } = {}) {
  if (ctx.role === "driver") {
    if (v.status !== "active") return false;
    if ((await driverVehicleIds(db, ctx.driverId)).includes(v.id)) return true;
    return !!opts.allowUnassigned && ctx.branchIds.includes(v.branchId);
  }
  return canAccessBranch(ctx, ctx.scope!, v.branchId);
}

export async function loadVehicle(db: DbOrTx, ctx: RequestContext, id: string, opts: { lock?: boolean; allowUnassigned?: boolean } = {}) {
  const q = db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id));
  const [v] = opts.lock ? await q.for("update") : await q;
  if (!v || !(await vehicleInScope(db, ctx, v, opts))) throw notFound("vehicle");
  return v;
}

export async function companyOf(db: DbOrTx) {
  const [company] = await db.select().from(schema.company).limit(1);
  const country = COUNTRY_TEMPLATES[company?.countryCode ?? ""];
  if (!company || !country) throw new Error("tenant has no country template");
  return { company, country };
}

/** Event time rules: default now; never in the future (clock skew allowed); never after disposal (VEH-006). */
export function eventTime(iso: string | undefined, vehicle: VehicleRow, field = "eventAt"): Date {
  const at = iso ? new Date(iso) : new Date();
  if (at.getTime() > Date.now() + DEFAULTS.MAX_FUTURE_SKEW_MINUTES * 60_000) throw validation({ [field]: "future_not_allowed" });
  if (vehicle.status === "disposed" && vehicle.disposedAt && at.toISOString().slice(0, 10) > vehicle.disposedAt) {
    throw new AppError(HttpStatus.CONFLICT, "after_disposal", "The vehicle was disposed before this time", { [field]: "after_disposal" });
  }
  return at;
}

/** Postgres exclusion-constraint violation (overlapping periods). */
export function exclusionViolation(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = err?.code ? err : err?.cause;
  return pg?.code === "23P01" ? (pg.constraint ?? "exclusion") : null;
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** ASN-007 custody timeline of a vehicle: primary assignments plus handovers. */
export async function custodySegments(db: DbOrTx, vehicleId: string, from: Date, to: Date) {
  const H = schema.handovers;
  const primary = await db.select().from(A).where(and(eq(A.vehicleId, vehicleId), eq(A.role, "primary"), eq(A.status, "active"), lt(A.startsAt, to)));
  const hs = await db.select().from(H).where(and(eq(H.vehicleId, vehicleId), lt(H.eventAt, to)));
  return custodyTimeline(
    primary.map((a) => ({ id: a.id, vehicleId: a.vehicleId, driverId: a.driverId, role: a.role, start: a.startsAt.getTime(), end: a.endsAt?.getTime() ?? null })),
    hs.map((h) => ({ at: h.eventAt.getTime(), fromDriverId: h.fromDriverId, toDriverId: h.toDriverId })), from.getTime(), to.getTime(),
  );
}

/** Who held the vehicle at `at` (null = no custodian). */
export async function custodianAt(db: DbOrTx, vehicleId: string, at: Date): Promise<string | null> {
  const segs = await custodySegments(db, vehicleId, new Date(at.getTime() - 1), new Date(at.getTime()));
  return segs.at(-1)?.driverId ?? null;
}
