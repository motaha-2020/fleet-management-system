import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { routes, type CompanyRole } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
import {
  ACTION_GROUPS, EDITABLE_SYSTEM_ROLES, RBAC_MATRIX, ROLE_LABELS, sanitizeOfficePermissions,
  type EditableSystemRole, type Permissions,
} from "@fleet/config";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB } from "../infra/tokens.js";
import { conflict, notFound, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { PermissionService } from "../auth/permissions.service.js";

const S = schema;
type RoleRow = typeof S.roles.$inferSelect;
const isSystemKey = (id: string): id is EditableSystemRole => (EDITABLE_SYSTEM_ROLES as readonly string[]).includes(id);
const samePermissions = (a: Permissions, b: Permissions) => {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k as keyof Permissions] === b[k as keyof Permissions]);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owner decision (14 Nov 2026): the company admin decides what each office role may do, and makes roles of their
 * own. Locked: the company admin role (always everything, so the company can never lock itself out), the driver
 * role (separate sign-in), and managing people and permissions (company admin only).
 */
@Controller()
export class RolesController {
  constructor(@Inject(CONTROL_DB) private readonly db: Db, private readonly tdb: TenantDb, private readonly perms: PermissionService) {}

  private async members(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.db.select({ role: S.memberships.role, roleId: S.memberships.roleId, n: sql<number>`count(*)::int` }).from(S.memberships)
      .where(and(eq(S.memberships.tenantId, tenantId), eq(S.memberships.active, true)))
      .groupBy(S.memberships.role, S.memberships.roleId);
    return new Map(rows.map((r) => [r.roleId ?? r.role, r.n]));
  }

  private async permsOf(db: Db | Tx, roleId: string): Promise<Permissions> {
    const rows = await db.select().from(S.rolePermissions).where(eq(S.rolePermissions.roleId, roleId));
    return sanitizeOfficePermissions(Object.fromEntries(rows.map((r) => [r.action, r.scope])));
  }

  private async all(ctx: RequestContext): Promise<CompanyRole[]> {
    const db = await this.tdb.for(ctx);
    const rows = await db.select().from(S.roles).orderBy(S.roles.createdAt);
    const counts = await this.members(tenantOf(ctx));
    const fixed = (key: "company_admin" | "driver"): CompanyRole => ({
      id: key, kind: "system", key, nameAr: ROLE_LABELS[key].ar, nameEn: ROLE_LABELS[key].en, status: "active",
      locked: true, customized: false, permissions: RBAC_MATRIX[key], members: counts.get(key) ?? 0,
    });
    const out: CompanyRole[] = [fixed("company_admin")];
    for (const key of EDITABLE_SYSTEM_ROLES) {
      const row = rows.find((r) => r.key === key);
      const permissions = row ? await this.permsOf(db, row.id) : RBAC_MATRIX[key];
      out.push({
        id: key, kind: "system", key, nameAr: ROLE_LABELS[key].ar, nameEn: ROLE_LABELS[key].en, status: "active", locked: false,
        customized: !samePermissions(permissions, RBAC_MATRIX[key]), permissions, members: counts.get(key) ?? 0,
      });
    }
    for (const row of rows.filter((r) => !r.key)) out.push(await this.dtoCustom(db, row, counts));
    out.push(fixed("driver"));
    return out;
  }

  private async dtoCustom(db: Db | Tx, row: RoleRow, counts?: Map<string, number>): Promise<CompanyRole> {
    return {
      id: row.id, kind: "custom", key: null, nameAr: row.nameAr, nameEn: row.nameEn, status: row.status, locked: false, customized: true,
      permissions: await this.permsOf(db, row.id), members: counts?.get(row.id) ?? 0,
    };
  }

  private async one(ctx: RequestContext, id: string): Promise<CompanyRole> {
    const r = (await this.all(ctx)).find((x) => x.id === id);
    if (!r) throw notFound("role");
    return r;
  }

  private async writePermissions(tx: Tx, roleId: string, p: Permissions) {
    await tx.delete(S.rolePermissions).where(eq(S.rolePermissions.roleId, roleId));
    const rows = Object.entries(sanitizeOfficePermissions(p)).map(([action, scope]) => ({ roleId, action, scope: scope as "all" | "branches" }));
    if (rows.length) await tx.insert(S.rolePermissions).values(rows);
  }

  @Requires("role.manage") @Get(routes.listRoles.path)
  async list(@Ctx() ctx: RequestContext) {
    return { items: await this.all(ctx), groups: ACTION_GROUPS.map((g) => ({ key: g.key, actions: [...g.actions] })) };
  }

