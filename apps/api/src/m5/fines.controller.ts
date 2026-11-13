import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { routes, type Fine } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, canAccessBranch, localDate } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { companyOf, custodianAt, eventTime, iso, loadVehicle, type DbOrTx } from "../m2/common.js";
import { branchZones } from "../m2/zoned.js";

const F = schema.fines;
const C = schema.costRecords;
type Row = typeof F.$inferSelect;

export interface FineInput {
  id?: string; vehicleId: string; violationAt: string; amountMinor: number; authorityRef?: string | null; dueDate?: string | null;
  description?: string | null; driverId?: string | null;
}

/**
 * E29 traffic fines (Egypt pilot). A fine is one cost record (category Fines) created with it; payment status
 * changes never add a cost (INC-004 / GEN-006). The responsible driver is suggested from the custody timeline and
 * confirmed by a person (INC-003).
 */
@Controller()
export class FinesController {
  constructor(private readonly tdb: TenantDb) {}

  static async toDto(db: DbOrTx, f: Row): Promise<Fine> {
    const [cost] = await db.select({ id: C.id }).from(C).where(and(eq(C.sourceType, "fine"), eq(C.sourceId, f.id), eq(C.status, "active")));
    return {
      id: f.id, vehicleId: f.vehicleId, branchId: f.branchId, violationAt: f.violationAt.toISOString(), amountMinor: f.amountMinor, currency: f.currency,
      authorityRef: f.authorityRef, dueDate: f.dueDate, description: f.description, paymentStatus: f.paymentStatus, paidOn: f.paidOn,
      suggestedDriverId: f.suggestedDriverId, driverId: f.driverId, driverConfirmedAt: iso(f.driverConfirmedAt), source: f.source, status: f.status,
      voidReason: f.voidReason, costId: cost?.id ?? null, createdAt: f.createdAt.toISOString(),
    };
  }

