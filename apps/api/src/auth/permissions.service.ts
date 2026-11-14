import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { schema, TenantPools } from "@fleet/db";
import { RBAC_MATRIX, sanitizeOfficePermissions, type Permissions, type Role } from "@fleet/config";
import { TENANT_POOLS } from "../infra/tokens.js";

export interface RoleInfo { nameAr: string; nameEn: string; active: boolean }

const TTL_MS = 15_000;

/**
 * Owner decision (14 Nov 2026): each company sets what its office roles may do. This resolves a person's current
 * role to its permissions on every request:
 *  - platform admin, company admin, driver, support: fixed (packages/config), never editable;
 *  - fleet manager, finance: the company's saved version, else the built-in default;
 *  - a custom role: what the company saved for it, nothing if it was switched off.
 * Results are cached for a few seconds per company; saving a role clears that company's cache at once.
 */
@Injectable()
export class PermissionService {
  private cache = new Map<string, { at: number; value: { permissions: Permissions; info: RoleInfo | null } }>();

  constructor(@Inject(TENANT_POOLS) private readonly pools: TenantPools) {}

  invalidate(tenantId: string) {
    for (const k of this.cache.keys()) if (k.startsWith(`${tenantId}:`)) this.cache.delete(k);
  }

  async resolve(tenantId: string | null, role: Role, roleId: string | null): Promise<{ permissions: Permissions; info: RoleInfo | null }> {
    if (!tenantId || role === "platform_admin" || role === "company_admin" || role === "driver" || role === "support") {
      return { permissions: RBAC_MATRIX[role], info: null };
    }
    const key = `${tenantId}:${role === "custom" ? roleId : role}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await this.load(tenantId, role, roleId);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async load(tenantId: string, role: Role, roleId: string | null) {
    const { db } = await this.pools.get(tenantId);
    const S = schema;
    const [row] = role === "custom"
      ? (roleId ? await db.select().from(S.roles).where(eq(S.roles.id, roleId)) : [])
      : await db.select().from(S.roles).where(eq(S.roles.key, role as "fleet_manager"));
    if (!row) return { permissions: role === "custom" ? {} : RBAC_MATRIX[role], info: null };
    const info = { nameAr: row.nameAr, nameEn: row.nameEn, active: row.status === "active" };
    if (role === "custom" && !info.active) return { permissions: {}, info };
    const rows = await db.select().from(S.rolePermissions).where(eq(S.rolePermissions.roleId, row.id));
    const permissions = sanitizeOfficePermissions(Object.fromEntries(rows.map((r) => [r.action, r.scope])));
    // Built-in roles keep their own (translated) names; only custom roles carry a company-chosen name.
    return { permissions, info: role === "custom" ? info : null };
  }
}
