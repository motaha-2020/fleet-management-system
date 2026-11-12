import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { COUNTRY_TEMPLATES } from "@fleet/config";
import { routes, type Tenant } from "@fleet/contracts";
import { schema, newId, sha256, randomToken, JOBS, type Db, type ProvisionTenantJob } from "@fleet/db";
import { CONTROL_DB, QUEUE } from "../infra/tokens.js";
import type { JobQueue } from "../infra/infra.module.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";

const S = schema;
const INVITE_TTL_MS = 7 * 24 * 3600_000;

@Controller()
export class TenantsController {
  constructor(@Inject(CONTROL_DB) private readonly db: Db, @Inject(QUEUE) private readonly queue: JobQueue) {}

  @Requires("tenant.manage") @Get(routes.listTenants.path)
  async list() {
    const rows = await this.db.select({ t: S.tenants, v: S.tenantDbLocations.schemaVersion }).from(S.tenants)
      .leftJoin(S.tenantDbLocations, eq(S.tenantDbLocations.tenantId, S.tenants.id)).orderBy(desc(S.tenants.createdAt));
    return { items: rows.map((r) => toTenant(r.t, r.v)) };
  }

  @Requires("tenant.manage") @Get(routes.getTenant.path)
  async get(@Param("id", ParseUUIDPipe) id: string) {
    const [r] = await this.db.select({ t: S.tenants, v: S.tenantDbLocations.schemaVersion }).from(S.tenants)
      .leftJoin(S.tenantDbLocations, eq(S.tenantDbLocations.tenantId, S.tenants.id)).where(eq(S.tenants.id, id));
    if (!r) throw notFound("tenant");
    return toTenant(r.t, r.v);
  }

  /**
   * TEN-001: records the tenant + its first Company Admin invite, then provisioning runs
   * in the worker. The tenant is not loginable until the worker marks it active.
   */
  @Requires("tenant.manage") @Post(routes.createTenant.path) @HttpCode(202)
  async create(@Body(new ZodPipe(routes.createTenant.body)) b: z.output<typeof routes.createTenant.body>, @Ctx() ctx: RequestContext) {
    if (!COUNTRY_TEMPLATES[b.countryCode]) throw validation({ countryCode: "no active country template" });
    const tenantId = newId();
    const inviteToken = randomToken(32);
    const email = b.adminEmail.toLowerCase();
    try {
      const tenant = await this.db.transaction(async (tx) => {
        const [t] = await tx.insert(S.tenants).values({ id: tenantId, slug: b.slug, name: b.name, countryCode: b.countryCode, homeRegion: "eu-central", status: "provisioning" }).returning();
        let [identity] = await tx.select().from(S.identities).where(eq(S.identities.email, email));
        if (!identity) [identity] = await tx.insert(S.identities).values({ id: newId(), email, displayName: b.adminName }).returning();
        await tx.insert(S.memberships).values({ id: newId(), identityId: identity!.id, tenantId, role: "company_admin" });
        await tx.insert(S.invites).values({ id: newId(), identityId: identity!.id, tokenHash: sha256(inviteToken), expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
        await tx.insert(S.platformAudit).values({ actorId: ctx.identityId, tenantId, action: "tenant.created", detail: { slug: b.slug, adminEmail: email } });
        return t!;
      });
      const job: ProvisionTenantJob = { tenantId };
      await this.queue.send(JOBS.provisionTenant, job, { singletonKey: tenantId });
      return { tenant: toTenant(tenant, null), adminInviteToken: inviteToken };
    } catch (e) {
      if (uniqueViolation(e) === "tenants_slug_key") throw conflict("slug_taken", "This company code is already used", { slug: "taken" });
      throw e;
    }
  }

  /** TEN-004: Suspended = read-only for every user of the company (enforced by AuthGuard). */
  @Requires("tenant.manage") @Post(routes.suspendTenant.path) @HttpCode(200)
  suspend(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    return this.setStatus(id, "active", "suspended", ctx);
  }

  @Requires("tenant.manage") @Post(routes.reactivateTenant.path) @HttpCode(200)
  reactivate(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    return this.setStatus(id, "suspended", "active", ctx);
  }

  private async setStatus(id: string, from: "active" | "suspended", to: "active" | "suspended", ctx: RequestContext) {
    const [t] = await this.db.update(S.tenants).set({ status: to, updatedAt: new Date() })
      .where(and(eq(S.tenants.id, id), eq(S.tenants.status, from))).returning();
    if (!t) {
      const [exists] = await this.db.select({ id: S.tenants.id }).from(S.tenants).where(eq(S.tenants.id, id));
      if (!exists) throw notFound("tenant");
      throw conflict("invalid_status", `Only ${from} companies can be ${to === "suspended" ? "suspended" : "reactivated"}`);
    }
    await this.db.insert(S.platformAudit).values({ actorId: ctx.identityId, tenantId: id, action: to === "suspended" ? "tenant.suspended" : "tenant.reactivated" });
    return this.get(id);
  }

  /** Retry a failed provisioning (steps are idempotent). */
  @Requires("tenant.manage") @Post("/platform/tenants/:id/retry") @HttpCode(202)
  async retry(@Param("id", ParseUUIDPipe) id: string) {
    const [t] = await this.db.select().from(S.tenants).where(eq(S.tenants.id, id));
    if (!t) throw notFound("tenant");
    if (t.status !== "failed") throw conflict("not_failed", "Only failed tenants can be retried");
    await this.queue.send(JOBS.provisionTenant, { tenantId: id }, { singletonKey: id });
    return { ok: true as const };
  }
}


function toTenant(t: typeof S.tenants.$inferSelect, schemaVersion: number | null): Tenant {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    countryCode: t.countryCode,
    status: t.status,
    failureReason: t.failureReason,
    schemaVersion,
    createdAt: t.createdAt.toISOString(),
  };
}
