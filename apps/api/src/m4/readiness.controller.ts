import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULTS, READINESS_RULES, type ReadinessRuleCode } from "@fleet/config";
import { routes } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, canAccessBranch, checkOverride, checkRuleSetting } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { driverVehicleIds, iso, loadVehicle, type DbOrTx } from "../m2/common.js";
import { ReadinessService, readinessDto } from "./readiness.service.js";

const O = schema.readinessOverrides;
type OverrideRow = typeof O.$inferSelect;
const RULES = new Map(READINESS_RULES.map((r) => [r.code as string, r]));

const toOverride = (o: OverrideRow, now = Date.now()) => ({
  id: o.id, ruleCode: o.ruleCode, entityType: o.entityType, entityId: o.entityId, subject: o.subject, risk: o.risk, reason: o.reason,
  expiresAt: o.expiresAt.toISOString(), createdBy: o.createdBy, createdAt: o.createdAt.toISOString(), revokedAt: iso(o.revokedAt),
  active: !o.revokedAt && o.expiresAt.getTime() > now,
});

/** E12 operational readiness: evaluation (US-E12-02/03), company risk settings (US-E12-01), overrides (US-E12-04). */
@Controller()
export class ReadinessController {
  constructor(private readonly tdb: TenantDb, private readonly readiness: ReadinessService) {}

  private async driverInScope(db: DbOrTx, ctx: RequestContext, id: string) {
    const [d] = await db.select().from(schema.drivers).where(eq(schema.drivers.id, id));
    if (!d) throw notFound("driver");
    if (ctx.role === "driver" ? d.id !== ctx.driverId : !canAccessBranch(ctx, ctx.scope!, d.branchId)) throw notFound("driver");
    return d;
  }

  @Requires("readiness.read") @Get(routes.readiness.path)
  async evaluate(@Query(new ZodPipe(routes.readiness.query)) q: z.output<typeof routes.readiness.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const driverId = q.driverId ?? (ctx.role === "driver" ? ctx.driverId : undefined);
    if (!q.vehicleId && !driverId) throw validation({ vehicleId: "required" });
    const vehicle = q.vehicleId ? await loadVehicle(db, ctx, q.vehicleId) : undefined;
    const driver = driverId ? await this.driverInScope(db, ctx, driverId) : undefined;
    const at = new Date();
    return readinessDto(await this.readiness.evaluate(db, { vehicle, driver }, at), at);
  }

  @Requires("readiness.read") @Get(routes.vehiclesReadiness.path)
  async vehicles(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const V = schema.vehicles;
    let vehicles;
    if (ctx.role === "driver") {
      const ids = await driverVehicleIds(db, ctx.driverId);
      vehicles = ids.length ? await db.select().from(V).where(and(inArray(V.id, ids), eq(V.status, "active"))) : [];
    } else {
      const filter = branchFilter(ctx, ctx.scope!);
      if (filter && !filter.length) return { items: [] };
      const where: SQL[] = [inArray(V.status, ["active", "inactive"])];
      if (filter) where.push(inArray(V.branchId, [...filter]));
      vehicles = await db.select().from(V).where(and(...where));
    }
    const rs = await this.readiness.evaluateMany(db, vehicles.map((vehicle) => ({ vehicle })));
    return {
      items: vehicles.map((v, i) => ({ vehicleId: v.id, outcome: rs[i]!.outcome, codes: [...new Set(rs[i]!.reasons.filter((r) => r.outcome !== "allowed").map((r) => r.code))] })),
    };
  }

  private async ruleDto(db: DbOrTx, code: string) {
    const rule = RULES.get(code)!;
    const settings = await this.readiness.settings(db);
    return { code: rule.code, dimension: rule.dimension, name: rule.name, defaultRisk: rule.risk, companyRisk: settings[code as ReadinessRuleCode] ?? null, configurable: rule.risk !== "document_type" && rule.risk !== "R4" };
  }

  @Requires("readiness.read") @Get(routes.readinessRules.path)
  async rules(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return { items: await Promise.all(READINESS_RULES.map((r) => this.ruleDto(db, r.code))) };
  }

