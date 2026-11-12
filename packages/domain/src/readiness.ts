import { READINESS_RULES, RISK_ORDER, type ReadinessDimension, type ReadinessRuleCode, type Risk } from "@fleet/config";
import type { IsoDate } from "./dates.js";
import { driverEligibility, type EmploymentStatus } from "./driver.js";
import type { Validity } from "./documents.js";
import type { MaintenanceStatus } from "./maintenance.js";
import type { VehicleStatus } from "./vehicle.js";

export type ReadinessOutcome = "allowed" | "warning" | "restricted";

/** OPS-002: R4 Legal/Safety, R3 Operational → Restricted; R2 → Warning; R1 → information only. */
export const outcomeOfRisk = (r: Risk): ReadinessOutcome => (r === "R4" || r === "R3" ? "restricted" : r === "R2" ? "warning" : "allowed");
const OUTCOME_ORDER: Record<ReadinessOutcome, number> = { allowed: 0, warning: 1, restricted: 2 };

export interface DocState {
  typeCode: string;
  /** Document type risk (country catalog / company type). */
  risk: Risk;
  mandatory: boolean;
  /** Current document: verified (latest), else pending, else none. */
  current: { status: "verified" | "pending"; validity: Validity } | null;
}

export interface MaintenanceItemState { code: string; safety: boolean; status: MaintenanceStatus }

export interface ReadinessInput {
  today: IsoDate;
  vehicle?: {
    id: string; status: VehicleStatus; requiredLicenseCategory: string;
    documents: readonly DocState[]; maintenance: readonly MaintenanceItemState[];
    notDrivableWorkOrder: boolean; notDrivableDefect: boolean;
  };
  driver?: {
    id: string; employmentStatus: EmploymentStatus; licenseExpiry: IsoDate | null; licenseCategories: readonly string[];
    documents: readonly DocState[];
  };
  /** Assignment authorization (only for checks that need it, e.g. a handover receiver). */
  assignment?: { exists: boolean };
  /** Company risk settings (may only raise risk). */
  settings?: Partial<Record<ReadinessRuleCode, Risk>>;
  /** Active overrides (OPS-005): rule + subject, valid until expiresAt. */
  overrides?: readonly { id: string; ruleCode: string; entityType: "vehicle" | "driver"; entityId: string; subject: string | null; expiresAt: number }[];
  /** Instant used to decide whether an override is still in force. */
  now: number;
  graceDays?: number;
}

export interface ReadinessReason {
  code: ReadinessRuleCode;
  dimension: ReadinessDimension;
  entityType: "vehicle" | "driver";
  entityId: string;
  /** Document type, maintenance item… */
  subject: string | null;
  risk: Risk;
  outcome: ReadinessOutcome;
  overrideId: string | null;
  overrideExpiresAt: number | null;
}

export interface Readiness { outcome: ReadinessOutcome; reasons: ReadinessReason[] }

const RULES = new Map(READINESS_RULES.map((r) => [r.code as ReadinessRuleCode, r]));

/** GEN-008 / US-E12-01: a company setting may raise a rule's risk, never lower it. */
export function checkRuleSetting(code: ReadinessRuleCode, risk: Risk): "lower_than_default" | "not_configurable" | null {
  const rule = RULES.get(code);
  if (!rule || rule.risk === "document_type") return "not_configurable";
  return RISK_ORDER[risk] < RISK_ORDER[rule.risk] ? "lower_than_default" : null;
}

/** OPS-005: R4 never; R2/R3 only, and the override must expire. */
export function checkOverride(risk: Risk, expiresAt: number, now: number, maxDays: number): "r4_no_override" | "nothing_to_override" | "expiry_required" | "expiry_too_far" | null {
  if (risk === "R4") return "r4_no_override";
  if (risk === "R1") return "nothing_to_override";
  if (!(expiresAt > now)) return "expiry_required";
  if (expiresAt - now > maxDays * 86_400_000) return "expiry_too_far";
  return null;
}

