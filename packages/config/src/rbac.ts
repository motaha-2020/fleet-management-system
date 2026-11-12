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
  "viewer",
] as const;
export type Role = (typeof ROLES)[number];

export const TENANT_ROLES = ROLES.filter((r) => r !== "platform_admin") as Exclude<Role, "platform_admin">[];

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
  "correction.approve",
  "fuel_price.manage",
] as const;
export type Action = (typeof ACTIONS)[number];

export type Scope = "all" | "branches" | "assigned" | "own";

export type RbacMatrix = Record<Role, Partial<Record<Action, Scope>>>;

export const RBAC_MATRIX: RbacMatrix = {
  platform_admin: {
    "tenant.manage": "all",
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
  },
  fleet_manager: {
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
  },
  finance_reviewer: {
    "branch.read": "all",
    "vendor.read": "all",
    "vendor.write": "all",
    "vehicle.read": "all",
    "odometer.read": "all",
    "fuel.read": "all",
    "fuel.review": "all",
    "cost.read": "all",
    "cost.write": "all",
    "correction.request": "all",
    // Finance approves financial corrections only (checked per correction).
    "correction.approve": "all",
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
    "correction.request": "own",
  },
  viewer: {
    "branch.read": "all",
    "vendor.read": "all",
    "vehicle.read": "all",
    "driver.read": "all",
    "document.read": "all",
    "assignment.read": "all",
    "odometer.read": "all",
    "fuel.read": "all",
  },
};

export const ROLE_LABELS: Record<Role, { ar: string; en: string }> = {
  platform_admin: { ar: "مدير المنصة", en: "Platform Administrator" },
  company_admin: { ar: "مدير الشركة", en: "Company Administrator" },
  fleet_manager: { ar: "مدير الأسطول", en: "Fleet Manager" },
  finance_reviewer: { ar: "المراجع المالي", en: "Finance Reviewer" },
  driver: { ar: "سائق", en: "Driver" },
  viewer: { ar: "مشاهد", en: "Viewer" },
};
