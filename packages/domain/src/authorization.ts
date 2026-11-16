import { RBAC_MATRIX, type Action, type Permissions, type Role, type Scope, type RbacMatrix } from "@fleet/config";

export interface Principal {
  role: Role;
  /** Branches the user is assigned to (fleet managers, drivers). */
  branchIds: readonly string[];
  /** Driver record linked to this identity, if any. */
  driverId?: string | null;
}

export type AccessDecision =
  | { allowed: false }
  | { allowed: true; scope: Scope };

/** The built-in default for a role (what a new company starts with). Custom roles get their permissions from the company. */
export function authorize(role: Role, action: Action, matrix: RbacMatrix = RBAC_MATRIX): AccessDecision {
  const scope = matrix[role]?.[action];
  return scope ? { allowed: true, scope } : { allowed: false };
}

/**
 * The real check: what this person's current role may do, as the company configured it (owner decision 14 Nov 2026).
 * Takes anything carrying `permissions` (the API request context, the signed-in user on the web).
 */
export function allows(who: { permissions: Permissions } | null | undefined, action: Action): AccessDecision {
  const scope = who?.permissions[action];
  return scope ? { allowed: true, scope } : { allowed: false };
}

/**
 * Branch filter to apply to a query for this principal and scope.
 * `null` means "no branch restriction" (tenant-wide).
 */
export function branchFilter(principal: Principal, scope: Scope): readonly string[] | null {
  switch (scope) {
    case "all":
      return null;
    case "branches":
    case "assigned": // M0: until Assignments (E07), a driver's assigned vehicles = own branch
    case "own":
      return principal.branchIds;
  }
}

/** Can this principal act on a record that belongs to `branchId`? */
export function canAccessBranch(principal: Principal, scope: Scope, branchId: string): boolean {
  const filter = branchFilter(principal, scope);
  return filter === null || filter.includes(branchId);
}
