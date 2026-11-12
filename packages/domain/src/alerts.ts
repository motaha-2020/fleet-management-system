import { SEVERITY_ORDER, type AlertOwnerRole, type AlertSeverity, type AlertStatus } from "@fleet/config";

/** ALR-003: one open alert per cause. The key is type + entity + cause (document type, item, threshold…). */
export const dedupKey = (type: string, entityId: string, cause?: string | null) => `${type}:${entityId}${cause ? `:${cause}` : ""}`;

export interface DesiredAlert {
  dedupKey: string;
  type: string;
  severity: AlertSeverity;
  /** Escalation step of the same cause (e.g. 30 → 14 → 7 days before expiry). */
  level: number;
  entityType: string;
  entityId: string;
  branchId: string | null;
  subject: string | null;
  params: Record<string, unknown>;
}
export interface ActiveAlert { id: string; dedupKey: string; type: string; severity: AlertSeverity; level: number }

/**
 * The scan computes the alerts whose cause holds now; this decides what changes (ALR-003/004, DOC-009):
 * - a cause with no active alert → create;
 * - a cause that got worse (higher severity or a new level) → update the same alert (never a second one);
 * - an active alert of a scanned type whose cause is gone → auto-resolve.
 */
export function reconcileAlerts(desired: readonly DesiredAlert[], active: readonly ActiveAlert[], scannedTypes: readonly string[]) {
  const byKey = new Map(active.map((a) => [a.dedupKey, a]));
  const wanted = new Set(desired.map((d) => d.dedupKey));
  const create: DesiredAlert[] = [];
  const escalate: { id: string; to: DesiredAlert }[] = [];
  for (const d of desired) {
    const a = byKey.get(d.dedupKey);
    if (!a) create.push(d);
    else if (SEVERITY_ORDER[d.severity] > SEVERITY_ORDER[a.severity] || d.level !== a.level) escalate.push({ id: a.id, to: { ...d, severity: SEVERITY_ORDER[d.severity] >= SEVERITY_ORDER[a.severity] ? d.severity : a.severity } });
  }
  const resolve = active.filter((a) => scannedTypes.includes(a.type) && !wanted.has(a.dedupKey));
  return { create, escalate, resolve };
}

/** ALR-002 lifecycle. Acknowledged is not Resolved; Closed only after Resolved. */
const NEXT: Record<AlertStatus, readonly AlertStatus[]> = {
  open: ["acknowledged", "in_progress", "resolved"],
  acknowledged: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  resolved: ["closed"],
  closed: [],
};
export const canTransitionAlert = (from: AlertStatus, to: AlertStatus) => NEXT[from].includes(to);
export const isActiveAlert = (s: AlertStatus) => s === "open" || s === "acknowledged" || s === "in_progress";

/** DOC-009: the lead step a date is in (30 / 14 / 7 days before), or null when further away. */
export function leadLevel(daysLeft: number, leads: readonly number[]): number | null {
  const sorted = [...leads].sort((a, b) => a - b);
  return sorted.find((l) => daysLeft <= l) ?? null;
}
/** Severity rises as the expiry gets closer: first lead Low, middle Medium, last High. */
export function leadSeverity(level: number, leads: readonly number[]): AlertSeverity {
  const sorted = [...leads].sort((a, b) => b - a);
  const i = sorted.indexOf(level);
  return i <= 0 ? "low" : i === sorted.length - 1 ? "high" : "medium";
}

export interface Member { identityId: string; role: string; branchIds: readonly string[]; active: boolean }

/**
 * ALR-005: the owner is the first available member of the type's owner role covering the branch; the escalation
 * owner is a company admin. With no available primary owner the alert goes to the escalation owner.
 */
export function pickOwner(members: readonly Member[], role: AlertOwnerRole, branchId: string | null) {
  const usable = members.filter((m) => m.active);
  const covers = (m: Member) => m.role === "company_admin" || m.role === "finance_reviewer" || !branchId || m.branchIds.includes(branchId);
  const escalation = usable.find((m) => m.role === "company_admin")?.identityId ?? null;
  const primary = usable.find((m) => m.role === role && covers(m))?.identityId ?? null;
  return { ownerId: primary ?? escalation, escalationOwnerId: escalation, fellBack: !primary };
}

/** FUEL-015 / D-BUD-THRESH: the highest threshold reached (percent of budget), or null. */
export function budgetThreshold(actual: number, budget: number, thresholds: readonly number[]): number | null {
  if (!(budget > 0)) return null;
  const pct = (actual / budget) * 100;
  return [...thresholds].sort((a, b) => b - a).find((t) => pct >= t) ?? null;
}

/** Fuel Budget Variance (KPI §26.1): actual − budget, and as a percent of the budget. */
export function budgetVariance(actual: number, budget: number) {
  return { amount: actual - budget, percent: budget > 0 ? Math.round(((actual - budget) / budget) * 1000) / 10 : null };
}
