import { Controller, Get, Inject, Query } from "@nestjs/common";
import { and, desc, eq, inArray, lt, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { routes } from "@fleet/contracts";
import { schema, type Db } from "@fleet/db";
import { branchFilter } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB } from "../infra/tokens.js";
import { TenantDb } from "../fleet/tenant-db.js";

const A = schema.auditLog;

/** RPT-007: read-only view of the append-only audit log. Fleet managers see events of their branches. */
@Controller()
export class AuditController {
  constructor(private readonly tdb: TenantDb, @Inject(CONTROL_DB) private readonly control: Db) {}

  @Requires("audit.read") @Get(routes.listAudit.path)
  async list(@Query(new ZodPipe(routes.listAudit.query)) q: z.output<typeof routes.listAudit.query>, @Ctx() ctx: RequestContext) {
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [], nextBefore: null };
    const where: SQL[] = [];
    if (filter) where.push(inArray(A.branchId, [...filter]));
    if (q.entityType) where.push(eq(A.entityType, q.entityType));
    if (q.entityId) where.push(eq(A.entityId, q.entityId));
    if (q.action) where.push(eq(A.action, q.action));
    if (q.before) where.push(lt(A.id, q.before));
    const db = await this.tdb.for(ctx);
    const rows = await db.select().from(A).where(and(...where)).orderBy(desc(A.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((x): x is string => !!x))];
    const names = actorIds.length
      ? new Map((await this.control.select({ id: schema.identities.id, name: schema.identities.displayName }).from(schema.identities)
          .where(inArray(schema.identities.id, actorIds))).map((r) => [r.id, r.name]))
      : new Map<string, string>();
    return {
      items: page.map((r) => ({
        id: r.id, at: r.at.toISOString(), actorId: r.actorId, actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
        action: r.action, entityType: r.entityType, entityId: r.entityId, before: r.before ?? null, after: r.after ?? null,
      })),
      nextBefore: rows.length > q.limit ? page[page.length - 1]!.id : null,
    };
  }
}
