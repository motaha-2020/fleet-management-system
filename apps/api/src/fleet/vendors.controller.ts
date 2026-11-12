import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { routes, type Vendor } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, forbidden, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantDb } from "./tenant-db.js";

const V = schema.vendors;
const toVendor = (v: typeof V.$inferSelect): Vendor => ({
  id: v.id, name: v.name, type: v.type, contactName: v.contactName, phone: v.phone, email: v.email, taxId: v.taxId, branchIds: v.branchIds, status: v.status,
});

/**
 * VND-001..003. A vendor covers all branches (empty list) or specific ones. Branch-scoped users see
 * vendors covering any of their branches, and may only set coverage within their own branches.
 * Deactivating hides a vendor from pickers (default list) while history keeps referencing it.
 */
@Controller()
export class VendorsController {
  constructor(private readonly tdb: TenantDb) {}

  private visible(ctx: RequestContext, scope = ctx.scope!): SQL | undefined {
    const filter = branchFilter(ctx, scope);
    if (!filter) return undefined;
    return sql`(cardinality(${V.branchIds}) = 0 OR ${V.branchIds} && ${sql`ARRAY[${sql.join(filter.map((f) => sql`${f}::uuid`), sql`, `)}]::uuid[]`})`;
  }

  private checkCoverage(ctx: RequestContext, branchIds: readonly string[]) {
    const filter = branchFilter(ctx, ctx.scope!);
    if (!filter) return;
    if (!branchIds.length || branchIds.some((b) => !filter.includes(b))) throw forbidden("You can only add vendors for your own branches");
  }

  @Requires("vendor.read") @Get(routes.listVendors.path)
  async list(@Query(new ZodPipe(routes.listVendors.query)) q: z.output<typeof routes.listVendors.query>, @Ctx() ctx: RequestContext) {
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const db = await this.tdb.for(ctx);
    const rows = await db.select().from(V).where(and(this.visible(ctx), q.includeInactive === "true" ? undefined : eq(V.status, "active"))).orderBy(asc(V.name));
    return { items: rows.map(toVendor) };
  }

  @Requires("vendor.write") @Post(routes.createVendor.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createVendor.body)) b: z.output<typeof routes.createVendor.body>, @Ctx() ctx: RequestContext) {
    this.checkCoverage(ctx, b.branchIds);
    const db = await this.tdb.for(ctx);
    await this.assertBranchesExist(db, b.branchIds);
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx.insert(V).values({
          id: b.id ?? newId(), name: b.name, type: b.type, contactName: b.contactName ?? null, phone: b.phone ?? null,
          email: b.email ?? null, taxId: b.taxId ?? null, branchIds: b.branchIds, createdBy: ctx.identityId,
        }).returning();
        await TenantDb.audit(tx, ctx, "vendor.created", "vendor", row!.id, toVendor(row!));
        return toVendor(row!);
      });
    } catch (e) {
      if (uniqueViolation(e)) throw conflict("duplicate", "An active vendor with this name and type already exists", { name: "taken" });
      throw e;
    }
  }

  @Requires("vendor.write") @Patch(routes.updateVendor.path)
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateVendor.body)) b: z.output<typeof routes.updateVendor.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    if (b.branchIds) {
      this.checkCoverage(ctx, b.branchIds);
      await this.assertBranchesExist(db, b.branchIds);
    }
    try {
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(V).where(and(eq(V.id, id), this.visible(ctx))).for("update");
        if (!before) throw notFound("vendor");
        // A branch-scoped user may not edit a tenant-wide vendor (it would affect other branches).
        if (branchFilter(ctx, ctx.scope!) && !before.branchIds.length) throw forbidden("Only company-wide roles can edit this vendor");
        const [row] = await tx.update(V).set({ ...b, updatedAt: new Date() }).where(eq(V.id, id)).returning();
        await TenantDb.audit(tx, ctx, b.status === "inactive" ? "vendor.deactivated" : "vendor.updated", "vendor", id, toVendor(row!), toVendor(before));
        return toVendor(row!);
      });
    } catch (e) {
      if (uniqueViolation(e)) throw conflict("duplicate", "An active vendor with this name and type already exists", { name: "taken" });
      throw e;
    }
  }

  private async assertBranchesExist(db: Awaited<ReturnType<TenantDb["for"]>>, ids: readonly string[]) {
    if (!ids.length) return;
    const rows = await db.select({ id: schema.branches.id }).from(schema.branches).where(sql`${schema.branches.id} = ANY(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}]::uuid[]`})`);
    if (rows.length !== new Set(ids).size) throw validation({ branchIds: "unknown_branch" });
  }
}
