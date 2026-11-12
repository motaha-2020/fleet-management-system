/**
 * Operational readiness rule catalog (PRD §17.1, Gap Analysis Annex C) as data.
 * Risk decides the outcome: R4/R3 → Restricted (R3 can be overridden), R2 → Allowed with Warning,
 * R1 → Allowed (information). A company may raise a rule's risk, never lower it (GEN-008, US-E12-01).
 * Document rules take their risk from the document type (country catalog) unless noted.
 */
export type Risk = "R1" | "R2" | "R3" | "R4";
export type ReadinessDimension = "vehicle" | "driver" | "availability" | "authorization";

export interface ReadinessRuleDef {
  code: string;
  dimension: ReadinessDimension;
  /** Fixed risk, or "document_type" when it follows the document type's risk. */
  risk: Risk | "document_type";
  name: { ar: string; en: string };
}

export const READINESS_RULES = [
  { code: "license_expired", dimension: "driver", risk: "R4", name: { ar: "رخصة السائق منتهية", en: "Driver license expired" } },
  { code: "license_category", dimension: "driver", risk: "R4", name: { ar: "فئة الرخصة لا تناسب المركبة", en: "License category does not fit the vehicle" } },
  { code: "license_missing", dimension: "driver", risk: "R4", name: { ar: "لا توجد بيانات رخصة", en: "No license on file" } },
  { code: "employment_suspended", dimension: "driver", risk: "R4", name: { ar: "السائق موقوف عن العمل", en: "Driver suspended" } },
  { code: "employment_terminated", dimension: "driver", risk: "R4", name: { ar: "انتهت خدمة السائق", en: "Driver terminated" } },
  { code: "vehicle_not_active", dimension: "vehicle", risk: "R4", name: { ar: "المركبة غير نشطة", en: "Vehicle not active" } },
  { code: "wo_not_drivable", dimension: "availability", risk: "R4", name: { ar: "أمر شغل مفتوح: غير صالحة للقيادة", en: "Open work order: not drivable" } },
  { code: "defect_not_drivable", dimension: "availability", risk: "R3", name: { ar: "بلاغ عطل غير صالح للقيادة لم يُراجع", en: "Unreviewed not-drivable defect" } },
  { code: "doc_expired", dimension: "vehicle", risk: "document_type", name: { ar: "مستند إلزامي منتهٍ", en: "Mandatory document expired" } },
  { code: "doc_missing", dimension: "vehicle", risk: "R2", name: { ar: "دليل إلزامي غير موجود", en: "Missing mandatory evidence" } },
  { code: "doc_pending", dimension: "vehicle", risk: "R2", name: { ar: "مستند إلزامي بانتظار التحقق", en: "Mandatory document pending verification" } },
  { code: "doc_expiring", dimension: "vehicle", risk: "R1", name: { ar: "مستند ينتهي قريبًا", en: "Document expiring soon" } },
  { code: "maintenance_overdue_safety", dimension: "vehicle", risk: "R3", name: { ar: "صيانة متأخرة لبند سلامة", en: "Overdue safety maintenance" } },
  { code: "maintenance_overdue", dimension: "vehicle", risk: "R2", name: { ar: "صيانة وقائية متأخرة", en: "Overdue preventive maintenance" } },
  { code: "no_assignment", dimension: "authorization", risk: "R3", name: { ar: "لا يوجد تخصيص ساري", en: "No valid assignment" } },
] as const satisfies readonly ReadinessRuleDef[];

export type ReadinessRuleCode = (typeof READINESS_RULES)[number]["code"];

export const RISK_ORDER: Record<Risk, number> = { R1: 1, R2: 2, R3: 3, R4: 4 };
