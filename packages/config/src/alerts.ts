/**
 * Alert catalog (ALR-001, Gap Analysis Annex D) as data: type → severity → default owner role → how it ends.
 * "condition" alerts are kept in step with the data by the scan (created while the cause holds, auto-resolved
 * when it is gone, ALR-004). "event" alerts record something that happened and are closed by a person.
 */
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertOwnerRole = "fleet_manager" | "finance_reviewer" | "company_admin" | "driver";

export interface AlertTypeDef {
  type: string;
  kind: "condition" | "event";
  severity: AlertSeverity;
  owner: AlertOwnerRole;
  entity: "vehicle" | "driver" | "defect" | "sync_conflict" | "branch" | "company";
  name: { ar: string; en: string };
}

export const ALERT_TYPES = [
  { type: "doc_expiring", kind: "condition", severity: "low", owner: "fleet_manager", entity: "vehicle", name: { ar: "مستند ينتهي قريبًا", en: "Document expiring" } },
  { type: "doc_expired", kind: "condition", severity: "high", owner: "fleet_manager", entity: "vehicle", name: { ar: "مستند منتهٍ", en: "Document expired" } },
  { type: "license_expiring", kind: "condition", severity: "medium", owner: "fleet_manager", entity: "driver", name: { ar: "رخصة سائق تنتهي قريبًا", en: "Driver license expiring" } },
  { type: "license_expired", kind: "condition", severity: "high", owner: "fleet_manager", entity: "driver", name: { ar: "رخصة سائق منتهية", en: "Driver license expired" } },
  { type: "maintenance_upcoming", kind: "condition", severity: "medium", owner: "fleet_manager", entity: "vehicle", name: { ar: "صيانة قريبة", en: "Maintenance upcoming" } },
  { type: "maintenance_overdue", kind: "condition", severity: "high", owner: "fleet_manager", entity: "vehicle", name: { ar: "صيانة متأخرة", en: "Maintenance overdue" } },
  { type: "defect_reported", kind: "condition", severity: "medium", owner: "fleet_manager", entity: "defect", name: { ar: "بلاغ عطل جديد", en: "New defect report" } },
  { type: "restriction_raised", kind: "condition", severity: "high", owner: "fleet_manager", entity: "vehicle", name: { ar: "مركبة مقيّدة", en: "Vehicle restricted" } },
  { type: "odometer_conflict", kind: "condition", severity: "medium", owner: "fleet_manager", entity: "vehicle", name: { ar: "تعارض في قراءة العداد", en: "Odometer conflict" } },
  { type: "sync_conflict", kind: "condition", severity: "high", owner: "fleet_manager", entity: "sync_conflict", name: { ar: "تعارض مزامنة", en: "Sync conflict" } },
  { type: "fuel_budget", kind: "condition", severity: "medium", owner: "fleet_manager", entity: "branch", name: { ar: "ميزانية الوقود", en: "Fuel budget" } },
  { type: "fines_before_renewal", kind: "condition", severity: "high", owner: "fleet_manager", entity: "vehicle", name: { ar: "مخالفات غير مسددة قبل التجديد", en: "Unpaid fines before renewal" } },
  { type: "defect_rejected", kind: "event", severity: "low", owner: "driver", entity: "defect", name: { ar: "تم رفض بلاغك", en: "Your report was rejected" } },
] as const satisfies readonly AlertTypeDef[];

export type AlertType = (typeof ALERT_TYPES)[number]["type"];
export const ALERT_STATUSES = ["open", "acknowledged", "in_progress", "resolved", "closed"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const SEVERITY_ORDER: Record<AlertSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
