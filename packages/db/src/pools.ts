import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";
import { SecretBox } from "./crypto.js";

export type Db = NodePgDatabase<typeof schema>;
export interface TenantConn { tenantId: string; pool: pg.Pool; db: Db }

/** Pool for the control plane DB. */
export function controlDb(url: string): { pool: pg.Pool; db: Db } {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { pool, db: drizzle(pool, { schema }) };
}

/**
 * Per-tenant connection pools, created on demand with the tenant's own DB role
 * and kept in a small LRU (Architecture §6.2). A tenant's role can only connect
 * to its own database, so a routing bug cannot read another company's data.
 */
export class TenantPools {
  private readonly cache = new Map<string, Promise<TenantConn>>();
  constructor(
    private readonly control: Db,
    private readonly secrets: SecretBox,
    private readonly maxTenants = 50,
    private readonly perTenantMax = 5,
  ) {}

  get(tenantId: string): Promise<TenantConn> {
    const hit = this.cache.get(tenantId);
    if (hit) {
      this.cache.delete(tenantId); // refresh LRU position
      this.cache.set(tenantId, hit);
      return hit;
    }
    const p = this.open(tenantId).catch((e) => {
      this.cache.delete(tenantId);
      throw e;
    });
    this.cache.set(tenantId, p);
    this.evict();
    return p;
  }

  private async open(tenantId: string): Promise<TenantConn> {
    const [loc] = await this.control.select().from(schema.tenantDbLocations).where(eq(schema.tenantDbLocations.tenantId, tenantId));
    if (!loc) throw new Error(`no database location for tenant ${tenantId}`);
    const pool = new pg.Pool({
      host: loc.host,
      port: loc.port,
      database: loc.dbName,
      user: loc.dbRole,
      password: this.secrets.open(loc.dbPasswordEnc),
      max: this.perTenantMax,
      idleTimeoutMillis: 30_000,
    });
    return { tenantId, pool, db: drizzle(pool, { schema }) };
  }

  private evict() {
    while (this.cache.size > this.maxTenants) {
      const oldest = this.cache.keys().next().value as string;
      const p = this.cache.get(oldest)!;
      this.cache.delete(oldest);
      void p.then((c) => c.pool.end()).catch(() => {});
    }
  }

  /** Close and forget one tenant's pool (the company was deleted). */
  async forget(tenantId: string) {
    const p = this.cache.get(tenantId);
    this.cache.delete(tenantId);
    if (p) await p.then((c) => c.pool.end()).catch(() => {});
  }

  async closeAll() {
    const all = [...this.cache.values()];
    this.cache.clear();
    await Promise.allSettled(all.map(async (p) => (await p).pool.end()));
  }
}
