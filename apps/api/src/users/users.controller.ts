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
import { InviteMail } from "../auth/invite-mail.js";
import { AuthService } from "../auth/auth.service.js";
import { PermissionService } from "../auth/permissions.service.js";
import type { Role, StaffRole } from "@fleet/config";

const S = schema;
const INVITE_TTL_MS = 7 * 24 * 3600_000;

/** US-E02-03: company users (staff). Drivers are managed under /drivers. */
@Controller()
export class UsersController {
  constructor(@Inject(CONTROL_DB) private readonly db: Db, private readonly tdb: TenantDb, private readonly inviteMail: InviteMail, private readonly auth: AuthService, private readonly perms: PermissionService) {}

  private async load(tenantId: string, membershipId?: string): Promise<TenantUser[]> {
    const rows = await this.db.select({ m: S.memberships, i: S.identities }).from(S.memberships)
      .innerJoin(S.identities, eq(S.identities.id, S.memberships.identityId))
      .where(and(eq(S.memberships.tenantId, tenantId), ne(S.memberships.role, "driver"), membershipId ? eq(S.memberships.id, membershipId) : undefined))
      .orderBy(asc(S.identities.displayName));
    return Promise.all(rows.map(async ({ m, i }) => {
      const info = m.role === "custom" ? (await this.perms.resolve(tenantId, "custom", m.roleId)).info : null;
      return {
        membershipId: m.id, identityId: i.id, email: i.email, displayName: i.displayName, role: m.role as Role, roleId: m.roleId,
        roleName: info ? { ar: info.nameAr, en: info.nameEn } : null, branchIds: m.branchIds,
        active: m.active && !i.disabledAt, invitePending: !i.passwordHash,
      };
    }));
  }

  private async one(tenantId: string, membershipId: string) {
    const [u] = await this.load(tenantId, membershipId);
    if (!u) throw notFound("user");
    return u;
  }

  /** A custom role must exist in this company and be switched on. */
  private async assertRole(ctx: RequestContext, role: StaffRole, roleId: string | null | undefined): Promise<string | null> {
    if (role !== "custom") return null;
    if (!roleId) throw validation({ roleId: "required" });
    const db = await this.tdb.for(ctx);
    const [r] = await db.select().from(S.roles).where(and(eq(S.roles.id, roleId), isNull(S.roles.key)));
    if (!r || r.status !== "active") throw validation({ roleId: "unknown_role" });
    return r.id;
  }

  /** Branches belong to each role a person holds; the company admin always covers the whole company. */
  private static branchesFor(role: StaffRole, branchIds: readonly string[]) {
    return role === "company_admin" ? [] : [...branchIds];
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
    const branchIds = UsersController.branchesFor(b.role, b.branchIds);
    await this.assertBranches(ctx, b.role, branchIds);
    const roleId = await this.assertRole(ctx, b.role, b.roleId);
    const email = b.email.toLowerCase();
    let inviteToken: string | null = null;
    let invitee: { id: string; locale: "ar" | "en"; name: string } | null = null;
    const membershipId = newId();
    await this.db.transaction(async (tx) => {
      let [identity] = await tx.select().from(S.identities).where(eq(S.identities.email, email));
      if (!identity) [identity] = await tx.insert(S.identities).values({ id: newId(), email, displayName: b.displayName }).returning();
      if (identity!.isPlatformAdmin) throw conflict("platform_identity", "Platform administrators cannot be company users", { email: "taken" });
      const [existing] = await tx.select({ id: S.memberships.id }).from(S.memberships)
        .where(and(eq(S.memberships.identityId, identity!.id), eq(S.memberships.tenantId, tenantId), eq(S.memberships.role, b.role), roleId ? eq(S.memberships.roleId, roleId) : undefined));
      if (existing) throw conflict("already_member", "This person already has this role", { role: "taken" });
      await tx.insert(S.memberships).values({ id: membershipId, identityId: identity!.id, tenantId, role: b.role, roleId, branchIds });
      // People who already have a password just get the new role (role switcher); others get an invite.
      if (!identity!.passwordHash) {
        inviteToken = randomToken(32);
        await tx.update(S.invites).set({ usedAt: new Date() }).where(and(eq(S.invites.identityId, identity!.id), isNull(S.invites.usedAt)));
        await tx.insert(S.invites).values({ id: newId(), identityId: identity!.id, tenantId, tokenHash: sha256(inviteToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
        invitee = { id: identity!.id, locale: identity!.locale, name: identity!.displayName };
      }
    });
    if (inviteToken && invitee) {
      const i = invitee as { id: string; locale: "ar" | "en"; name: string };
      const [t] = await this.db.select({ name: S.tenants.name }).from(S.tenants).where(eq(S.tenants.id, tenantId));
      await this.inviteMail.send({ identityId: i.id, email, name: i.name, locale: i.locale }, inviteToken, t?.name ?? "", tenantId);
    }
    const user = await this.one(tenantId, membershipId);
    await TenantDb.audit(await this.tdb.for(ctx), ctx, "user.invited", "user", membershipId, { email, role: b.role, roleId, branchIds });
    return { user, inviteToken };
  }

  @Requires("user.manage") @Patch(routes.updateUser.path)
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateUser.body)) b: z.output<typeof routes.updateUser.body>, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const before = await this.one(tenantId, id);
    const role = (b.role ?? before.role) as StaffRole;
    const roleChanged = role !== before.role || (role === "custom" && b.roleId !== undefined && b.roleId !== before.roleId);
    if (id === ctx.membershipId && (b.active === false || roleChanged)) {
      throw conflict("self_change", "You cannot deactivate or change your own role");
    }
    const branchIds = UsersController.branchesFor(role, b.branchIds ?? before.branchIds);
    await this.assertBranches(ctx, role, branchIds);
    const roleId = await this.assertRole(ctx, role, role === "custom" ? (b.roleId ?? before.roleId) : null);

    await this.db.transaction(async (tx) => {
      // Lock the tenant's admin memberships so two admins cannot demote each other at once.
      await tx.execute(sql`SELECT id FROM memberships WHERE tenant_id = ${tenantId} AND role = 'company_admin' FOR UPDATE`);
      await tx.update(S.memberships).set({ role, roleId, branchIds, active: b.active ?? before.active, updatedAt: new Date() })
        .where(and(eq(S.memberships.id, id), eq(S.memberships.tenantId, tenantId)));
      const [{ admins }] = (await tx.select({ admins: sql<number>`count(*)::int` }).from(S.memberships)
        .where(and(eq(S.memberships.tenantId, tenantId), eq(S.memberships.role, "company_admin"), eq(S.memberships.active, true)))) as [{ admins: number }];
      if (admins < 1) throw conflict("last_admin", "The company needs at least one active company admin");
      if (b.active === false || roleChanged) {
        // SEC-006: revocation is immediate — existing sessions of this membership end now.
        await tx.update(S.refreshTokens).set({ revokedAt: new Date() }).where(and(eq(S.refreshTokens.membershipId, id), isNull(S.refreshTokens.revokedAt)));
      }
    }).catch((e: unknown) => {
      if (uniqueViolation(e)) throw conflict("already_member", "This person already has this role", { role: "taken" });
      throw e;
    });
    const after = await this.one(tenantId, id);
    await TenantDb.audit(await this.tdb.for(ctx), ctx, "user.updated", "user", id,
      { role: after.role, roleId: after.roleId, branchIds: after.branchIds, active: after.active }, { role: before.role, roleId: before.roleId, branchIds: before.branchIds, active: before.active });
    return after;
  }

