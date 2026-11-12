import { Injectable } from "@nestjs/common";
import { and, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";
import { DEFAULTS, type ReadinessRuleCode, type Risk } from "@fleet/config";
import type { Readiness as ReadinessDto, ReadinessReason as ReasonDto } from "@fleet/contracts";
import { schema } from "@fleet/db";
import {
  documentValidity, evaluateReadiness, localDate, type DocState, type EmploymentStatus, type IsoDate, type Readiness, type ReadinessInput,
} from "@fleet/domain";
import { loadDocumentTypes } from "../documents/document-types.js";
import type { DbOrTx } from "../m2/common.js";
import { MaintenanceService } from "./maintenance.service.js";

type VehicleRow = typeof schema.vehicles.$inferSelect;
type DriverRow = typeof schema.drivers.$inferSelect;
const DOC = schema.documents;

/** Statuses after which a work order no longer keeps the vehicle off the road. */
const WO_RELEASED = ["completed", "closed", "cancelled"] as const;

export interface ReadinessTarget { vehicle?: VehicleRow; driver?: DriverRow; assignment?: { exists: boolean } }

/**
 * E12 operational readiness. Gathers the facts (documents, license, maintenance, open not-drivable work
 * orders and defects, company risk settings, active overrides) and lets the domain engine decide.
 */
@Injectable()
export class ReadinessService {
  constructor(private readonly maintenance: MaintenanceService) {}

  async evaluate(db: DbOrTx, t: ReadinessTarget, at = new Date()): Promise<Readiness> {
    const [r] = await this.evaluateMany(db, [t], at);
    return r!;
  }

  /** Several targets with shared lookups (vehicle lists, the driver's read set). */
  async evaluateMany(db: DbOrTx, targets: readonly ReadinessTarget[], at = new Date()): Promise<Readiness[]> {
    if (!targets.length) return [];
    const { types, company } = await loadDocumentTypes(db);
    const today = localDate(at, company.timezone);
    const vehicles = [...new Map(targets.flatMap((t) => (t.vehicle ? [[t.vehicle.id, t.vehicle] as const] : []))).values()];
    const drivers = [...new Map(targets.flatMap((t) => (t.driver ? [[t.driver.id, t.driver] as const] : []))).values()];
    const entityIds = [...vehicles.map((v) => v.id), ...drivers.map((d) => d.id)];

    const docs = entityIds.length
      ? await db.select().from(DOC).where(and(inArray(DOC.entityId, entityIds), inArray(DOC.status, ["verified", "pending"])))
      : [];
    const vIds = vehicles.map((v) => v.id);
    const wos = vIds.length
      ? await db.select({ vehicleId: schema.workOrders.vehicleId }).from(schema.workOrders)
        .where(and(inArray(schema.workOrders.vehicleId, vIds), eq(schema.workOrders.notDrivable, true), notInArray(schema.workOrders.status, [...WO_RELEASED])))
      : [];
    const defects = vIds.length
      ? await db.select({ vehicleId: schema.defects.vehicleId }).from(schema.defects)
        .where(and(inArray(schema.defects.vehicleId, vIds), eq(schema.defects.drivable, false), eq(schema.defects.status, "reported")))
      : [];
    const mnt = await this.maintenance.evaluate(db, vehicles, today, at.getTime());
    const settings = await this.settings(db);
    const overrides = entityIds.length
      ? await db.select().from(schema.readinessOverrides)
        .where(and(inArray(schema.readinessOverrides.entityId, entityIds), isNull(schema.readinessOverrides.revokedAt), gt(schema.readinessOverrides.expiresAt, at)))
      : [];

    const docStates = (entityType: "vehicle" | "driver", id: string): DocState[] =>
      types.filter((ty) => ty.entityType === entityType && ty.active).map((ty) => {
        const mine = docs.filter((d) => d.entityId === id && d.typeCode === ty.code);
        const cur = mine.filter((d) => d.status === "verified").sort((a, b) => b.version - a.version)[0]
          ?? mine.filter((d) => d.status === "pending").sort((a, b) => b.version - a.version)[0];
        return {
          typeCode: ty.code, risk: ty.risk as Risk, mandatory: ty.mandatory,
          current: cur ? { status: cur.status as "verified" | "pending", validity: documentValidity(cur.expiryDate, today, DEFAULTS.DOC_LEAD_DAYS, DEFAULTS.DOC_GRACE_DAYS) } : null,
        };
      });

    return targets.map((t) => {
      const v = t.vehicle;
      const d = t.driver;
      const input: ReadinessInput = {
        today, now: at.getTime(), graceDays: DEFAULTS.DOC_GRACE_DAYS, settings, assignment: t.assignment,
        overrides: overrides.map((o) => ({ id: o.id, ruleCode: o.ruleCode, entityType: o.entityType, entityId: o.entityId, subject: o.subject, expiresAt: o.expiresAt.getTime() })),
        vehicle: v && {
          id: v.id, status: v.status, requiredLicenseCategory: v.requiredLicenseCategory, documents: docStates("vehicle", v.id),
          maintenance: (mnt.get(v.id)?.items ?? []).map((i) => ({ code: i.code, safety: i.safety, status: i.due.status })),
          notDrivableWorkOrder: wos.some((w) => w.vehicleId === v.id), notDrivableDefect: defects.some((x) => x.vehicleId === v.id),
        },
        driver: d && {
          id: d.id, employmentStatus: (d.status !== "active" ? "terminated" : d.employmentStatus) as EmploymentStatus,
          licenseExpiry: d.licenseExpiry, licenseCategories: d.licenseCategories, documents: docStates("driver", d.id),
        },
      };
      return evaluateReadiness(input);
    });
  }

  async settings(db: DbOrTx): Promise<Partial<Record<ReadinessRuleCode, Risk>>> {
    const rows = await db.select().from(schema.readinessRuleSettings);
    return Object.fromEntries(rows.map((r) => [r.ruleCode, r.risk]));
  }

  today(at: Date, tz: string): IsoDate { return localDate(at, tz); }
}

export const reasonDto = (r: Readiness["reasons"][number]): ReasonDto => ({
  ...r, overrideExpiresAt: r.overrideExpiresAt != null ? new Date(r.overrideExpiresAt).toISOString() : null,
});
export const readinessDto = (r: Readiness, at = new Date()): ReadinessDto => ({ outcome: r.outcome, reasons: r.reasons.map(reasonDto), evaluatedAt: at.toISOString() });
