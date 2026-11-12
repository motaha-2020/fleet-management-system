import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { routes, type TenantUser } from "@fleet/contracts";
import { schema, newId, sha256, randomToken, type Db } from "@fleet/db";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB } from "../infra/tokens.js";
import { conflict, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantDb } from "../fleet/tenant-db.js";

const S = schema;
const INVITE_TTL_MS = 7 * 24 * 3600_000;

/** US-E02-03: company users (staff). Drivers are managed under /drivers. */
@Controller()
export class UsersController {
  constructor(@Inject(CONTROL_DB) private readonly db: Db, private readonly tdb: TenantDb) {}

  private async load(tenantId: string, membershipId?: string): Promise<TenantUser[]> {
    const rows = await this.db.select({ m: S.memberships, i: S.identities }).from(S.memberships)
      .innerJoin(S.identities, eq(S.identities.id, S.memberships.identityId))
      .where(and(eq(S.memberships.tenantId, tenantId), ne(S.memberships.role, "driver"), membershipId ? eq(S.memberships.id, membershipId) : undefined))
      .orderBy(asc(S.identities.displayName));
    return rows.map(({ m, i }) => ({
      membershipId: m.id, identityId: i.id, email: i.email, displayName: i.displayName, role: m.role, branchIds: m.branchIds,
      active: m.active && !i.disabledAt, mfaEnabled: !!i.mfaEnabledAt, invitePending: !i.passwordHash,
    }));
  }

  private async one(tenantId: string, membershipId: string) {
    const [u] = await this.load(tenantId, membershipId);
    if (!u) throw notFound("user");
    return u;
  }

  private async assertBranches(ctx: RequestContext, role: string, branchIds: readonly string[]) {
    if (role === "fleet_manager" && !branchIds.length) throw validation({ branchIds: "required" });
    if (!branchIds.length) return;
    const db = await this.tdb.for(ctx);
    const found = await db.select({ id: S.branches.id }).from(S.branches).where(inArray(S.branches.id, [...branchIds]));
    if (found.length !== new Set(branchIds).size) throw validation({ branchIds: "unknown_branch" });
  }

  @Requires("user.manage") @Get(routes.listUsers.path)
  async list(@Ctx() ctx: RequestContext) {
    return { items: await this.load(tenantOf(ctx)) };
  }

  @Requires("user.manage") @Post(routes.inviteUser.path) @HttpCode(201)
  async invite(@Body(new ZodPipe(routes.inviteUser.body)) b: z.output<typeof routes.inviteUser.body>, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const branchIds = b.role === "fleet_manager" ? b.branchIds : [];
    await this.assertBranches(ctx, b.role, branchIds);
    const email = b.email.toLowerCase();
    let inviteToken: string | null = null;
    const membershipId = newId();
    await this.db.transaction(async (tx) => {
      let [identity] = await tx.select().from(S.identities).where(eq(S.identities.email, email));
      if (!identity) [identity] = await tx.insert(S.identities).values({ id: newId(), email, displayName: b.displayName }).returning();
      if (identity!.isPlatformAdmin) throw conflict("platform_identity", "Platform administrators cannot be company users", { email: "taken" });
      const [existing] = await tx.select({ id: S.memberships.id }).from(S.memberships)
        .where(and(eq(S.memberships.identityId, identity!.id), eq(S.memberships.tenantId, tenantId), eq(S.memberships.role, b.role)));
      if (existing) throw conflict("already_member", "This person already has this role", { role: "taken" });
      await tx.insert(S.memberships).values({ id: membershipId, identityId: identity!.id, tenantId, role: b.role, branchIds });
      // People who already have a password just get the new role (role switcher); others get an invite.
      if (!identity!.passwordHash) {
        inviteToken = randomToken(32);
        await tx.update(S.invites).set({ usedAt: new Date() }).where(and(eq(S.invites.identityId, identity!.id), isNull(S.invites.usedAt)));
        await tx.insert(S.invites).values({ id: newId(), identityId: identity!.id, tenantId, tokenHash: sha256(inviteToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
      }
    });
    const user = await this.one(tenantId, membershipId);
    await TenantDb.audit(await this.tdb.for(ctx), ctx, "user.invited", "user", membershipId, { email, role: b.role, branchIds });
    return { user, inviteToken };
  }

  @Requires("user.manage") @Patch(routes.updateUser.path)
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateUser.body)) b: z.output<typeof routes.updateUser.body>, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const before = await this.one(tenantId, id);
    if (id === ctx.membershipId && (b.active === false || (b.role && b.role !== before.role))) {
      throw conflict("self_change", "You cannot deactivate or change your own role");
    }
    const role = b.role ?? before.role;
    const branchIds = role === "fleet_manager" ? (b.branchIds ?? before.branchIds) : [];
    await this.assertBranches(ctx, role, branchIds);

    await this.db.transaction(async (tx) => {
      // Lock the tenant's admin memberships so two admins cannot demote each other at once.
      await tx.execute(sql`SELECT id FROM memberships WHERE tenant_id = ${tenantId} AND role = 'company_admin' FOR UPDATE`);
      await tx.update(S.memberships).set({ role: role as "company_admin", branchIds, active: b.active ?? before.active, updatedAt: new Date() })
        .where(and(eq(S.memberships.id, id), eq(S.memberships.tenantId, tenantId)));
      const [{ admins }] = (await tx.select({ admins: sql<number>`count(*)::int` }).from(S.memberships)
        .where(and(eq(S.memberships.tenantId, tenantId), eq(S.memberships.role, "company_admin"), eq(S.memberships.active, true)))) as [{ admins: number }];
      if (admins < 1) throw conflict("last_admin", "The company needs at least one active company admin");
      if (b.active === false || role !== before.role) {
        // SEC-006: revocation is immediate — existing sessions of this membership end now.
        await tx.update(S.refreshTokens).set({ revokedAt: new Date() }).where(and(eq(S.refreshTokens.membershipId, id), isNull(S.refreshTokens.revokedAt)));
      }
    }).catch((e: unknown) => {
      if (uniqueViolation(e)) throw conflict("already_member", "This person already has this role", { role: "taken" });
      throw e;
    });
    const after = await this.one(tenantId, id);
    await TenantDb.audit(await this.tdb.for(ctx), ctx, "user.updated", "user", id,
      { role: after.role, branchIds: after.branchIds, active: after.active }, { role: before.role, branchIds: before.branchIds, active: before.active });
    return after;
  }

  /** Lost phone: the user enrols again at next login. Only for people who belong to this company alone. */
  @Requires("user.manage") @Post(routes.resetUserMfa.path) @HttpCode(200)
  async resetMfa(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const user = await this.one(tenantId, id);
    if (user.identityId === ctx.identityId) throw conflict("self_change", "You cannot reset your own two-step verification");
    const [{ others }] = (await this.db.select({ others: sql<number>`count(*)::int` }).from(S.memberships)
      .where(and(eq(S.memberships.identityId, user.identityId), ne(S.memberships.tenantId, tenantId)))) as [{ others: number }];
    if (others > 0) throw conflict("shared_identity", "This person also belongs to another company; ask platform support to reset it");
    await this.db.transaction(async (tx) => {
      await tx.update(S.identities).set({ mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null }).where(eq(S.identities.id, user.identityId));
      await tx.update(S.refreshTokens).set({ revokedAt: new Date() }).where(and(eq(S.refreshTokens.identityId, user.identityId), isNull(S.refreshTokens.revokedAt)));
    });
    await TenantDb.audit(await this.tdb.for(ctx), ctx, "user.mfa_reset", "user", id);
    return this.one(tenantId, id);
  }
}
