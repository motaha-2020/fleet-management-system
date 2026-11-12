import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { routes } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { canAccessBranch } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { forbidden, notFound } from "../infra/errors.js";
import { TenantDb } from "../fleet/tenant-db.js";

const C = schema.consents;
type Row = typeof C.$inferSelect;
const dto = (c: Row) => ({ id: c.id, identityId: c.identityId, driverId: c.driverId, deviceId: c.deviceId, kind: c.kind, decision: c.decision, appVersion: c.appVersion, decidedAt: c.decidedAt.toISOString() });

/** PRV-002 / US-E19-04: the driver's decision on camera / photos / location, kept as history (append-only). */
@Controller()
export class ConsentsController {
  constructor(private readonly tdb: TenantDb) {}

  @Post(routes.recordConsent.path) @HttpCode(201)
  async record(@Body(new ZodPipe(routes.recordConsent.body)) b: z.output<typeof routes.recordConsent.body>, @Ctx() ctx: RequestContext) {
    if (ctx.role !== "driver") throw forbidden("Consent is recorded by the driver app");
    const db = await this.tdb.for(ctx);
    if (b.id) {
      const [existing] = await db.select().from(C).where(eq(C.id, b.id));
      if (existing) return dto(existing);
    }
    const [row] = await db.insert(C).values({
      id: b.id ?? newId(), identityId: ctx.identityId, driverId: ctx.driverId, deviceId: ctx.deviceId, kind: b.kind, decision: b.decision,
      appVersion: b.appVersion ?? null, decidedAt: new Date(b.decidedAt),
    }).returning();
    await TenantDb.audit(db, ctx, `consent.${b.decision}`, "driver", ctx.driverId ?? ctx.identityId, { kind: b.kind, decision: b.decision });
    return dto(row!);
  }

  @Requires("driver.read") @Get(routes.listConsents.path)
  async list(@Query(new ZodPipe(routes.listConsents.query)) q: z.output<typeof routes.listConsents.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const [d] = await db.select().from(schema.drivers).where(eq(schema.drivers.id, q.driverId));
    if (!d || (ctx.role === "driver" ? d.id !== ctx.driverId : !canAccessBranch(ctx, ctx.scope!, d.branchId))) throw notFound("driver");
    const rows = await db.select().from(C).where(eq(C.driverId, d.id)).orderBy(desc(C.decidedAt)).limit(200);
    return { items: rows.map(dto) };
  }
}
