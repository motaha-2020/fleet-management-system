import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { routes, type Alert } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
import { branchFilter, canTransitionAlert } from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { CONTROL_DB } from "../infra/tokens.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { iso } from "../m2/common.js";
import { AlertService } from "./alert.service.js";

const A = schema.alerts;
type Row = typeof A.$inferSelect;

/** E13: alert list and lifecycle, the delivery log, and FUEL-015 budgets. */
@Controller()
export class AlertsController {
  constructor(private readonly tdb: TenantDb, private readonly alerts: AlertService, @Inject(CONTROL_DB) private readonly control: Db) {}

  private async names(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    if (!list.length) return new Map<string, string>();
    const rows = await this.control.select({ id: schema.identities.id, name: schema.identities.displayName }).from(schema.identities).where(inArray(schema.identities.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private dto(a: Row, names: Map<string, string>): Alert {
    return {
      id: a.id, type: a.type, severity: a.severity, status: a.status, escalated: a.escalated, level: a.level, entityType: a.entityType, entityId: a.entityId,
      branchId: a.branchId, subject: a.subject, params: a.params, ownerId: a.ownerId, ownerName: a.ownerId ? (names.get(a.ownerId) ?? null) : null,
      escalationOwnerId: a.escalationOwnerId, ownerFallback: a.ownerFallback, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(),
      acknowledgedAt: iso(a.acknowledgedAt), resolvedAt: iso(a.resolvedAt), resolution: a.resolution, resolutionNote: a.resolutionNote, closedAt: iso(a.closedAt),
    };
  }

  /** Office staff see alerts of their branches (and company-wide ones); a driver sees only alerts addressed to them. */
  private scopeWhere(ctx: RequestContext): SQL | undefined | null {
    if (ctx.scope === "own") return eq(A.ownerId, ctx.identityId);
    const filter = branchFilter(ctx, ctx.scope!);
    if (!filter) return undefined;
    if (!filter.length) return null;
    return or(inArray(A.branchId, [...filter]), isNull(A.branchId), eq(A.ownerId, ctx.identityId));
  }

  @Requires("alert.read") @Get(routes.listAlerts.path)
  async list(@Query(new ZodPipe(routes.listAlerts.query)) q: z.output<typeof routes.listAlerts.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const scope = this.scopeWhere(ctx);
    if (scope === null) return { items: [] };
    const where: SQL[] = scope ? [scope] : [];
    const status = q.status ?? "active";
    if (status === "active") where.push(inArray(A.status, ["open", "acknowledged", "in_progress"]));
    else if (status !== "all") where.push(eq(A.status, status));
    if (q.type) where.push(eq(A.type, q.type));
    if (q.entityId) where.push(eq(A.entityId, q.entityId));
    if (q.mine === "true") where.push(eq(A.ownerId, ctx.identityId));
    const rows = await db.select().from(A).where(and(...where)).orderBy(desc(A.createdAt)).limit(500);
    const names = await this.names(rows.map((r) => r.ownerId));
    return { items: rows.map((r) => this.dto(r, names)) };
  }

  /** ALR-002: acknowledge, start, resolve (manually, with a note) and close. A driver acknowledges their own notices. */
  @Requires("alert.read") @Post(routes.alertStatus.path) @HttpCode(200)
  async status(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.alertStatus.body)) b: z.output<typeof routes.alertStatus.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const [a] = await tx.select().from(A).where(eq(A.id, id)).for("update");
      const scope = this.scopeWhere(ctx);
      if (!a || scope === null) throw notFound("alert");
      if (ctx.role === "driver" ? a.ownerId !== ctx.identityId : !this.canSee(ctx, a)) throw notFound("alert");
      // Only people who manage alerts change them; anyone may acknowledge or close an alert addressed to them.
      const own = a.ownerId === ctx.identityId;
      const manager = ctx.role !== "driver" && !!ctx.permissions["alert.manage"];
      if (!manager && !(own && (b.status === "acknowledged" || b.status === "resolved" || b.status === "closed"))) throw forbidden();
      if (!canTransitionAlert(a.status, b.status)) throw conflict("invalid_transition", `A ${a.status} alert cannot become ${b.status}`);
      if (b.status === "resolved" && !b.note && a.type !== "defect_rejected" && a.type !== "record_rejected") throw validation({ note: "required" });
      const now = new Date();
      const set: Partial<typeof A.$inferInsert> = { status: b.status, updatedAt: now };
      if (b.status === "acknowledged") Object.assign(set, { acknowledgedAt: now, acknowledgedBy: ctx.identityId });
      if (b.status === "resolved") Object.assign(set, { resolvedAt: now, resolvedBy: ctx.identityId, resolution: "manual", resolutionNote: b.note ?? null });
      if (b.status === "closed") Object.assign(set, { closedAt: now, closedBy: ctx.identityId });
      const [row] = await tx.update(A).set(set).where(eq(A.id, id)).returning();
      await TenantDb.audit(tx, ctx, `alert.${b.status}`, "alert", id, { status: b.status, note: b.note ?? null }, { status: a.status }, a.branchId);
      return this.dto(row!, await this.names([row!.ownerId]));
    });
  }

  private canSee(ctx: RequestContext, a: Row) {
    const filter = branchFilter(ctx, ctx.scope!);
    return !filter || !a.branchId || filter.includes(a.branchId) || a.ownerId === ctx.identityId;
  }

  @Requires("alert.manage") @Post(routes.scanAlerts.path) @HttpCode(200)
  async scan(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return this.alerts.scan(db, tenantOf(ctx));
  }

  @Requires("notification.read") @Get(routes.listNotifications.path)
  async notifications(@Query(new ZodPipe(routes.listNotifications.query)) q: z.output<typeof routes.listNotifications.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const N = schema.notifications;
    const where: SQL[] = [];
    if (q.status) where.push(eq(N.status, q.status));
    if (q.alertId) where.push(eq(N.alertId, q.alertId));
    const rows = await db.select().from(N).where(and(...where)).orderBy(desc(N.createdAt)).limit(500);
    return {
      items: rows.map((n) => ({
        id: n.id, alertId: n.alertId, recipientId: n.recipientId, channel: n.channel, locale: n.locale, address: n.address, subject: n.subject, status: n.status,
        attempts: n.attempts, lastError: n.lastError, provider: n.provider, createdAt: n.createdAt.toISOString(), sentAt: iso(n.sentAt), readAt: iso(n.readAt),
      })),
    };
  }

  // ---------------------------------------------------------------- budgets (FUEL-015)

  @Requires("fuel.read") @Get(routes.listFuelBudgets.path)
  async budgets(@Query(new ZodPipe(routes.listFuelBudgets.query)) q: z.output<typeof routes.listFuelBudgets.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const month = q.month ?? new Date().toISOString().slice(0, 7);
    const filter = branchFilter(ctx, ctx.scope!);
    const vBranch = new Map((await db.select({ id: schema.vehicles.id, b: schema.vehicles.branchId }).from(schema.vehicles)).map((v) => [v.id, v.b]));
    const rows = (await this.alerts.budgetStatus(db, month)).filter((b) => {
      if (!filter) return true;
      const branch = b.branchId ?? (b.vehicleId ? vBranch.get(b.vehicleId) : null);
      return !!branch && filter.includes(branch);
    });
    return { items: rows.map((b) => ({ ...b, month })) };
  }

  @Requires("fuel_budget.manage") @Post(routes.setFuelBudget.path) @HttpCode(200)
  async setBudget(@Body(new ZodPipe(routes.setFuelBudget.body)) b: z.output<typeof routes.setFuelBudget.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const B = schema.fuelBudgets;
    if (b.scope === "branch" && !b.branchId) throw validation({ branchId: "required" });
    if (b.scope === "vehicle" && !b.vehicleId) throw validation({ vehicleId: "required" });
    const branchId = b.scope === "branch" ? b.branchId! : null;
    const vehicleId = b.scope === "vehicle" ? b.vehicleId! : null;
    if (branchId && !(await db.select({ id: schema.branches.id }).from(schema.branches).where(eq(schema.branches.id, branchId))).length) throw validation({ branchId: "unknown_branch" });
    if (vehicleId && !(await db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId))).length) throw validation({ vehicleId: "unknown_vehicle" });
    const month = `${b.month}-01`;
    return db.transaction(async (tx) => {
      const same = and(eq(B.scope, b.scope), eq(B.month, month), branchId ? eq(B.branchId, branchId) : isNull(B.branchId), vehicleId ? eq(B.vehicleId, vehicleId) : isNull(B.vehicleId));
      const [cur] = await tx.select().from(B).where(same).for("update");
      const values = { amountMinor: b.amountMinor ?? null, liters: b.liters ?? null, updatedAt: new Date() };
      const [row] = cur
        ? await tx.update(B).set(values).where(eq(B.id, cur.id)).returning()
        : await tx.insert(B).values({ id: newId(), scope: b.scope, branchId, vehicleId, month, createdBy: ctx.identityId, ...values }).returning();
      await TenantDb.audit(tx, ctx, cur ? "fuel_budget.updated" : "fuel_budget.created", "fuel_budget", row!.id, values, cur ? { amountMinor: cur.amountMinor, liters: cur.liters } : null, branchId);
      return { id: row!.id, scope: row!.scope, branchId: row!.branchId, vehicleId: row!.vehicleId, month: b.month, amountMinor: row!.amountMinor, liters: row!.liters };
    });
  }
}