  /**
   * A password reset link for a colleague who forgot theirs (works without email: the admin sends it); it is
   * also emailed when email works. A person who also belongs to another company is reset by platform support,
   * so one company cannot take over an account another company relies on.
   */
  @Requires("user.manage") @Post(routes.userResetLink.path) @HttpCode(200)
  async resetLink(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const user = await this.one(tenantId, id);
    const [{ others }] = (await this.db.select({ others: sql<number>`count(*)::int` }).from(S.memberships)
      .where(and(eq(S.memberships.identityId, user.identityId), ne(S.memberships.tenantId, tenantId)))) as [{ others: number }];
    if (others > 0) throw conflict("shared_identity", "This person also belongs to another company; ask platform support to reset it");
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, user.identityId));
    if (!identity || identity.disabledAt) throw notFound("user");
    const { link, expiresAt } = await this.auth.createResetLink(identity.id, ctx.identityId);
    const emailed = await this.auth.emailResetLink(identity, link, true);
    await TenantDb.audit(await this.tdb.for(ctx), ctx, "user.reset_link_created", "user", id, { emailed });
    return { link, expiresAt: expiresAt.toISOString(), emailed };
  }

  /**
   * Owner decision (14 Nov 2026): a colleague who forgot their password (or email) gets a temporary password from
   * the company admin; it must be changed right after signing in. Same limits as a reset link.
   */
  @Requires("user.manage") @Post(routes.userTempPassword.path) @HttpCode(200)
  async tempPassword(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const user = await this.one(tenantId, id);
    if (user.identityId === ctx.identityId) throw conflict("self_change", "Change your own password from My account");
    const [{ others }] = (await this.db.select({ others: sql<number>`count(*)::int` }).from(S.memberships)
      .where(and(eq(S.memberships.identityId, user.identityId), ne(S.memberships.tenantId, tenantId)))) as [{ others: number }];
    if (others > 0) throw conflict("shared_identity", "This person also belongs to another company; ask platform support to reset it");
    const r = await this.auth.setTemporaryPassword(user.identityId, ctx.identityId, tenantId);
    await TenantDb.audit(await this.tdb.for(ctx), ctx, "user.temporary_password_set", "user", id, {});
    return r;
  }

  /** A colleague who has not accepted yet (lost or expired email): a new link, emailed again; old links stop working. */
  @Requires("user.manage") @Post(routes.resendUserInvite.path) @HttpCode(200)
  async resendInvite(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const tenantId = tenantOf(ctx);
    const user = await this.one(tenantId, id);
    if (!user.invitePending) throw conflict("invite_accepted", "This person already accepted the invite; use a password reset link");
    if (!user.email) throw conflict("no_email", "This person has no email");
    const [identity] = await this.db.select().from(S.identities).where(eq(S.identities.id, user.identityId));
    const [t] = await this.db.select({ name: S.tenants.name }).from(S.tenants).where(eq(S.tenants.id, tenantId));
    const r = await this.inviteMail.reissue({ identityId: user.identityId, email: user.email!, name: user.displayName, locale: identity?.locale }, t?.name ?? "", tenantId);
    await TenantDb.audit(await this.tdb.for(ctx), ctx, "user.invite_resent", "user", id, { emailed: r.emailed });
    return r;
  }
}
