import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { ALERT_TYPES, DEFAULTS, type AlertSeverity, type AlertType } from "@fleet/config";
import { schema, newId, type Db } from "@fleet/db";
import {
  budgetThreshold, daysBetween, dedupKey, documentValidity, leadLevel, leadSeverity, localDate, pickOwner, reconcileAlerts,
  type DesiredAlert, type Member,
} from "@fleet/domain";
import { CONTROL_DB, MAILER } from "../infra/tokens.js";
import type { Mailer } from "../infra/mailer.js";
import type { DbOrTx } from "../m2/common.js";
import { loadDocumentTypes } from "../documents/document-types.js";
import { MaintenanceService } from "../m4/maintenance.service.js";
import { ReadinessService } from "../m4/readiness.service.js";

const A = schema.alerts;
const N = schema.notifications;
type AlertRow = typeof A.$inferSelect;
/** Actor of automatic changes in the audit log. */
export const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const DEF = new Map(ALERT_TYPES.map((t) => [t.type as string, t]));
/** Condition types the scan owns: an active alert of these types without a current cause is auto-resolved. */
export const SCANNED_TYPES = ALERT_TYPES.filter((t) => t.kind === "condition").map((t) => t.type as string);

interface Recipient { identityId: string; email: string | null; locale: "ar" | "en"; displayName: string; role: string }

/**
 * E13 alerts. A scan computes every condition alert whose cause holds now and reconciles it with the active
 * alerts: create, escalate the same alert (DOC-009) or auto-resolve with audit (ALR-004). New and escalated alerts
 * notify the owner in their language (NTF-001); every delivery attempt is recorded (NTF-003).
 */
@Injectable()
export class AlertService {
  private readonly log = new Logger("alerts");
  constructor(
    @Inject(CONTROL_DB) private readonly control: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly maintenance: MaintenanceService,
    private readonly readiness: ReadinessService,
  ) {}

  // ---------------------------------------------------------------- people

  private async members(tenantId: string): Promise<(Member & Recipient)[]> {
    const M = schema.memberships;
    const I = schema.identities;
    const rows = await this.control.select({ m: M, i: I }).from(M).innerJoin(I, eq(I.id, M.identityId))
      .where(eq(M.tenantId, tenantId)).orderBy(asc(M.createdAt));
    return rows.map(({ m, i }) => ({
      identityId: i.id, role: m.role, branchIds: m.branchIds, active: m.active && !i.disabledAt,
      email: i.email, locale: i.locale, displayName: i.displayName,
    }));
  }

  // ---------------------------------------------------------------- what should be open now

