import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import { DEFAULTS } from "@fleet/config";
import type { Dashboard } from "@fleet/contracts";
import { schema } from "@fleet/db";
import {
  availability, consumption, costPerKm, cumulative, dataCoverage, daysBetween, documentCompliance, documentValidity, fullToFullCycles, isTrusted,
  localDate, maintenanceCompliance, maintenanceOnTime, overlapHours, percent, reportedCost, syncSuccess, validDistance,
  type CycleEntry, type Measured, type Reading, type Replacement,
} from "@fleet/domain";
import type { DbOrTx } from "../m2/common.js";
import { branchPeriod } from "../m2/zoned.js";
import { toDomain } from "../m2/meter.service.js";
import { loadDocumentTypes } from "../documents/document-types.js";
import { MaintenanceService } from "../m4/maintenance.service.js";
import { ReadinessService } from "../m4/readiness.service.js";
import { AlertService } from "./alert.service.js";
import { recalculationsFor } from "./kpi-recalc.js";

const MAINT = ["preventive", "corrective", "accident"];

/**
 * E18 dashboards. Every number is computed from the ledgers for the period and the branches in scope (so the
 * drill-down always matches), with the KPI dictionary's rules: period by local date, valid distance from trusted
 * readings only, zero/untrusted denominators → Unavailable.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly maintenance: MaintenanceService, private readonly readiness: ReadinessService, private readonly alerts: AlertService) {}

  async build(db: DbOrTx, branches: readonly string[] | null, period: { from: string; to: string }): Promise<Dashboard> {
    const { types, company, country } = await loadDocumentTypes(db);
    const tz = company.timezone;
    // US-E03-01: each vehicle's numbers use its branch's days; [start, end) spans all branches (for unbranched data).
    const bp = await branchPeriod(db, period.from, period.to);
    const start = bp.outer.start.getTime();
    const end = bp.outer.end.getTime();
    const now = Date.now();
    const today = localDate(new Date(), tz);
    const inScope = (b: string | null | undefined) => !branches || (!!b && branches.includes(b));

    const V = schema.vehicles;
    const vehicles = (await db.select().from(V).where(notInArray(V.status, ["draft", "disposed"]))).filter((v) => inScope(v.branchId));
    const active = vehicles.filter((v) => v.status === "active");
    const vIds = vehicles.map((v) => v.id);
    const rs = await this.readiness.evaluateMany(db, active.map((vehicle) => ({ vehicle })));
    const restricted = rs.filter((r) => r.outcome === "restricted").length;

    // Costs (recorded view, reported amount per FIN-013)
    const C = schema.costRecords;
    const costs = (await db.select().from(C).where(and(eq(C.status, "active"), gte(C.expenseDate, period.from), lte(C.expenseDate, period.to)))).filter((c) => inScope(c.branchId));
    const sum = (f: (c: (typeof costs)[number]) => boolean) => costs.filter(f).reduce((s, c) => s + reportedCost({ netMinor: c.netMinor, grossMinor: c.grossMinor ?? c.netMinor + c.taxMinor }, c.taxRecoverable), 0);
    const operatingMinor = sum(() => true);
    const fuelMinor = sum((c) => c.category === "fuel");

    // Distance & coverage
    const readings = vIds.length ? await db.select().from(schema.meterReadings).where(inArray(schema.meterReadings.vehicleId, vIds)).orderBy(asc(schema.meterReadings.eventAt)) : [];
    const reps = vIds.length ? await db.select().from(schema.meterReplacements).where(inArray(schema.meterReplacements.vehicleId, vIds)) : [];
    const hist = new Map<string, { domain: Reading[]; replacements: Replacement[] }>();
    for (const v of vehicles) {
      hist.set(v.id, {
        domain: readings.filter((r) => r.vehicleId === v.id).map(toDomain),
        replacements: reps.filter((r) => r.vehicleId === v.id).map((r) => ({ at: r.eventAt.getTime(), oldFinal: r.oldFinal, newStart: r.newStart })),
      });
    }
    const distances = active.map((v) => {
      const w = bp.window(v.branchId);
      return validDistance(hist.get(v.id)!.domain, hist.get(v.id)!.replacements, w.start, Math.min(w.end, now));
    });
    const usable = distances.filter((d) => d.value != null);
    const distance: Measured = usable.length
      ? { value: usable.reduce((s, d) => s + d.value!, 0), quality: usable.length === distances.length && usable.every((d) => d.quality === "reliable") ? "reliable" : "partial" }
      : { value: null, quality: "unavailable" };

    // Fuel consumption (litre fuels, Full-to-Full cycles ending in the period)
    const F = schema.fuelEntries;
    const entries = vIds.length ? await db.select().from(F).where(inArray(F.vehicleId, vIds)).orderBy(asc(F.eventAt)) : [];
    const litre = new Set(country.fuelTypes.filter((f) => f.unit === "L").map((f) => f.code));
    const cycles = vehicles.flatMap((v) => {
      const h = hist.get(v.id)!;
      const byId = new Map(readings.filter((r) => r.vehicleId === v.id).map((r) => [r.id, r]));
      const list: CycleEntry[] = entries.filter((e) => e.vehicleId === v.id && litre.has(e.fuelType)).map((e) => {
        const r = e.readingId ? byId.get(e.readingId) : undefined;
        return { id: e.id, at: e.eventAt.getTime(), fuelType: e.fuelType, quantity: Number(e.quantity), isFull: e.isFull, status: e.status, flags: e.flags,
          odometerCum: cumulative(r?.value ?? e.odometer, e.eventAt.getTime(), h.replacements), odometerTrusted: !!r && isTrusted(r.status) };
      });
      const w = bp.window(v.branchId);
      return fullToFullCycles(list).filter((c) => c.endAt >= w.start && c.endAt < w.end);
    });

    // Maintenance: overdue now, due items, compliance in the period
    const mnt = await this.maintenance.evaluate(db, active, today);
    const items = [...mnt.values()].flatMap((m) => m.items);
    const overdueNow = items.filter((i) => i.due.status === "overdue");
    const MV = schema.maintenanceVisits;
    const visits = vIds.length ? (await db.select().from(MV).where(and(eq(MV.status, "completed"), inArray(MV.vehicleId, vIds))).orderBy(asc(MV.visitDate))) : [];
    const vItems = visits.length ? await db.select().from(schema.maintenanceVisitItems).where(inArray(schema.maintenanceVisitItems.visitId, visits.map((v) => v.id))) : [];
    let onTime = 0;
    let late = 0;
    for (const visit of visits.filter((x) => x.visitDate >= period.from && x.visitDate <= period.to)) {
      const state = mnt.get(visit.vehicleId);
      for (const it of vItems.filter((x) => x.visitId === visit.id)) {
        const def = state?.items.find((i) => i.code === it.itemCode);
        const prev = [...visits].reverse().find((p) => p.vehicleId === visit.vehicleId && p.visitDate < visit.visitDate && vItems.some((x) => x.visitId === p.id && x.itemCode === it.itemCode));
        if (!def || !prev) continue; // no earlier due point known
        if (maintenanceOnTime({ date: prev.visitDate, km: prev.odometer }, { km: def.intervalKm, months: def.intervalMonths }, { date: visit.visitDate, km: visit.odometer })) onTime++;
        else late++;
      }
    }
    const missed = overdueNow.filter((i) => !i.due.dueDate || i.due.dueDate >= period.from).length;

    // Documents
    const D = schema.documents;
    const drivers = (await db.select().from(schema.drivers).where(eq(schema.drivers.status, "active"))).filter((d) => inScope(d.branchId));
    const docs = await db.select().from(D).where(inArray(D.status, ["verified", "pending"]));
    const docStates = [...active.map((v) => ({ type: "vehicle" as const, id: v.id })), ...drivers.map((d) => ({ type: "driver" as const, id: d.id }))].flatMap((e) =>
      types.filter((t) => t.entityType === e.type && t.active).map((t) => {
        const cur = docs.filter((d) => d.entityId === e.id && d.typeCode === t.code && d.status === "verified").sort((a, b) => b.version - a.version)[0];
        return { mandatory: t.mandatory, ok: !!cur && documentValidity(cur.expiryDate, today, DEFAULTS.DOC_LEAD_DAYS, DEFAULTS.DOC_GRACE_DAYS) !== "expired" };
      }));
    const entityIds = new Set([...vIds, ...drivers.map((d) => d.id)]);
    const currentVerified = docs.filter((d) => d.status === "verified" && entityIds.has(d.entityId));
    const documentsExpiring = currentVerified.filter((d) => d.expiryDate && daysBetween(today, d.expiryDate) >= 0 && daysBetween(today, d.expiryDate) <= DEFAULTS.DOC_LEAD_DAYS[0]!).length;

    // Availability (calendar hours) from not-drivable work orders
    const WO = schema.workOrders;
    const wos = vIds.length ? await db.select().from(WO).where(inArray(WO.vehicleId, vIds)) : [];
    const vBranch = new Map(vehicles.map((v) => [v.id, v.branchId]));
    const hoursOf = (branchId: string | undefined) => {
      const w = bp.window(branchId);
      return { start: w.start, end: Math.min(w.end, now) };
    };
    const scheduled = active.reduce((s, v) => {
      const w = hoursOf(v.branchId);
      return s + Math.max(0, w.end - w.start) / 3_600_000;
    }, 0);
    const downtime = wos.filter((w) => w.offRoadAt && w.status !== "cancelled").reduce((s, wo) => {
      const w = hoursOf(vBranch.get(wo.vehicleId));
      return s + overlapHours(wo.offRoadAt!.getTime(), wo.returnToServiceAt?.getTime() ?? null, w.start, w.end);
    }, 0);

    // Sync success (E14)
    const E = schema.ingestedEvents;
    const events = await db.select({ status: E.status }).from(E).where(and(gte(E.serverTime, new Date(start)), lte(E.serverTime, new Date(end))));
    const decided = events.filter((e) => e.status !== "held");

    // Fuel budget of the month containing `to`
    const budgets = (await this.alerts.budgetStatus(db, period.to.slice(0, 7))).filter((b) => b.amountMinor != null && (b.scope === "company" ? !branches : inScope(b.branchId ?? vehicles.find((v) => v.id === b.vehicleId)?.branchId)));
    const budgetMinor = budgets.length ? budgets.reduce((s, b) => s + b.amountMinor!, 0) : null;
    const budgetActual = budgets.reduce((s, b) => s + b.actualMinor, 0);

    const A = schema.alerts;
    const openAlerts = (await db.select({ b: A.branchId }).from(A).where(inArray(A.status, ["open", "acknowledged", "in_progress"]))).filter((a) => !branches || !a.b || inScope(a.b)).length;
    const branchRows = await db.select().from(schema.branches);
    const SC = schema.syncConflicts;
    const conflicts = (await db.select({ b: SC.branchId }).from(SC).where(eq(SC.status, "open"))).filter((c) => inScope(c.b)).length;
    const asg = vIds.length ? await db.select({ id: schema.assignments.id, s: schema.assignments.startsAt, e: schema.assignments.endsAt }).from(schema.assignments)
      .where(and(eq(schema.assignments.status, "active"), inArray(schema.assignments.vehicleId, vIds))) : [];

    // US-E16-03: corrections waiting to be recalculated in this period's months, and why numbers changed.
    const recalculations = await recalculationsFor(db, period.from, period.to);

    return {
      recalculating: recalculations.some((r) => r.status === "pending"), recalculations,
      from: period.from, to: period.to, currency: country.currency,
      vehicles: { total: vehicles.length, active: active.length, restricted, available: active.length - restricted },
      costs: { operatingMinor, fuelMinor, maintenanceMinor: sum((c) => MAINT.includes(c.category)), finesMinor: sum((c) => c.category === "fines") },
      kpis: {
        fuelConsumption: consumption(cycles), fuelCostPerKm: costPerKm(fuelMinor, distance), costPerKm: costPerKm(operatingMinor, distance),
        maintenanceCompliance: maintenanceCompliance(onTime, late, missed), documentCompliance: documentCompliance(docStates),
        availability: availability(scheduled, downtime), dataCoverage: dataCoverage(distances.map((d) => d.quality)),
        syncSuccess: syncSuccess(decided.filter((e) => e.status === "accepted" || e.status === "warning").length, decided.length),
        fuelBudgetVariance: budgetMinor ? percent(budgetActual - budgetMinor, budgetMinor) : { value: null, quality: "unavailable" },
      },
      distance,
      openAlerts, overdueMaintenance: overdueNow.length,
      fleet: {
        byBranch: branchRows.filter((b) => inScope(b.id)).map((b) => ({
          branchId: b.id, name: b.name, vehicles: vehicles.filter((v) => v.branchId === b.id).length,
          restricted: active.filter((v, i) => v.branchId === b.id && rs[i]!.outcome === "restricted").length,
        })),
        activeAssignments: asg.filter((a) => a.s.getTime() <= now && (!a.e || a.e.getTime() > now)).length,
        documentsExpiring, pendingVerifications: docs.filter((d) => d.status === "pending" && entityIds.has(d.entityId)).length,
        maintenanceDue: items.filter((i) => ["upcoming", "due", "overdue"].includes(i.due.status)).length,
        openWorkOrders: wos.filter((w) => w.status !== "closed" && w.status !== "cancelled").length,
        fuelSpendMinor: fuelMinor, fuelBudgetMinor: budgetMinor, syncConflicts: conflicts,
      },
    };
  }
}
