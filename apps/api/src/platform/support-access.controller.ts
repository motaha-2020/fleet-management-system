import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { routes } from "@fleet/contracts";
import { schema, newId, TenantPools, type Db } from "@fleet/db";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, notFound } from "../infra/errors.js";
import { CONTROL_DB, TENANT_POOLS } from "../infra/tokens.js";
import { TokenService } from "../auth/token.service.js";
import { AuthService } from "../auth/auth.service.js";

const G = schema.breakGlassGrants;
type Row = typeof G.$inferSelect;

/**
 * SEC-007 / US-E02-06 break-glass support access. Without an approved grant a platform admin cannot open
 * tenant data at all (no membership). A company admin approves a request; the support session is read-only,
 * ends automatically after D-SEC-BREAKGLASS, can be revoked, and every request lands in the tenant's audit log.
 */
@Controller()
export class SupportAccessController {
  constructor(
    @Inject(CONTROL_DB) private readonly db: Db,
    @Inject(TENANT_POOLS) private readonly pools: TenantPools,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  private async dto(rows: Row[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.requestedBy]))];
    const people = ids.length ? await this.db.select({ id: schema.identities.id, n: schema.identities.displayName }).from(schema.identities).where(inArray(schema.identities.id, ids)) : [];
    const tIds = [...new Set(rows.map((r) => r.tenantId))];
    const tenants = tIds.length ? await this.db.select({ id: schema.tenants.id, n: schema.tenants.name }).from(schema.tenants).where(inArray(schema.tenants.id, tIds)) : [];
    const now = Date.now();
    return rows.map((g) => ({
      id: g.id, tenantId: g.tenantId, tenantName: tenants.find((t) => t.id === g.tenantId)?.n ?? "", requestedBy: g.requestedBy,
      requestedByName: people.find((p) => p.id === g.requestedBy)?.n ?? "", reason: g.reason,
      status: g.status === "approved" && g.expiresAt && g.expiresAt.getTime() <= now ? ("expired" as const) : g.status,
      decidedBy: g.decidedBy, decidedAt: g.decidedAt?.toISOString() ?? null, expiresAt: g.expiresAt?.toISOString() ?? null, createdAt: g.createdAt.toISOString(),
    }));
  }

  /** Visible to the customer: the tenant's own audit log. */
  private async tenantAudit(tenantId: string, actorId: string, action: string, grantId: string, after: Record<string, unknown>) {
    await (await this.pools.get(tenantId)).db.insert(schema.auditLog).values({ actorId, action, entityType: "support_access", entityId: grantId, after, before: null, branchId: null });
  }

  // ---------------------------------------------------------------- platform side

  @Requires("tenant.manage") @Post(routes.requestSupportAccess.path) @HttpCode(201)
  async request(@Param("id", ParseUUIDPipe) tenantId: string, @Body(new ZodPipe(routes.requestSupportAccess.body)) b: z.output<typeof routes.requestSupportAccess.body>, @Ctx() ctx: RequestContext) {
    const [t] = await this.db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    if (!t || (t.status !== "active" && t.status !== "suspended")) throw notFound("tenant");
    const [row] = await this.db.insert(G).values({ id: newId(), tenantId, requestedBy: ctx.identityId, reason: b.reason }).returning();
    await this.db.insert(schema.platformAudit).values({ actorId: ctx.identityId, tenantId, action: "support.requested", detail: { grantId: row!.id, reason: b.reason } });
    await this.tenantAudit(tenantId, ctx.identityId, "support.requested", row!.id, { reason: b.reason });
    return (await this.dto([row!]))[0];
  }

  @Requires("tenant.manage") @Get(routes.platformSupportGrants.path)
  async mine(@Ctx() ctx: RequestContext) {
    return { items: await this.dto(await this.db.select().from(G).where(eq(G.requestedBy, ctx.identityId)).orderBy(desc(G.createdAt)).limit(100)) };
  }

  /** A short access token for this grant; the session cannot outlive the grant and has no refresh token. */
  @Requires("tenant.manage") @Post(routes.openSupportSession.path) @HttpCode(200)
  async session(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const [g] = await this.db.select().from(G).where(and(eq(G.id, id), eq(G.requestedBy, ctx.identityId)));
    if (!g) throw notFound("grant");
    if (g.status !== "approved" || !g.expiresAt || g.expiresAt <= new Date()) throw conflict("not_approved", "This request is not approved or has ended");
    const [t] = await this.db.select().from(schema.tenants).where(eq(schema.tenants.id, g.tenantId));
    const access = await this.tokens.signAccess({ sub: ctx.identityId, mid: null, tid: g.tenantId, did: null, bg: g.id });
    await this.db.insert(schema.platformAudit).values({ actorId: ctx.identityId, tenantId: g.tenantId, action: "support.session_opened", detail: { grantId: g.id } });
    await this.tenantAudit(g.tenantId, ctx.identityId, "support.session_opened", g.id, { expiresAt: g.expiresAt.toISOString() });
    const me = await this.auth.describe(ctx.identityId, null);
    return {
      accessToken: access.token, expiresIn: Math.min(access.expiresIn, Math.floor((g.expiresAt.getTime() - Date.now()) / 1000)),
      user: { ...me, role: "viewer" as const, tenant: { id: t!.id, slug: t!.slug, name: t!.name, countryCode: t!.countryCode }, memberships: [], currentMembershipId: null,
        support: { grantId: g.id, expiresAt: g.expiresAt.toISOString() } },
    };
  }

  // ---------------------------------------------------------------- customer side

  @Requires("user.manage") @Get(routes.supportGrants.path)
  async list(@Ctx() ctx: RequestContext) {
    return { items: await this.dto(await this.db.select().from(G).where(eq(G.tenantId, tenantOf(ctx))).orderBy(desc(G.createdAt)).limit(100)) };
  }

  @Requires("user.manage") @Post(routes.decideSupportAccess.path) @HttpCode(200)
  async decide(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.decideSupportAccess.body)) b: z.output<typeof routes.decideSupportAccess.body>, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const now = new Date();
    const [row] = await this.db.update(G).set(b.approve
      ? { status: "approved", decidedBy: ctx.identityId, decidedAt: now, expiresAt: new Date(now.getTime() + DEFAULTS.BREAK_GLASS_HOURS * 3_600_000) }
      : { status: "rejected", decidedBy: ctx.identityId, decidedAt: now })
      .where(and(eq(G.id, id), eq(G.tenantId, tenantId), eq(G.status, "requested"))).returning();
    if (!row) {
      const [g] = await this.db.select({ id: G.id }).from(G).where(and(eq(G.id, id), eq(G.tenantId, tenantId)));
      if (!g) throw notFound("request");
      throw conflict("already_decided", "This request was already decided");
    }
    await this.tenantAudit(tenantId, ctx.identityId, b.approve ? "support.approved" : "support.rejected", id, { expiresAt: row.expiresAt?.toISOString() ?? null });
    await this.db.insert(schema.platformAudit).values({ actorId: ctx.identityId, tenantId, action: b.approve ? "support.approved" : "support.rejected", detail: { grantId: id } });
    return (await this.dto([row]))[0];
  }

  @Requires("user.manage") @Post(routes.revokeSupportAccess.path) @HttpCode(200)
  async revoke(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const [row] = await this.db.update(G).set({ status: "revoked", revokedBy: ctx.identityId, revokedAt: new Date() })
      .where(and(eq(G.id, id), eq(G.tenantId, tenantId), inArray(G.status, ["requested", "approved"]))).returning();
    if (!row) throw notFound("request");
    await this.tenantAudit(tenantId, ctx.identityId, "support.revoked", id, {});
    return (await this.dto([row]))[0];
  }
}
