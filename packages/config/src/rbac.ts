/**
 * RBAC Matrix as data (PRD §5.3, Architecture §10).
 * The API's PermissionGuard and the generated RBAC tests both read from here,
 * so changing a cell here changes behaviour and tests together.
 *
 * Scope meaning:
 *  - "all"       whole tenant (or whole platform for platform actions)
 *  - "branches"  only the user's assigned branches
 *  - "assigned"  only vehicles the driver holds an active assignment on (E07)
 *  - "own"       only the user's own record
 */
export const ROLES = [
  "platform_admin",
  "company_admin",
  "fleet_manager",
  "finance_reviewer",
  "driver",
  // A role the company made itself (name + permissions in the company database; owner decision 14 Nov 2026).
  "custom",
  // Platform support inside a company under an approved break-glass grant: read-only, never assignable.
  "support",
] as const;
export type Role = (typeof ROLES)[number];

/** Roles a company admin can give to a colleague (drivers are made under /drivers). */
export const STAFF_ROLES = ["company_admin", "fleet_manager", "finance_reviewer", "custom"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
/** Built-in roles whose permissions the company admin may change. Company admin and driver are fixed. */
export const EDITABLE_SYSTEM_ROLES = ["fleet_manager", "finance_reviewer"] as const;
export type EditableSystemRole = (typeof EDITABLE_SYSTEM_ROLES)[number];

export const ACTIONS = [
  "tenant.manage",
  "user.manage",
  "branch.read",
  "branch.write",
  "vendor.read",
  "vendor.write",
  "vehicle.read",
  "vehicle.write",
  "vehicle.transfer",
  "vehicle.dispose",
  "driver.read",
  "driver.write",
  "driver.issue_activation",
  "driver.view_sensitive",
  "document_type.manage",
  "document.read",
  "document.upload",
  "document.verify",
  "document.download",
  "audit.read",
  "assignment.read",
  "assignment.write",
  "assignment.backdate",
  "handover.create",
  "odometer.read",
  "odometer.write",
  "odometer.replace",
  "fuel.read",
  "fuel.create",
  "fuel.review",
  "cost.read",
  "cost.write",
  "correction.request",
  // Non-financial corrections (fleet side) and financial ones (finance side) are approved separately.
  "correction.approve",
  "correction.approve_financial",
  "fuel_price.manage",
  // Outgoing email (sign-in codes, password reset, invites, alerts) for the whole platform.
  "mail_settings.manage",
  // E14: drivers send offline events; office staff review the conflict queue.
  "sync.submit",
  "sync.conflict_review",
  // E10 / E12
  "maintenance.read",
  "maintenance.manage",
  "maintenance_template.manage",
  "defect.report",
  "defect.triage",
  "readiness.read",
  "readiness.override",
  "readiness.configure",
  // M5: E13 alerts, FUEL-015 budgets, E29 fines, E18 reports, E17 import
  "alert.read",
  "alert.manage",
  "notification.read",
  "fuel_budget.manage",
  "fine.read",
  "fine.write",
  "report.read",
  "report.export",
  "import.manage",
  // GEN-007 effective-dated company policies
  "policy.manage",
  // The company's roles and their permissions (owner decision 14 Nov 2026: the company admin edits them).
  "role.manage",
  // The company profile (name, logo, address, registration numbers); owner decision 14 Nov 2026.
  "company.manage",
] as const;
export type Action = (typeof ACTIONS)[number];

export type Scope = "all" | "branches" | "assigned" | "own";

/** What one person may do in their current role: action → scope. */
export type Permissions = Partial<Record<Action, Scope>>;
export type RbacMatrix = Record<Role, Permissions>;

export const RBAC_MATRIX: RbacMatrix = {
  platform_admin: {
    "tenant.manage": "all",
    "mail_settings.manage": "all",
    "fuel_price.manage": "all",
  },
  company_admin: {
    "user.manage": "all",
    "branch.read": "all",
    "branch.write": "all",
    "vendor.read": "all",
    "vendor.write": "all",
    "vehicle.read": "all",
    "vehicle.write": "all",
    "vehicle.transfer": "all",
    "vehicle.dispose": "all",
    "driver.read": "all",
    "driver.write": "all",
    "driver.issue_activation": "all",
    "driver.view_sensitive": "all",
    "document_type.manage": "all",
    "document.read": "all",
    "document.upload": "all",
    "document.verify": "all",
    "document.download": "all",
    "audit.read": "all",
    "assignment.read": "all",
    "assignment.write": "all",
    "assignment.backdate": "all",
    "handover.create": "all",
    "odometer.read": "all",
    "odometer.write": "all",
    "odometer.replace": "all",
    "fuel.read": "all",
    "fuel.create": "all",
    "fuel.review": "all",
    "cost.read": "all",
    "cost.write": "all",
    "correction.request": "all",
    "correction.approve": "all",
    "sync.conflict_review": "all",
    "maintenance.read": "all",
    "maintenance.manage": "all",
    "maintenance_template.manage": "all",
    "defect.report": "all",
    "defect.triage": "all",
    "readiness.read": "all",
    "readiness.override": "all",
    "readiness.configure": "all",
    "alert.read": "all",
    "alert.manage": "all",
    "notification.read": "all",
    "fuel_budget.manage": "all",
    "fine.read": "all",
    "fine.write": "all",
    "report.read": "all",
    "report.export": "all",
    "import.manage": "all",
    "policy.manage": "all",
    "role.manage": "all",
    "company.manage": "all",
    "correction.approve_financial": "all",
  },
  fleet_manager: {
    "sync.conflict_review": "branches",
    "branch.read": "branches",
    "vendor.read": "branches",
    "vendor.write": "branches",
    "vehicle.read": "branches",
    "vehicle.write": "branches",
    "vehicle.transfer": "branches", // PRD §5.3: "نقل فقط" — transfer yes, dispose no
    "driver.read": "branches",
    "driver.write": "branches",
    "driver.issue_activation": "branches",
    "document.read": "branches",
    "document.upload": "branches",
    "document.verify": "branches",
    "document.download": "branches",
    "audit.read": "branches",
    "assignment.read": "branches",
    "assignment.write": "branches",
    "handover.create": "branches",
    "odometer.read": "branches",
    "odometer.write": "branches",
    "odometer.replace": "branches",
    "fuel.read": "branches",
    "fuel.create": "branches",
    "fuel.review": "branches",
    "cost.read": "branches",
    "cost.write": "branches",
    "correction.request": "branches",
    // PRD §5.3: fleet managers approve non-financial corrections only (checked per correction).
    "correction.approve": "branches",
    "maintenance.read": "branches",
    "maintenance.manage": "branches",
    "defect.report": "branches",
    "defect.triage": "branches",
    "readiness.read": "branches",
    // PRD §5.3 "حسب الإعداد": allowed by default for R2/R3 on their branches; R4 is never overridable.
    "readiness.override": "branches",
    "alert.read": "branches",
    "alert.manage": "branches",
    "fine.read": "branches",
    "fine.write": "branches",
    "report.read": "branches",
    "report.export": "branches",
    "import.manage": "branches",
  },
  // Owner decision (14 Nov 2026): finance sees and exports data and costs, and approves financial corrections only.
  finance_reviewer: {
    "branch.read": "all",
    "vendor.read": "all",
    "vehicle.read": "all",
    "odometer.read": "all",
    "fuel.read": "all",
    "cost.read": "all",
    "correction.request": "all",
    "correction.approve_financial": "all",
    "maintenance.read": "all",
    "alert.read": "all",
    "alert.manage": "all",
    "fine.read": "all",
    "report.read": "all",
    "report.export": "all",
  },
  driver: {
    "vehicle.read": "assigned",
    "driver.read": "own",
    // Documents of the driver's vehicles, filtered by each type's driver visibility (DOC-007)
    "document.read": "assigned",
    "document.download": "assigned",
    "document.upload": "own",
    "assignment.read": "own",
    "handover.create": "own",
    "odometer.read": "assigned",
    "odometer.write": "own",
    "fuel.read": "own",
    "fuel.create": "own",
    "sync.submit": "own",
    "correction.request": "own",
    "defect.report": "own",
    "readiness.read": "assigned",
    // The driver's own notifications (in-app), e.g. a rejected defect report.
    "alert.read": "own",
  },
  // Permissions of a custom role come from the company database, never from here.
  custom: {},
  support: {
    "branch.read": "all",
    "vendor.read": "all",
    "vehicle.read": "all",
    "driver.read": "all",
    "document.read": "all",
    "assignment.read": "all",
    "odometer.read": "all",
    "fuel.read": "all",
    "cost.read": "all",
    "maintenance.read": "all",
    "readiness.read": "all",
    "alert.read": "all",
    "fine.read": "all",
    "report.read": "all",
  },
};

export const ROLE_LABELS: Record<Role, { ar: string; en: string }> = {
  platform_admin: { ar: "مدير المنصة", en: "Platform Administrator" },
  company_admin: { ar: "مدير الشركة", en: "Company Administrator" },
  fleet_manager: { ar: "مدير الأسطول", en: "Fleet Manager" },
  finance_reviewer: { ar: "المدير المالي", en: "Finance Manager" },
  driver: { ar: "سائق", en: "Driver" },
  custom: { ar: "دور مخصص", en: "Custom role" },
  support: { ar: "دعم المنصة", en: "Platform support" },
};

/** Platform-wide actions: never part of a company role. */
export const PLATFORM_ACTIONS: readonly Action[] = ["tenant.manage", "mail_settings.manage", "fuel_price.manage"];
/** Only the company admin manages people and permissions (locked on the permissions page). */
export const ADMIN_ONLY_ACTIONS: readonly Action[] = ["user.manage", "role.manage", "company.manage"];
/** Things only the driver app does. */
export const DRIVER_ONLY_ACTIONS: readonly Action[] = ["sync.submit"];
/** Actions a company admin can switch on or off for an office role on the permissions page. */
export const OFFICE_ACTIONS: readonly Action[] = ACTIONS.filter(
  (a) => !PLATFORM_ACTIONS.includes(a) && !ADMIN_ONLY_ACTIONS.includes(a) && !DRIVER_ONLY_ACTIONS.includes(a),
);
/** Scopes an office role can have for an action: the whole company, or the person's branches. */
export const OFFICE_SCOPES = ["all", "branches"] as const;
export type OfficeScope = (typeof OFFICE_SCOPES)[number];

/** Keeps only what an office role may hold: drops platform, admin-only and driver-only actions, and other scopes. */
export function sanitizeOfficePermissions(p: Partial<Record<string, string>>): Permissions {
  const out: Permissions = {};
  for (const a of OFFICE_ACTIONS) {
    const s = p[a];
    if (s === "all" || s === "branches") out[a] = s;
  }
  return out;
}

/** Groups for the permissions page, in the order they are shown. */
export const ACTION_GROUPS: { key: string; actions: readonly Action[] }[] = [
  { key: "company", actions: ["branch.read", "branch.write", "vendor.read", "vendor.write", "policy.manage", "audit.read", "import.manage"] },
  { key: "vehicles", actions: ["vehicle.read", "vehicle.write", "vehicle.transfer", "vehicle.dispose", "assignment.read", "assignment.write", "assignment.backdate", "handover.create"] },
  { key: "drivers", actions: ["driver.read", "driver.write", "driver.issue_activation", "driver.view_sensitive"] },
  { key: "documents", actions: ["document_type.manage", "document.read", "document.upload", "document.verify", "document.download"] },
  { key: "operations", actions: ["odometer.read", "odometer.write", "odometer.replace", "fuel.read", "fuel.create", "fuel.review", "sync.conflict_review"] },
  { key: "money", actions: ["cost.read", "cost.write", "fuel_budget.manage", "fine.read", "fine.write", "correction.request", "correction.approve", "correction.approve_financial"] },
  { key: "maintenance", actions: ["maintenance.read", "maintenance.manage", "maintenance_template.manage", "defect.report", "defect.triage", "readiness.read", "readiness.override", "readiness.configure"] },
  { key: "reports", actions: ["alert.read", "alert.manage", "notification.read", "report.read", "report.export"] },
];