  /** US-E12-01 / GEN-008: a company may raise a rule's risk, never lower it below the catalog. */
  @Requires("readiness.configure") @Post(routes.setReadinessRule.path) @HttpCode(200)
  async setRule(@Param("code") code: string, @Body(new ZodPipe(routes.setReadinessRule.body)) b: z.output<typeof routes.setReadinessRule.body>, @Ctx() ctx: RequestContext) {
    if (!RULES.has(code)) throw notFound("rule");
    const err = checkRuleSetting(code as ReadinessRuleCode, b.risk);
    if (err) throw validation({ risk: err });
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const S = schema.readinessRuleSettings;
      const before = await this.ruleDto(tx, code);
      await tx.insert(S).values({ ruleCode: code, risk: b.risk, updatedBy: ctx.identityId })
        .onConflictDoUpdate({ target: S.ruleCode, set: { risk: b.risk, updatedBy: ctx.identityId, updatedAt: new Date() } });
      const [company] = await tx.select({ id: schema.company.id }).from(schema.company).limit(1);
      await TenantDb.audit(tx, ctx, "readiness.rule_set", "company", company!.id, { rule: code, risk: b.risk }, { rule: code, risk: before.companyRisk });
      return this.ruleDto(tx, code);
    });
  }

  @Requires("readiness.read") @Get(routes.listOverrides.path)
  async listOverrides(@Query(new ZodPipe(routes.listOverrides.query)) q: z.output<typeof routes.listOverrides.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const where: SQL[] = [];
    if (filter) where.push(inArray(O.branchId, [...filter]));
    if (q.entityType) where.push(eq(O.entityType, q.entityType));
    if (q.entityId) where.push(eq(O.entityId, q.entityId));
    const rows = await db.select().from(O).where(and(...where)).orderBy(desc(O.createdAt)).limit(500);
    return { items: rows.map((o) => toOverride(o)) };
  }

  /**
   * US-E12-04 / OPS-005: override a current R2/R3 finding for one vehicle or driver, with reason and expiry
   * (at most D-READINESS-OVERRIDE days). R4 is never overridden.
   */
  @Requires("readiness.override") @Post(routes.createOverride.path) @HttpCode(201)
  async createOverride(@Body(new ZodPipe(routes.createOverride.body)) b: z.output<typeof routes.createOverride.body>, @Ctx() ctx: RequestContext) {
    if (!RULES.has(b.ruleCode)) throw validation({ ruleCode: "unknown_rule" });
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const vehicle = b.entityType === "vehicle" ? await loadVehicle(tx, ctx, b.entityId, { lock: true }) : undefined;
      const driver = b.entityType === "driver" ? await this.driverInScope(tx, ctx, b.entityId) : undefined;
      const now = new Date();
      const r = await this.readiness.evaluate(tx, { vehicle, driver }, now);
      const subject = b.subject ?? null;
      const finding = r.reasons.find((x) => x.code === b.ruleCode && x.entityId === b.entityId && x.subject === subject);
      if (!finding) throw validation({ ruleCode: "no_current_finding" });
      const err = checkOverride(finding.risk, Date.parse(b.expiresAt), now.getTime(), DEFAULTS.READINESS_OVERRIDE_MAX_DAYS);
      if (err === "r4_no_override") throw forbidden("Legal/safety (R4) restrictions cannot be overridden");
      if (err) throw validation(err === "nothing_to_override" ? { ruleCode: err } : { expiresAt: err });
      if (finding.overrideId) throw conflict("already_overridden", "An active override exists for this finding");
      const [row] = await tx.insert(O).values({
        id: newId(), ruleCode: b.ruleCode, entityType: b.entityType, entityId: b.entityId, subject, risk: finding.risk as "R2" | "R3", reason: b.reason,
        expiresAt: new Date(b.expiresAt), branchId: (vehicle ?? driver)!.branchId, createdBy: ctx.identityId,
      }).returning();
      await TenantDb.audit(tx, ctx, "readiness.overridden", b.entityType, b.entityId, toOverride(row!), null, row!.branchId);
      return toOverride(row!);
    });
  }

  @Requires("readiness.override") @Post(routes.revokeOverride.path) @HttpCode(200)
  async revoke(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const [o] = await tx.select().from(O).where(eq(O.id, id)).for("update");
      if (!o || !canAccessBranch(ctx, ctx.scope!, o.branchId)) throw notFound("override");
      if (o.revokedAt) return toOverride(o);
      const [row] = await tx.update(O).set({ revokedAt: new Date(), revokedBy: ctx.identityId }).where(eq(O.id, id)).returning();
      await TenantDb.audit(tx, ctx, "readiness.override_revoked", o.entityType, o.entityId, { overrideId: id }, null, o.branchId);
      return toOverride(row!);
    });
  }
}
