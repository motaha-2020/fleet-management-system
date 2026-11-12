import { Controller, Get, Inject, Query } from "@nestjs/common";
import { and, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { routes } from "@fleet/contracts";
import { schema, type Db } from "@fleet/db";
import { Requires } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB } from "../infra/tokens.js";

const O = schema.opsEvents;

/** NFR-008 / US-E19-02: what failed, for which company, and why — for the platform operator. */
@Controller()
export class OpsController {
  constructor(@Inject(CONTROL_DB) private readonly db: Db) {}

  private async names(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const rows = await this.db.select({ id: schema.tenants.id, n: schema.tenants.name }).from(schema.tenants).where(inArray(schema.tenants.id, list));
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  private where(q: z.output<typeof routes.opsEvents.query>, defaultMinutes: number): SQL[] {
    const w: SQL[] = [gte(O.at, new Date(Date.now() - (q.sinceMinutes ?? defaultMinutes) * 60_000))];
    if (q.kind) w.push(eq(O.kind, q.kind));
    if (q.tenantId) w.push(eq(O.tenantId, q.tenantId));
    return w;
  }

  @Requires("tenant.manage") @Get(routes.opsEvents.path)
  async list(@Query(new ZodPipe(routes.opsEvents.query)) q: z.output<typeof routes.opsEvents.query>) {
    const rows = await this.db.select().from(O).where(and(...this.where(q, 24 * 60))).orderBy(desc(O.at)).limit(500);
    const names = await this.names(rows.map((r) => r.tenantId));
    return { items: rows.map((r) => ({ id: r.id, at: r.at.toISOString(), tenantId: r.tenantId, tenantName: r.tenantId ? names.get(r.tenantId) ?? null : null, kind: r.kind, severity: r.severity, code: r.code, detail: r.detail })) };
  }

  @Requires("tenant.manage") @Get(routes.opsSummary.path)
  async summary(@Query(new ZodPipe(routes.opsSummary.query)) q: z.output<typeof routes.opsSummary.query>) {
    const window = q.sinceMinutes ?? 60;
    const rows = await this.db.select().from(O).where(and(...this.where(q, window))).orderBy(desc(O.at)).limit(10_000);
    const groups = new Map<string, { tenantId: string | null; kind: (typeof rows)[number]["kind"]; errors: number; warnings: number; lastAt: Date }>();
    for (const r of rows) {
      const k = `${r.tenantId}|${r.kind}`;
      const g = groups.get(k) ?? { tenantId: r.tenantId, kind: r.kind, errors: 0, warnings: 0, lastAt: r.at };
      if (r.severity === "error" || r.severity === "critical") g.errors++; else if (r.severity === "warning") g.warnings++;
      if (r.at > g.lastAt) g.lastAt = r.at;
      groups.set(k, g);
    }
    const names = await this.names([...groups.values()].map((g) => g.tenantId));
    const [backup] = await this.db.select().from(O).where(eq(O.kind, "backup")).orderBy(desc(O.at)).limit(1);
    return {
      windowMinutes: window,
      rows: [...groups.values()].sort((a, b) => b.errors - a.errors || b.lastAt.getTime() - a.lastAt.getTime())
        .map((g) => ({ ...g, tenantName: g.tenantId ? names.get(g.tenantId) ?? null : null, lastAt: g.lastAt.toISOString() })),
      lastBackup: backup ? { at: backup.at.toISOString(), code: backup.code, severity: backup.severity } : null,
    };
  }
}