  @Requires("role.manage") @Post(routes.createRole.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createRole.body)) b: z.output<typeof routes.createRole.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const id = newId();
    await db.transaction(async (tx) => {
      await this.assertNameFree(tx, b.nameAr, b.nameEn);
      await tx.insert(S.roles).values({ id, key: null, nameAr: b.nameAr, nameEn: b.nameEn, createdBy: ctx.identityId });
      await this.writePermissions(tx, id, b.permissions);
      await TenantDb.audit(tx, ctx, "role.created", "role", id, { nameAr: b.nameAr, nameEn: b.nameEn, permissions: sanitizeOfficePermissions(b.permissions) });
    });
    this.perms.invalidate(tenantOf(ctx));
    return this.one(ctx, id);
  }

  @Requires("role.manage") @Patch(routes.updateRole.path)
  async update(@Param("id") id: string, @Body(new ZodPipe(routes.updateRole.body)) b: z.output<typeof routes.updateRole.body>, @Ctx() ctx: RequestContext) {
    if (id === "company_admin" || id === "driver") throw conflict("role_locked", "This role is fixed and cannot be changed");
    const before = await this.one(ctx, id);
    const db = await this.tdb.for(ctx);
    await db.transaction(async (tx) => {
      if (isSystemKey(id)) {
        // Built-in roles keep their names and stay on; only what they may do changes.
        if (b.nameAr || b.nameEn || b.status) throw validation({ role: "system_role_permissions_only" });
        if (!b.permissions) return;
        let [row] = await tx.select().from(S.roles).where(eq(S.roles.key, id));
        if (!row) [row] = await tx.insert(S.roles).values({ id: newId(), key: id, nameAr: ROLE_LABELS[id].ar, nameEn: ROLE_LABELS[id].en, createdBy: ctx.identityId }).returning();
        await this.writePermissions(tx, row!.id, b.permissions);
        await tx.update(S.roles).set({ updatedAt: new Date() }).where(eq(S.roles.id, row!.id));
      } else {
        if (!UUID.test(id)) throw notFound("role");
        const [row] = await tx.select().from(S.roles).where(and(eq(S.roles.id, id), sql`${S.roles.key} IS NULL`)).for("update");
        if (!row) throw notFound("role");
        if (b.nameAr || b.nameEn) await this.assertNameFree(tx, b.nameAr ?? row.nameAr, b.nameEn ?? row.nameEn, id);
        await tx.update(S.roles).set({ nameAr: b.nameAr ?? row.nameAr, nameEn: b.nameEn ?? row.nameEn, status: b.status ?? row.status, updatedAt: new Date() }).where(eq(S.roles.id, id));
        if (b.permissions) await this.writePermissions(tx, id, b.permissions);
      }
      const after = { nameAr: b.nameAr ?? before.nameAr, nameEn: b.nameEn ?? before.nameEn, status: b.status ?? before.status, permissions: b.permissions ? sanitizeOfficePermissions(b.permissions) : before.permissions };
      await TenantDb.audit(tx, ctx, "role.updated", "role", id, after, { nameAr: before.nameAr, nameEn: before.nameEn, status: before.status, permissions: before.permissions });
    });
    this.perms.invalidate(tenantOf(ctx));
    return this.one(ctx, id);
  }

  @Requires("role.manage") @Post(routes.resetRole.path) @HttpCode(200)
  async reset(@Param("id") id: string, @Ctx() ctx: RequestContext) {
    if (!isSystemKey(id)) throw validation({ role: "only_builtin_roles_reset" });
    const before = await this.one(ctx, id);
    const db = await this.tdb.for(ctx);
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(S.roles).where(eq(S.roles.key, id));
      if (!row) return;
      // Roles are never deleted: the saved set is simply put back to the built-in default.
      await this.writePermissions(tx, row.id, RBAC_MATRIX[id]);
      await tx.update(S.roles).set({ updatedAt: new Date() }).where(eq(S.roles.id, row.id));
      await TenantDb.audit(tx, ctx, "role.reset", "role", id, { permissions: RBAC_MATRIX[id] }, { permissions: before.permissions });
    });
    this.perms.invalidate(tenantOf(ctx));
    return this.one(ctx, id);
  }

  private async assertNameFree(tx: Tx, nameAr: string, nameEn: string, except?: string) {
    const taken = [...EDITABLE_SYSTEM_ROLES, "company_admin" as const, "driver" as const]
      .some((k) => ROLE_LABELS[k].ar === nameAr.trim() || ROLE_LABELS[k].en.toLowerCase() === nameEn.trim().toLowerCase());
    const [dup] = await tx.select({ id: S.roles.id }).from(S.roles)
      .where(and(sql`${S.roles.key} IS NULL`, sql`(${S.roles.nameAr} = ${nameAr.trim()} OR lower(${S.roles.nameEn}) = ${nameEn.trim().toLowerCase()})`, except ? sql`${S.roles.id} <> ${except}` : undefined));
    if (taken || dup) throw conflict("role_name_taken", "A role with this name already exists", { nameAr: "taken" });
  }
}