  /** Shared with the fines import (E17): same rules, same single cost. */
  static async create(tx: Tx, ctx: RequestContext, b: FineInput, opts: { source?: "manual" | "import"; batchId?: string | null } = {}): Promise<{ row: Row; created: boolean }> {
    if (b.id) {
      const [existing] = await tx.select().from(F).where(eq(F.id, b.id));
      if (existing) return { row: existing, created: false };
    }
    const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true });
    const at = eventTime(b.violationAt, v, "violationAt");
    if (b.authorityRef) {
      const [dup] = await tx.select({ id: F.id }).from(F).where(and(eq(F.authorityRef, b.authorityRef), eq(F.status, "active")));
      if (dup) throw conflict("duplicate", "A fine with this authority reference exists", { authorityRef: `duplicate:${dup.id}` });
    }
    if (b.driverId) {
      const [d] = await tx.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.id, b.driverId));
      if (!d) throw validation({ driverId: "unknown_driver" });
    }
    const { country } = await companyOf(tx);
    const zones = await branchZones(tx);
    const suggested = await custodianAt(tx, v.id, at);
    const confirmed = b.driverId !== undefined;
    const id = b.id ?? newId();
    try {
      const [row] = await tx.insert(F).values({
        id, vehicleId: v.id, branchId: v.branchId, violationAt: at, amountMinor: b.amountMinor, currency: country.currency, authorityRef: b.authorityRef ?? null,
        dueDate: b.dueDate ?? null, description: b.description ?? null, suggestedDriverId: suggested, driverId: confirmed ? (b.driverId ?? null) : null,
        driverConfirmedBy: confirmed ? ctx.identityId : null, driverConfirmedAt: confirmed ? new Date() : null,
        source: opts.source ?? "manual", importBatchId: opts.batchId ?? null, createdBy: ctx.identityId,
      }).returning();
      // INC-004: one cost, category Fines, dated on the violation day in the vehicle's branch (US-E03-01).
      await tx.insert(C).values({
        id: newId(), category: "fines", vehicleId: v.id, branchId: v.branchId, netMinor: b.amountMinor, taxMinor: 0, currency: country.currency,
        taxRecoverable: country.taxRecoverable.fines, expenseDate: zones.localDay(at, v.branchId), sourceType: "fine", sourceId: id,
        description: b.authorityRef ? `Fine ${b.authorityRef}` : "Fine", flags: [], createdBy: ctx.identityId,
      });
      await TenantDb.audit(tx, ctx, "fine.created", "fine", id, { amountMinor: b.amountMinor, authorityRef: b.authorityRef ?? null, suggested, driverId: row!.driverId, source: row!.source }, null, v.branchId);
      return { row: row!, created: true };
    } catch (e) {
      if (uniqueViolation(e)) throw conflict("duplicate", "A fine with this authority reference exists", { authorityRef: "duplicate" });
      throw e;
    }
  }

  private async load(db: DbOrTx, ctx: RequestContext, id: string, lock = false) {
    const q = db.select().from(F).where(eq(F.id, id));
    const [f] = lock ? await q.for("update") : await q;
    if (!f || !canAccessBranch(ctx, ctx.scope!, f.branchId)) throw notFound("fine");
    return f;
  }

  @Requires("fine.read") @Get(routes.listFines.path)
  async list(@Query(new ZodPipe(routes.listFines.query)) q: z.output<typeof routes.listFines.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const where: SQL[] = [];
    if (filter) where.push(inArray(F.branchId, [...filter]));
    if (q.vehicleId) where.push(eq(F.vehicleId, q.vehicleId));
    if (q.paymentStatus) where.push(eq(F.paymentStatus, q.paymentStatus));
    if (q.includeVoided !== "true") where.push(eq(F.status, "active"));
    const rows = await db.select().from(F).where(and(...where)).orderBy(desc(F.violationAt)).limit(500);
    return { items: await Promise.all(rows.map((f) => FinesController.toDto(db, f))) };
  }

  @Requires("fine.write") @Get(routes.suggestFineDriver.path)
  async suggest(@Query(new ZodPipe(routes.suggestFineDriver.query)) q: z.output<typeof routes.suggestFineDriver.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const v = await loadVehicle(db, ctx, q.vehicleId);
    const driverId = await custodianAt(db, v.id, new Date(q.at));
    const [d] = driverId ? await db.select({ n: schema.drivers.fullName }).from(schema.drivers).where(eq(schema.drivers.id, driverId)) : [];
    return { driverId, driverName: d?.n ?? null };
  }

  @Requires("fine.write") @Post(routes.createFine.path)
  async create(@Body(new ZodPipe(routes.createFine.body)) b: z.output<typeof routes.createFine.body>, @Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    const db = await this.tdb.for(ctx);
    const r = await db.transaction((tx) => FinesController.create(tx, ctx, b));
    res.status(r.created ? 201 : 200);
    return FinesController.toDto(db, r.row);
  }

  @Requires("fine.write") @Post(routes.confirmFineDriver.path) @HttpCode(200)
  async confirmDriver(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.confirmFineDriver.body)) b: z.output<typeof routes.confirmFineDriver.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const f = await this.load(tx, ctx, id, true);
      if (f.status === "voided") throw conflict("voided", "This fine is voided");
      if (b.driverId) {
        const [d] = await tx.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.id, b.driverId));
        if (!d) throw validation({ driverId: "unknown_driver" });
      }
      const [row] = await tx.update(F).set({ driverId: b.driverId, driverConfirmedBy: ctx.identityId, driverConfirmedAt: new Date(), updatedAt: new Date() }).where(eq(F.id, id)).returning();
      await TenantDb.audit(tx, ctx, "fine.driver_confirmed", "fine", id, { driverId: b.driverId, suggested: f.suggestedDriverId }, { driverId: f.driverId }, f.branchId);
      return FinesController.toDto(tx, row!);
    });
  }

  /** INC-004: paying changes the status only; the cost was recorded once with the fine. */
  @Requires("fine.write") @Post(routes.finePayment.path) @HttpCode(200)
  async payment(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.finePayment.body)) b: z.output<typeof routes.finePayment.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const f = await this.load(tx, ctx, id, true);
      if (f.status === "voided") throw conflict("voided", "This fine is voided");
      if (b.paymentStatus === "paid" && !b.paidOn) throw validation({ paidOn: "required" });
      const paidOn = b.paymentStatus === "paid" ? b.paidOn! : null;
      const [row] = await tx.update(F).set({ paymentStatus: b.paymentStatus, paidOn, updatedAt: new Date() }).where(eq(F.id, id)).returning();
      await TenantDb.audit(tx, ctx, "fine.payment", "fine", id, { paymentStatus: b.paymentStatus, paidOn }, { paymentStatus: f.paymentStatus }, f.branchId);
      return FinesController.toDto(tx, row!);
    });
  }

  @Requires("fine.write") @Post(routes.voidFine.path) @HttpCode(200)
  async void(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.voidFine.body)) b: z.output<typeof routes.voidFine.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const f = await this.load(tx, ctx, id, true);
      if (f.status === "voided") return FinesController.toDto(tx, f);
      const [row] = await tx.update(F).set({ status: "voided", voidReason: b.reason, updatedAt: new Date() }).where(eq(F.id, id)).returning();
      await tx.update(C).set({ status: "voided" }).where(and(eq(C.sourceType, "fine"), eq(C.sourceId, id)));
      await TenantDb.audit(tx, ctx, "fine.voided", "fine", id, { reason: b.reason }, { status: f.status }, f.branchId);
      return FinesController.toDto(tx, row!);
    });
  }
}
