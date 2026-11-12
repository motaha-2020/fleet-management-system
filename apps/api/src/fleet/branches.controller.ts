import { Controller, Get } from "@nestjs/common";
import { asc, inArray } from "drizzle-orm";
import { routes } from "@fleet/contracts";
import { schema } from "@fleet/db";
import { branchFilter } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { TenantDb } from "./tenant-db.js";

@Controller()
export class BranchesController {
  constructor(private readonly tdb: TenantDb) {}

  @Requires("branch.read") @Get(routes.listBranches.path)
  async list(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    const q = db.select({ id: schema.branches.id, code: schema.branches.code, name: schema.branches.name }).from(schema.branches);
    const items = filter === null ? await q.orderBy(asc(schema.branches.code)) : filter.length ? await q.where(inArray(schema.branches.id, [...filter])).orderBy(asc(schema.branches.code)) : [];
    return { items };
  }
}