/**
 * OPS-001..008 / E12. Every finding is a reason with its risk; the most restrictive reason decides
 * (OPS-004). Overridden R2/R3 reasons count as warnings until the override expires; R4 is never overridden.
 * Missing data is not a violation unless a rule says so (OPS-006): optional documents are ignored, and a
 * missing mandatory document is "missing mandatory evidence" at the risk the company configures (default R2).
 */
export function evaluateReadiness(input: ReadinessInput): Readiness {
  const reasons: ReadinessReason[] = [];
  const settings = input.settings ?? {};
  const riskOf = (code: ReadinessRuleCode, typeRisk?: Risk): Risk => {
    const rule = RULES.get(code)!;
    const base: Risk = rule.risk === "document_type" ? (typeRisk ?? "R2") : rule.risk;
    const s = settings[code];
    return s && RISK_ORDER[s] > RISK_ORDER[base] ? s : base;
  };
  const add = (code: ReadinessRuleCode, entityType: "vehicle" | "driver", entityId: string, subject: string | null, typeRisk?: Risk, dimension?: ReadinessDimension) => {
    const risk = riskOf(code, typeRisk);
    let outcome = outcomeOfRisk(risk);
    const ov = risk === "R4" ? undefined : input.overrides?.find((o) => o.ruleCode === code && o.entityType === entityType && o.entityId === entityId && o.subject === subject && o.expiresAt > input.now);
    if (ov && outcome === "restricted") outcome = "warning";
    reasons.push({ code, dimension: dimension ?? RULES.get(code)!.dimension, entityType, entityId, subject, risk, outcome, overrideId: ov?.id ?? null, overrideExpiresAt: ov?.expiresAt ?? null });
  };
  const docs = (entityType: "vehicle" | "driver", entityId: string, list: readonly DocState[]) => {
    for (const d of list) {
      if (!d.mandatory) continue; // OPS-006: optional documents never restrict
      if (!d.current) add("doc_missing", entityType, entityId, d.typeCode, d.risk, entityType);
      else if (d.current.status === "pending") add("doc_pending", entityType, entityId, d.typeCode, d.risk, entityType);
      else if (d.current.validity === "expired") add("doc_expired", entityType, entityId, d.typeCode, d.risk, entityType);
      else if (d.current.validity === "expiring") add("doc_expiring", entityType, entityId, d.typeCode, d.risk, entityType);
    }
  };

  const v = input.vehicle;
  if (v) {
    if (v.status !== "active") add("vehicle_not_active", "vehicle", v.id, null);
    if (v.notDrivableWorkOrder) add("wo_not_drivable", "vehicle", v.id, null);
    if (v.notDrivableDefect) add("defect_not_drivable", "vehicle", v.id, null);
    for (const m of v.maintenance) {
      if (m.status === "overdue") add(m.safety ? "maintenance_overdue_safety" : "maintenance_overdue", "vehicle", v.id, m.code);
    }
    docs("vehicle", v.id, v.documents);
  }
  const d = input.driver;
  if (d) {
    const e = driverEligibility({ employmentStatus: d.employmentStatus, licenseExpiry: d.licenseExpiry, licenseCategories: d.licenseCategories }, input.today, input.graceDays ?? 0, v?.requiredLicenseCategory);
    for (const r of e.reasons) add(r, "driver", d.id, null);
    docs("driver", d.id, d.documents);
  }
  if (input.assignment && !input.assignment.exists && d) add("no_assignment", "driver", d.id, v?.id ?? null);

  const outcome = reasons.reduce<ReadinessOutcome>((a, r) => (OUTCOME_ORDER[r.outcome] > OUTCOME_ORDER[a] ? r.outcome : a), "allowed");
  return { outcome, reasons: reasons.sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk]) };
}

/** Reasons that block an enforcement point (OPS-007): restricted and not overridden. */
export const blockingReasons = (r: Readiness) => r.reasons.filter((x) => x.outcome === "restricted");
