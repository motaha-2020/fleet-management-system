import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Action, Permissions, Role, Scope } from "@fleet/config";
import type { Principal } from "@fleet/domain";

/** Built by AuthGuard from the signed token + current DB state. Never from client input (TEN-002). */
export interface RequestContext extends Principal {
  identityId: string;
  membershipId: string | null;
  tenantId: string | null;
  tenantStatus: string | null;
  role: Role;
  /** For a custom role: its id in the company database. */
  roleId?: string | null;
  /** What the current role may do, as the company configured it (PermissionService). */
  permissions: Permissions;
  deviceId: string | null;
  /** Break-glass support session: read-only, every request audited in the tenant (SEC-007). */
  supportGrantId?: string;
  /** Signed in with a temporary password that has not been replaced yet. */
  mustChangePassword?: boolean;
  /** Scope granted for the action declared with @Requires on the handler. */
  scope?: Scope;
}

export const IS_PUBLIC = "fleet:public";
export const REQUIRES = "fleet:requires";
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Reachable while the person still has to replace a temporary password (everything else answers 403). */
export const ALLOW_TEMP_PASSWORD = "fleet:allow-temp-password";
export const AllowWithTemporaryPassword = () => SetMetadata(ALLOW_TEMP_PASSWORD, true);
/** The handler needs one of these actions; the scope of the first one the role holds is attached to the context. */
export const Requires = (...actions: [Action, ...Action[]]) => SetMetadata(REQUIRES, actions);

export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<{ ctx?: RequestContext }>();
  if (!req.ctx) throw new Error("RequestContext missing: route is public?");
  return req.ctx;
});

/** For tenant-scoped handlers: narrows tenantId to string. */
export function tenantOf(ctx: RequestContext): string {
  if (!ctx.tenantId) throw new Error("tenant context required");
  return ctx.tenantId;
}
