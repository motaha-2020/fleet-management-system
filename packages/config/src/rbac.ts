/**
 * RBAC Matrix as data (PRD §5.3, Architecture §10).
 * The API's PermissionGuard and the generated RBAC tests both read from here,
 * so changing a cell here changes behaviour and tests together.
 *
 * Scope meaning:
 *  - "all"       whole tenant (or whole platform for platform actions)
 *  - "branches"  only the user's assigned branches
 *  - "assigned"  only records assigned to the user (drivers). Until Assignments (E07)
 *                exist, a driver's "assigned" vehicles resolve to the vehicles of
 *                the driver's own branch.
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
  "branch.read",
  "vehicle.read",
  "vehicle.write",
  "driver.read",
  "driver.write",
  "driver.issue_activation",
] as const;
export type Action = (typeof ACTIONS)[number];

export type Scope = "all" | "branches" | "assigned" | "own";

export type RbacMatrix = Record<Role, Partial<Record<Action, Scope>>>;

export const RBAC_MATRIX: RbacMatrix = {
  platform_admin: {
    "tenant.manage": "all",
  },
  company_admin: {
    "branch.read": "all",
    "vehicle.read": "all",
    "vehicle.write": "all",
    "driver.read": "all",
    "driver.write": "all",
    "driver.issue_activation": "all",
  },
  fleet_manager: {
    "branch.read": "branches",
    "vehicle.read": "branches",
    "vehicle.write": "branches",
    "driver.read": "branches",
    "driver.write": "branches",
    "driver.issue_activation": "branches",
  },
  finance_reviewer: {
    "branch.read": "all",
    "vehicle.read": "all",
  },
  driver: {
    "vehicle.read": "assigned",
    "driver.read": "own",
  },
  viewer: {
    "branch.read": "all",
    "vehicle.read": "all",
    "driver.read": "all",
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
