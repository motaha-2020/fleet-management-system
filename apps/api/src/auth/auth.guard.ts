import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "@fleet/db";
import type { Action, Role } from "@fleet/config";
import { authorize } from "@fleet/domain";
import { CONTROL_DB } from "../infra/tokens.js";
import { AppError, forbidden, unauthorized } from "../infra/errors.js";
import { IS_PUBLIC, REQUIRES, type RequestContext } from "./context.js";
import { TokenService } from "./token.service.js";
import { HttpStatus } from "@nestjs/common";

/**
 * One global guard, in the order of Architecture §6.2:
 *  1. verify the signed access token
 *  2. resolve tenant + role from the token's membership, re-read from the control plane on every
 *     request so disabling a user or revoking a device takes effect immediately (SEC-006)
 *  3. check the RBAC matrix for the handler's @Requires action and attach the granted scope
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(CONTROL_DB) private readonly db: Db,
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

    const ctx = await this.resolve(claims.sub, claims.mid, claims.tid, claims.did);

    if (ctx.tenantStatus === "suspended" && req.method !== "GET") {
      throw new AppError(HttpStatus.FORBIDDEN, "tenant_suspended", "This company account is suspended (read-only)");
    }

    const action = this.reflector.getAllAndOverride<Action | undefined>(REQUIRES, targets);
    if (action) {
      const decision = authorize(ctx.role, action);
      if (!decision.allowed) throw forbidden();
      ctx.scope = decision.scope;
    }
    req.ctx = ctx;
    return true;
  }

  private async resolve(identityId: string, membershipId: string | null, tenantId: string | null, deviceId: string | null): Promise<RequestContext> {
    const [identity] = await this.db.select().from(schema.identities).where(eq(schema.identities.id, identityId));
    if (!identity || identity.disabledAt) throw unauthorized("Account disabled");

    if (!membershipId) {
      if (!identity.isPlatformAdmin || tenantId) throw unauthorized();
      return { identityId, membershipId: null, tenantId: null, tenantStatus: null, role: "platform_admin", branchIds: [], driverId: null, deviceId: null };
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

    return {
      identityId,
      membershipId,
      tenantId: row.m.tenantId,
      tenantStatus: row.status,
      role: row.m.role as Role,
      branchIds: row.m.branchIds,
      driverId: row.m.driverId,
      deviceId,
    };
  }
}
