import { Inject, Injectable } from "@nestjs/common";
import { TenantPools, schema, type Db } from "@fleet/db";
import { TENANT_POOLS } from "../infra/tokens.js";
import { tenantOf, type RequestContext } from "../auth/context.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Hands out the tenant DB for the authenticated request; the tenant comes only from the context. */
@Injectable()
export class TenantDb {
  constructor(@Inject(TENANT_POOLS) private readonly pools: TenantPools) {}

  async for(ctx: RequestContext): Promise<Db> {
    return (await this.pools.get(tenantOf(ctx))).db;
  }

  /** SEC-011: append-only audit entry, written in the same transaction as the change. */
  static audit(tx: Tx | Db, ctx: RequestContext, action: string, entityType: string, entityId: string, after?: unknown, before?: unknown, branchId?: string | null) {
    return tx.insert(schema.auditLog).values({ actorId: ctx.identityId, action, entityType, entityId, after: after ?? null, before: before ?? null, branchId: branchId ?? null });
  }
}
export type { Tx };
