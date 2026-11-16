import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { schema, TenantPools, type Db } from "@fleet/db";
import type { Action, Role } from "@fleet/config";
import { allows } from "@fleet/domain";
import { CONTROL_DB, TENANT_POOLS } from "../infra/tokens.js";
import { AppError, forbidden, unauthorized } from "../infra/errors.js";
import { ALLOW_TEMP_PASSWORD, IS_PUBLIC, REQUIRES, type RequestContext } from "./context.js";
import { TokenService } from "./token.service.js";
import { PermissionService } from "./permissions.service.js";
import { HttpStatus } from "@nestjs/common";

/**
 * One global guard, in the order of Architecture §6.2:
 *  1. verify the signed access token
 *  2. resolve tenant + role from the token's membership, re-read from the control plane on every
 *     request so disabling a user or revoking a device takes effect immediately (SEC-006)
 *  3. check the role permissions (as the company configured them, PermissionService) for the handler's @Requires action and attach the granted scope
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(CONTROL_DB) private readonly db: Db,
    @Inject(TENANT_POOLS) private readonly pools: TenantPools,
    private readonly perms: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    let claims;
    try {
      claims = await this.tokens.verifyAccess(header.slice(7));
    } catch {
      throw unauthorized("Session expired or invalid");
    }

    const ctx = claims.bg ? await this.resolveSupport(claims.sub, claims.bg, claims.tid) : await this.resolve(claims.sub, claims.mid, claims.tid, claims.did);
    if (ctx.supportGrantId) {
      // SEC-007: read-only, and the customer sees every request in their audit log.
      if (req.method !== "GET") throw new AppError(HttpStatus.FORBIDDEN, "support_read_only", "Support access is read-only");
      await (await this.pools.get(ctx.tenantId!)).db.insert(schema.auditLog).values({
        actorId: ctx.identityId, action: "support.viewed", entityType: "support_access", entityId: ctx.supportGrantId,
        after: { method: req.method, path: req.originalUrl.slice(0, 500) }, before: null, branchId: null,
      });
    }

    // Owner decision (14 Nov 2026): after signing in with a temporary password, the new password comes first.
    if (ctx.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_TEMP_PASSWORD, targets)) {
      throw new AppError(HttpStatus.FORBIDDEN, "password_change_required", "Choose a new password first");
    }

    if (ctx.tenantStatus === "suspended" && req.method !== "GET") {
      throw new AppError(HttpStatus.FORBIDDEN, "tenant_suspended", "This company account is suspended (read-only)");
    }

    const actions = this.reflector.getAllAndOverride<Action[] | undefined>(REQUIRES, targets);
    if (actions?.length) {
      const decision = actions.map((a) => allows(ctx, a)).find((d) => d.allowed);
      if (!decision?.allowed) throw forbidden();
      ctx.scope = decision.scope;
    }
    req.ctx = ctx;
    return true;
  }

  /** A platform admin under an approved, unexpired, unrevoked grant for this tenant: a company-wide, read-only role. */
  private async resolveSupport(identityId: string, grantId: string, tenantId: string | null): Promise<RequestContext> {
    const [identity] = await this.db.select().from(schema.identities).where(eq(schema.identities.id, identityId));
    if (!identity || identity.disabledAt || !identity.isPlatformAdmin) throw unauthorized();
    const [row] = await this.db.select({ g: schema.breakGlassGrants, status: schema.tenants.status }).from(schema.breakGlassGrants)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.breakGlassGrants.tenantId))
      .where(and(eq(schema.breakGlassGrants.id, grantId), eq(schema.breakGlassGrants.requestedBy, identityId)));
    if (!row || row.g.tenantId !== tenantId || row.g.status !== "approved" || !row.g.expiresAt || row.g.expiresAt <= new Date()) throw unauthorized("Support access has ended");
    if (row.status !== "active" && row.status !== "suspended") throw unauthorized("Company account is not active");
    return { identityId, membershipId: null, tenantId, tenantStatus: row.status, role: "support", permissions: (await this.perms.resolve(tenantId, "support", null)).permissions, branchIds: [], driverId: null, deviceId: null, supportGrantId: grantId };
  }

  private async resolve(identityId: string, membershipId: string | null, tenantId: string | null, deviceId: string | null): Promise<RequestContext> {
    const [identity] = await this.db.select().from(schema.identities).where(eq(schema.identities.id, identityId));
    if (!identity || identity.disabledAt) throw unauthorized("Account disabled");

    if (!membershipId) {
      if (!identity.isPlatformAdmin || tenantId) throw unauthorized();
      return { identityId, mustChangePassword: identity.mustChangePassword, membershipId: null, tenantId: null, tenantStatus: null, role: "platform_admin", permissions: (await this.perms.resolve(null, "platform_admin", null)).permissions, branchIds: [], driverId: null, deviceId: null };
    }

    const [row] = await this.db
      .select({ m: schema.memberships, status: schema.tenants.status })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.identityId, identityId)));
    if (!row || !row.m.active || row.m.tenantId !== tenantId) throw unauthorized();
    if (row.status !== "active" && row.status !== "suspended") throw unauthorized("Company account is not active");

    if (deviceId) {
      const [device] = await this.db.select({ id: schema.devices.id }).from(schema.devices)
        .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.identityId, identityId), isNull(schema.devices.revokedAt)));
      if (!device) throw unauthorized("Device has been revoked");
    } else if (row.m.role === "driver") {
      throw unauthorized("Drivers must use an activated device");
    }

    const role = row.m.role as Role;
    return {
      identityId,
      mustChangePassword: identity.mustChangePassword,
      membershipId,
      tenantId: row.m.tenantId,
      tenantStatus: row.status,
      role,
      roleId: row.m.roleId,
      permissions: (await this.perms.resolve(row.m.tenantId, role, row.m.roleId)).permissions,
      branchIds: row.m.branchIds,
      driverId: row.m.driverId,
      deviceId,
    };
  }
}
