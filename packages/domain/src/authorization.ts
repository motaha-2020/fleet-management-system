import { RBAC_MATRIX, type Action, type Role, type Scope, type RbacMatrix } from "@fleet/config";

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

export function authorize(role: Role, action: Action, matrix: RbacMatrix = RBAC_MATRIX): AccessDecision {
  const scope = matrix[role]?.[action];
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
