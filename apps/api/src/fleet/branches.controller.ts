import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { routes, type Branch } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, notFound, uniqueViolation } from "../infra/errors.js";
import { TenantDb } from "./tenant-db.js";

const B = schema.branches;
const toBranch = (b: typeof B.$inferSelect): Branch => ({ id: b.id, code: b.code, name: b.name, timezone: b.timezone, weekendDays: b.weekendDays, status: b.status });

@Controller()
export class BranchesController {
  constructor(private readonly tdb: TenantDb) {}

  @Requires("branch.read") @Get(routes.listBranches.path)
  async list(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const rows = await db.select().from(B).where(filter ? inArray(B.id, [...filter]) : undefined).orderBy(asc(B.code));
    return { items: rows.map(toBranch) };
  }

  /** US-E03-01: the branch time zone drives "today" for its reports (GEN-010). */
  @Requires("branch.write") @Post(routes.createBranch.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createBranch.body)) b: z.output<typeof routes.createBranch.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx.insert(B).values({ id: b.id ?? newId(), code: b.code, name: b.name, timezone: b.timezone, weekendDays: b.weekendDays }).returning();
        await TenantDb.audit(tx, ctx, "branch.created", "branch", row!.id, toBranch(row!), null, row!.id);
        return toBranch(row!);
      });
    } catch (e) {
      if (uniqueViolation(e)) throw conflict("duplicate", "A branch with this code already exists", { code: "taken" });
      throw e;
    }
  }

  @Requires("branch.write") @Patch(routes.updateBranch.path)
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateBranch.body)) b: z.output<typeof routes.updateBranch.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const [before] = await tx.select().from(B).where(eq(B.id, id)).for("update");
      if (!before) throw notFound("branch");
      const [row] = await tx.update(B).set({ ...b, updatedAt: new Date() }).where(eq(B.id, id)).returning();
      await TenantDb.audit(tx, ctx, "branch.updated", "branch", id, toBranch(row!), toBranch(before), id);
      return toBranch(row!);
    });
  }
}