  private async desired(db: DbOrTx, at: Date): Promise<DesiredAlert[]> {
    const out: DesiredAlert[] = [];
    const push = (type: AlertType, entityType: string, entityId: string, branchId: string | null, cause: string | null, params: Record<string, unknown>, severity?: AlertSeverity, level = 0) => {
      out.push({ dedupKey: dedupKey(type, entityId, cause), type, severity: severity ?? DEF.get(type)!.severity, level, entityType, entityId, branchId, subject: cause, params });
    };
    const { types, company } = await loadDocumentTypes(db);
    const today = localDate(at, company.timezone);
    const leads = DEFAULTS.DOC_LEAD_DAYS;
    const V = schema.vehicles;
    const vehicles = await db.select().from(V).where(inArray(V.status, ["active", "inactive"]));
    const drivers = await db.select().from(schema.drivers).where(and(eq(schema.drivers.status, "active"), ne(schema.drivers.employmentStatus, "terminated")));
    const vLabel = new Map(vehicles.map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`]));
    const dLabel = new Map(drivers.map((d) => [d.id, d.fullName]));
    const branchOf = new Map<string, string>([...vehicles.map((v) => [v.id, v.branchId] as const), ...drivers.map((d) => [d.id, d.branchId] as const)]);

    // DOC-009 / US-E13-01: expiring (30/14/7) and expired documents, current verified version only.
    const docs = await db.select().from(schema.documents).where(eq(schema.documents.status, "verified"));
    const latest = new Map<string, (typeof docs)[number]>();
    for (const d of docs) {
      const k = `${d.entityId}|${d.typeCode}`;
      if (!latest.has(k) || latest.get(k)!.version < d.version) latest.set(k, d);
    }
    for (const d of latest.values()) {
      const ty = types.find((t) => t.code === d.typeCode);
      if (!ty?.active || !d.expiryDate || !branchOf.has(d.entityId)) continue;
      const label = d.entityType === "vehicle" ? vLabel.get(d.entityId) : dLabel.get(d.entityId);
      const params = { label, docType: d.typeCode, docName: ty.name, expiryDate: d.expiryDate };
      const validity = documentValidity(d.expiryDate, today, leads, DEFAULTS.DOC_GRACE_DAYS);
      if (validity === "expired") push("doc_expired", d.entityType, d.entityId, branchOf.get(d.entityId)!, d.typeCode, params);
      else {
        const lvl = leadLevel(daysBetween(today, d.expiryDate), leads);
        if (lvl !== null) push("doc_expiring", d.entityType, d.entityId, branchOf.get(d.entityId)!, d.typeCode, { ...params, daysLeft: daysBetween(today, d.expiryDate) }, leadSeverity(lvl, leads), lvl);
      }
    }

    // US-E06-03: driver licenses (the daily eligibility check).
    for (const d of drivers) {
      if (!d.licenseExpiry) continue;
      const left = daysBetween(today, d.licenseExpiry);
      const params = { label: d.fullName, expiryDate: d.licenseExpiry, daysLeft: left };
      if (left < -DEFAULTS.DOC_GRACE_DAYS) push("license_expired", "driver", d.id, d.branchId, null, params);
      else {
        const lvl = leadLevel(left, leads);
        if (lvl !== null) push("license_expiring", "driver", d.id, d.branchId, null, params, leadSeverity(lvl, leads), lvl);
      }
    }

    // MNT-003: upcoming / overdue maintenance; safety items overdue are critical.
    const active = vehicles.filter((v) => v.status === "active");
    const mnt = await this.maintenance.evaluate(db, active, today, at.getTime());
    for (const v of active) {
      for (const i of mnt.get(v.id)?.items ?? []) {
        const params = { label: vLabel.get(v.id), item: i.name, code: i.code, dueKm: i.due.dueKm, dueDate: i.due.dueDate };
        if (i.due.status === "overdue") push("maintenance_overdue", "vehicle", v.id, v.branchId, i.code, params, i.safety ? "critical" : "high");
        else if (i.due.status === "upcoming" || i.due.status === "due") push("maintenance_upcoming", "vehicle", v.id, v.branchId, i.code, params);
      }
    }

    // WO-001: unreviewed defect reports.
    const defects = await db.select().from(schema.defects).where(eq(schema.defects.status, "reported"));
    for (const d of defects) {
      push("defect_reported", "defect", d.id, d.branchId, null, { label: vLabel.get(d.vehicleId), vehicleId: d.vehicleId, description: d.description.slice(0, 140), drivable: d.drivable },
        d.drivable ? "medium" : "high");
    }

    // Restriction Raised (Annex D): R4 critical, R3 high.
    const rs = await this.readiness.evaluateMany(db, active.map((vehicle) => ({ vehicle })), at);
    active.forEach((v, i) => {
      const blocking = rs[i]!.reasons.filter((r) => r.outcome === "restricted");
      if (!blocking.length) return;
      push("restriction_raised", "vehicle", v.id, v.branchId, null, { label: vLabel.get(v.id), codes: [...new Set(blocking.map((r) => r.code))] },
        blocking.some((r) => r.risk === "R4") ? "critical" : "high");
    });

    // ODO: readings in Conflict in the last 90 days that nobody corrected or excluded.
    const since = new Date(at.getTime() - 90 * 86_400_000);
    const conflicts = await db.select().from(schema.meterReadings).where(and(eq(schema.meterReadings.status, "conflict"), gte(schema.meterReadings.eventAt, since)));
    for (const r of conflicts) {
      if (!branchOf.has(r.vehicleId)) continue;
      push("odometer_conflict", "vehicle", r.vehicleId, branchOf.get(r.vehicleId)!, r.id, { label: vLabel.get(r.vehicleId), value: r.value, at: r.eventAt.toISOString() });
    }

    // E14: open sync conflicts.
    const sc = await db.select().from(schema.syncConflicts).where(eq(schema.syncConflicts.status, "open"));
    for (const c of sc) push("sync_conflict", "sync_conflict", c.id, c.branchId, null, { reason: c.reason });

    // FUEL-015: budgets of the current month at 80% / 100%.
    for (const b of await this.budgetStatus(db, today.slice(0, 7))) {
      if (b.threshold === null) continue;
      const entityId = b.vehicleId ?? b.branchId ?? company.id;
      const label = b.vehicleId ? vLabel.get(b.vehicleId) : undefined;
      push("fuel_budget", b.scope, entityId, b.branchId ?? (b.vehicleId ? branchOf.get(b.vehicleId) ?? null : null), b.month,
        { label, month: b.month, threshold: b.threshold, actualMinor: b.actualMinor, amountMinor: b.amountMinor, actualLiters: b.actualLiters, liters: b.liters },
        b.threshold >= 100 ? "high" : "medium", b.threshold);
    }

    // INC-005: unpaid fines before the vehicle license renewal (E29).
    for (const f of await this.finesBeforeRenewal(db, today)) push("fines_before_renewal", "vehicle", f.vehicleId, f.branchId, null, { label: vLabel.get(f.vehicleId), ...f.params });
    return out;
  }

  /** INC-005: filled in with the fines ledger (E29). */
  private async finesBeforeRenewal(_db: DbOrTx, _today: string): Promise<{ vehicleId: string; branchId: string; params: Record<string, unknown> }[]> {
    return [];
  }

  // ---------------------------------------------------------------- budgets (FUEL-015)

  /** Budgets of a month with the actual accepted fuel spend and liters in their scope. */
  async budgetStatus(db: DbOrTx, month: string) {
    const B = schema.fuelBudgets;
    const F = schema.fuelEntries;
    const start = `${month}-01`;
    const budgets = await db.select().from(B).where(eq(B.month, start));
    if (!budgets.length) return [];
    const { company } = await loadDocumentTypes(db);
    const [y, m] = month.split("-").map(Number) as [number, number];
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
    // Period by local date (§26.1 "الفترة بتوقيت الفرع"; the company time zone is used for the month boundary).
    const from = new Date(Date.parse(`${start}T00:00:00Z`) - 3 * 86_400_000);
    const to = new Date(Date.parse(`${next}T00:00:00Z`) + 3 * 86_400_000);
    const entries = (await db.select().from(F).where(and(gte(F.eventAt, from), lt(F.eventAt, to), inArray(F.status, ["accepted", "under_review"]))))
      .filter((e) => localDate(e.eventAt, company.timezone).slice(0, 7) === month);
    return budgets.map((b) => {
      const mine = entries.filter((e) => (b.scope === "company") || (b.scope === "branch" && e.branchId === b.branchId) || (b.scope === "vehicle" && e.vehicleId === b.vehicleId));
      const actualMinor = mine.reduce((s, e) => s + e.netMinor + e.taxMinor, 0);
      const actualLiters = Math.round(mine.reduce((s, e) => s + e.quantity, 0) * 100) / 100;
      const thresholds = [b.amountMinor != null ? budgetThreshold(actualMinor, b.amountMinor, DEFAULTS.BUDGET_THRESHOLDS) : null,
        b.liters != null ? budgetThreshold(actualLiters, b.liters, DEFAULTS.BUDGET_THRESHOLDS) : null].filter((x): x is number => x !== null);
      return {
        id: b.id, scope: b.scope, branchId: b.branchId, vehicleId: b.vehicleId, month, amountMinor: b.amountMinor, liters: b.liters, actualMinor, actualLiters,
        amountPercent: b.amountMinor ? Math.round((actualMinor / b.amountMinor) * 1000) / 10 : null,
        litersPercent: b.liters ? Math.round((actualLiters / b.liters) * 1000) / 10 : null,
        varianceMinor: b.amountMinor != null ? actualMinor - b.amountMinor : null,
        threshold: thresholds.length ? Math.max(...thresholds) : null,
      };
    });
  }

  // ---------------------------------------------------------------- scan

  async scan(db: Db, tenantId: string, at = new Date()) {
    const wanted = await this.desired(db, at);
    const people = await this.members(tenantId);
    const result = await db.transaction(async (tx) => {
      const active = await tx.select().from(A).where(inArray(A.status, ["open", "acknowledged", "in_progress"])).for("update");
      const plan = reconcileAlerts(wanted, active.map((a) => ({ id: a.id, dedupKey: a.dedupKey, type: a.type, severity: a.severity, level: a.level })), SCANNED_TYPES);
      const notify: AlertRow[] = [];
      for (const d of plan.create) {
        const owner = pickOwner(people, DEF.get(d.type)!.owner, d.branchId);
        const [row] = await tx.insert(A).values({
          id: newId(), type: d.type, severity: d.severity, level: d.level, dedupKey: d.dedupKey, entityType: d.entityType, entityId: d.entityId,
          branchId: d.branchId, subject: d.subject, params: d.params, ownerId: owner.ownerId, escalationOwnerId: owner.escalationOwnerId, ownerFallback: owner.fellBack,
        }).returning();
        await this.audit(tx, "alert.created", row!, { type: d.type, severity: d.severity, owner: owner.ownerId, fallback: owner.fellBack });
        notify.push(row!);
      }
      for (const e of plan.escalate) {
        const [row] = await tx.update(A).set({ severity: e.to.severity, level: e.to.level, params: e.to.params, updatedAt: at }).where(eq(A.id, e.id)).returning();
        await this.audit(tx, "alert.escalated", row!, { severity: e.to.severity, level: e.to.level });
        notify.push(row!);
      }
      for (const r of plan.resolve) {
        const [row] = await tx.update(A).set({ status: "resolved", resolvedAt: at, resolution: "auto", updatedAt: at }).where(eq(A.id, r.id)).returning();
        await this.audit(tx, "alert.auto_resolved", row!, { cause: "condition_cleared" });
      }
      let notified = 0;
      for (const a of notify) notified += await this.queueNotifications(tx, a, people);
      return { created: plan.create.length, escalated: plan.escalate.length, resolved: plan.resolve.length, notified };
    });
    await this.deliver(db);
    return result;
  }

  /** An event alert (e.g. a driver's report was rejected): recorded and sent once, closed by a person. */
  async raise(tx: DbOrTx, tenantId: string, a: { type: AlertType; entityType: string; entityId: string; branchId: string | null; ownerId: string; params: Record<string, unknown>; subject?: string | null }) {
    const def = DEF.get(a.type)!;
    const [row] = await tx.insert(A).values({
      id: newId(), type: a.type, severity: def.severity, dedupKey: `${dedupKey(a.type, a.entityId, a.subject ?? null)}:${newId()}`, entityType: a.entityType, entityId: a.entityId,
      branchId: a.branchId, subject: a.subject ?? null, params: a.params, ownerId: a.ownerId,
    }).returning();
    await this.audit(tx, "alert.created", row!, { type: a.type, owner: a.ownerId });
    await this.queueNotifications(tx, row!, await this.members(tenantId));
    return row!;
  }

  private audit(tx: DbOrTx, action: string, a: AlertRow, after: Record<string, unknown>) {
    return tx.insert(schema.auditLog).values({ actorId: SYSTEM_ACTOR, action, entityType: "alert", entityId: a.id, after, before: null, branchId: a.branchId });
  }

  // ---------------------------------------------------------------- notifications (NTF-001/003)

  /** Email for office users; drivers get it in the app (and by email if they have one). */
  private async queueNotifications(tx: DbOrTx, a: AlertRow, people: Recipient[]) {
    const to = people.find((p) => p.identityId === a.ownerId);
    if (!to) return 0;
    const text = renderAlert(a, to.locale);
    const rows: (typeof N.$inferInsert)[] = [];
    if (to.role === "driver") rows.push({ id: newId(), alertId: a.id, recipientId: to.identityId, channel: "in_app", locale: to.locale, subject: text.subject, body: text.body, status: "sent", provider: "in_app", sentAt: new Date() });
    if (to.email) rows.push({ id: newId(), alertId: a.id, recipientId: to.identityId, channel: "email", locale: to.locale, address: to.email, subject: text.subject, body: text.body });
    if (rows.length) await tx.insert(N).values(rows);
    return rows.length;
  }

  /** Sends queued emails; a failure is retried up to D-NOTIFY attempts, then marked failed and logged (NFR-008). */
  async deliver(db: Db, limit = 100) {
    const queued = await db.select().from(N).where(and(eq(N.status, "queued"), eq(N.channel, "email"))).orderBy(asc(N.createdAt)).limit(limit);
    let failed = 0;
    for (const n of queued) {
      try {
        const r = await this.mailer.send({ to: n.address!, subject: n.subject, text: n.body, locale: n.locale });
        await db.update(N).set({ status: "sent", provider: r.provider, attempts: n.attempts + 1, sentAt: new Date(), lastError: null }).where(eq(N.id, n.id));
      } catch (e) {
        const attempts = n.attempts + 1;
        const msg = (e as Error).message.slice(0, 500);
        await db.update(N).set({ attempts, lastError: msg, status: attempts >= DEFAULTS.NOTIFY_MAX_ATTEMPTS ? "failed" : "queued" }).where(eq(N.id, n.id));
        if (attempts >= DEFAULTS.NOTIFY_MAX_ATTEMPTS) { failed++; this.log.error(`notification ${n.id} failed after ${attempts} attempts: ${msg}`); }
      }
    }
    return { attempted: queued.length, failed };
  }
}

/** Alert text in the recipient's language (NTF-001). Kept short: what, which, and the key value. */
export function renderAlert(a: Pick<AlertRow, "type" | "severity" | "params" | "subject">, locale: "ar" | "en") {
  const def = DEF.get(a.type);
  const name = def ? def.name[locale] : a.type;
  const p = a.params as Record<string, unknown>;
  const docName = p.docName as { ar: string; en: string } | undefined;
  const parts = [
    p.label ? String(p.label) : null,
    docName ? docName[locale] : null,
    p.item ? String(p.item) : null,
    p.expiryDate ? `${locale === "ar" ? "تاريخ الانتهاء" : "Expiry"}: ${p.expiryDate}` : null,
    typeof p.daysLeft === "number" ? (locale === "ar" ? `متبقي ${p.daysLeft} يوم` : `${p.daysLeft} days left`) : null,
    typeof p.threshold === "number" ? `${p.threshold}%` : null,
    p.description ? String(p.description) : null,
    p.reason && a.type === "defect_rejected" ? `${locale === "ar" ? "السبب" : "Reason"}: ${p.reason}` : null,
    typeof p.totalMinor === "number" ? `${locale === "ar" ? "الإجمالي" : "Total"}: ${(p.totalMinor / 100).toFixed(2)}` : null,
  ].filter(Boolean) as string[];
  const subject = `${name}${p.label ? ` — ${p.label}` : ""}`;
  return { subject, body: [name, ...parts].join("\n") };
}
