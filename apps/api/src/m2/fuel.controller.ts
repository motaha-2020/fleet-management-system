import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { routes, type FuelEntry } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
import {
  branchFilter, consumption, cumulative, fuelFlags, fullToFullCycles, initialFuelStatus, isTrusted, sniffMime, type CycleEntry, type FuelFlag,
} from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { AppError, conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { CONTROL_DB, STORAGE } from "../infra/tokens.js";
import { TenantKeys } from "../infra/tenant-keys.js";
import { decryptFile, encryptFile, type ObjectStorage } from "../files/storage.js";
import { readCapped } from "../files/read-capped.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { companyOf, eventTime, hasAssignment, iso, loadVehicle, type DbOrTx } from "./common.js";
import { MeterService } from "./meter.service.js";
import { FuelRecalc } from "./fuel-recalc.service.js";
import { FuelService } from "./fuel.service.js";

const F = schema.fuelEntries;
type Row = typeof F.$inferSelect;

export const toFuel = (e: Row): FuelEntry => ({
  id: e.id, vehicleId: e.vehicleId, driverId: e.driverId, eventAt: e.eventAt.toISOString(), recordedAt: e.recordedAt.toISOString(),
  odometer: e.odometer, readingId: e.readingId, fuelType: e.fuelType, quantity: Number(e.quantity), unit: e.unit, isFull: e.isFull,
  netMinor: e.netMinor, taxMinor: e.taxMinor, grossMinor: e.grossMinor ?? e.netMinor + e.taxMinor, currency: e.currency,
  unitPriceMinor: Math.round(((e.grossMinor ?? e.netMinor + e.taxMinor) / Number(e.quantity)) * 100) / 100,
  payment: e.payment, receiptRef: e.receiptRef, hasReceipt: !!e.receiptFileKey,
  referencePriceMinor: e.referencePriceMinor, referenceOfficial: e.referenceOfficial, status: e.status, flags: e.flags, notes: e.notes,
  createdBy: e.createdBy, reviewedBy: e.reviewedBy, reviewedAt: iso(e.reviewedAt), voidReason: e.voidReason,
});

/**
 * E09. Records are never rejected for business-rule findings (GEN-012): they are saved with flags and
 * go to review. Only format errors (quantity ≤ 0, amount ≤ 0, unknown vehicle) are refused.
 */
@Controller()
export class FuelController {
  constructor(
    private readonly tdb: TenantDb,
    private readonly meter: MeterService,
    private readonly recalc: FuelRecalc,
    private readonly fuel: FuelService,
    private readonly keys: TenantKeys,
    @Inject(CONTROL_DB) private readonly control: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}


  private scopeWhere(ctx: RequestContext): SQL | undefined | null {
    if (ctx.scope === "own") return ctx.driverId ? eq(F.driverId, ctx.driverId) : null;
    const filter = branchFilter(ctx, ctx.scope!);
    if (!filter) return undefined;
    return filter.length ? inArray(F.branchId, [...filter]) : null;
  }

  private async loadInScope(db: DbOrTx, ctx: RequestContext, id: string, lock = false) {
    const q = db.select().from(F).where(eq(F.id, id));
    const [e] = lock ? await q.for("update") : await q;
    if (!e) throw notFound("fuel entry");
    if (ctx.scope === "own") {
      if (!ctx.driverId || e.driverId !== ctx.driverId) throw notFound("fuel entry");
    } else {
      const filter = branchFilter(ctx, ctx.scope!);
      if (filter && !filter.includes(e.branchId)) throw notFound("fuel entry");
    }
    return e;
  }

  @Requires("fuel.read") @Get(routes.listFuelEntries.path)
  async list(@Query(new ZodPipe(routes.listFuelEntries.query)) q: z.output<typeof routes.listFuelEntries.query>, @Ctx() ctx: RequestContext) {
    const scope = this.scopeWhere(ctx);
    if (scope === null) return { items: [] };
    const where: SQL[] = scope ? [scope] : [];
    if (q.vehicleId) where.push(eq(F.vehicleId, q.vehicleId));
    if (q.status) where.push(eq(F.status, q.status));
    if (q.from) where.push(gte(F.eventAt, new Date(q.from)));
    if (q.to) where.push(lte(F.eventAt, new Date(q.to)));
    const db = await this.tdb.for(ctx);
    const rows = await db.select().from(F).where(and(...where)).orderBy(desc(F.eventAt)).limit(500);
    return { items: rows.map(toFuel) };
  }

  @Requires("fuel.read") @Get(routes.getFuelEntry.path)
  async get(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    return toFuel(await this.loadInScope(await this.tdb.for(ctx), ctx, id));
  }

  @Requires("fuel.create") @Post(routes.createFuelEntry.path)
  async create(@Body(new ZodPipe(routes.createFuelEntry.body)) b: z.output<typeof routes.createFuelEntry.body>, @Ctx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    const db = await this.tdb.for(ctx);
    const result = await db.transaction((tx) => this.fuel.create(tx, ctx, b));
    res.status(result.created ? 201 : 200);
    return toFuel(result.row);
  }

  /** Receipt photo; arriving clears missing_receipt and may complete acceptance. */
  @Requires("fuel.create") @Post(routes.uploadFuelReceipt.path) @HttpCode(200)
  async uploadReceipt(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request, @Ctx() ctx: RequestContext) {
    const bytes = await readCapped(req, DEFAULTS.FILE_DOC_MAX_BYTES);
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => toFuel(await this.fuel.attachReceipt(tx, ctx, await this.loadInScope(tx, ctx, id, true), bytes)));
  }

  @Requires("fuel.read") @Get(routes.downloadFuelReceipt.path)
  async downloadReceipt(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext, @Res() res: Response) {
    const db = await this.tdb.for(ctx);
    const e = await this.loadInScope(db, ctx, id);
    if (!e.receiptFileKey || !e.receiptFileMime) throw notFound("receipt");
    const plain = decryptFile((await this.keys.for(tenantOf(ctx))).fileKey, await this.storage.get(e.receiptFileKey));
    await TenantDb.audit(db, ctx, "fuel.receipt_downloaded", "fuel_entry", id, null, null, e.branchId);
    res.setHeader("content-type", e.receiptFileMime);
    res.setHeader("content-disposition", `attachment; filename="receipt-${id}"`);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "private, no-store");
    res.end(plain);
  }

  /** FUEL-002: accept after review. The person who recorded it cannot accept it (GEN-004). */
  @Requires("fuel.review") @Post(routes.acceptFuelEntry.path) @HttpCode(200)
  async accept(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const e = await this.loadInScope(tx, ctx, id, true);
      if (e.status !== "under_review") throw conflict("invalid_transition", `A ${e.status} entry cannot be accepted`);
      if (e.createdBy === ctx.identityId) throw new AppError(HttpStatus.FORBIDDEN, "maker_checker", "You cannot verify a record you created");
      const [row] = await tx.update(F).set({ status: "accepted", reviewedBy: ctx.identityId, reviewedAt: new Date() }).where(eq(F.id, id)).returning();
      await this.recalc.ensureCost(tx, ctx, row!);
      await TenantDb.audit(tx, ctx, "fuel.accepted", "fuel_entry", id, { status: "accepted", flags: e.flags }, { status: e.status }, e.branchId);
      return toFuel(row!);
    });
  }

  /** US-E09-06: voided entries stay visible, leave costs and consumption cycles, and their reading is excluded. */
  @Requires("fuel.review") @Post(routes.voidFuelEntry.path) @HttpCode(200)
  async void(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.voidFuelEntry.body)) b: z.output<typeof routes.voidFuelEntry.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const e = await this.loadInScope(tx, ctx, id, true);
      if (e.status === "voided") throw conflict("invalid_transition", "Already voided");
      const [row] = await tx.update(F).set({ status: "voided", voidReason: b.reason, reviewedBy: e.createdBy === ctx.identityId ? e.reviewedBy : ctx.identityId, reviewedAt: new Date() }).where(eq(F.id, id)).returning();
      await this.recalc.voidCost(tx, id);
      if (e.readingId) await tx.update(schema.meterReadings).set({ status: "excluded" }).where(and(eq(schema.meterReadings.id, e.readingId), ne(schema.meterReadings.status, "corrected")));
      await TenantDb.audit(tx, ctx, "fuel.voided", "fuel_entry", id, { status: "voided", reason: b.reason }, { status: e.status }, e.branchId);
      return toFuel(row!);
    });
  }

  /** US-E09-07/09: purchased quantity vs Full-to-Full consumption per fuel type, for cycles ending in the period. */
  @Requires("fuel.read") @Get(routes.vehicleFuelStats.path)
  async stats(@Param("id", ParseUUIDPipe) id: string, @Query(new ZodPipe(routes.vehicleFuelStats.query)) q: z.output<typeof routes.vehicleFuelStats.query>, @Ctx() ctx: RequestContext) {
    if (ctx.role === "driver") throw forbidden();
    const db = await this.tdb.for(ctx);
    const v = await loadVehicle(db, ctx, id);
    const from = q.from ? new Date(q.from).getTime() : 0;
    const to = q.to ? new Date(q.to).getTime() : Date.now() + 1;
    const entries = await db.select().from(F).where(eq(F.vehicleId, v.id)).orderBy(asc(F.eventAt));
    const { rows: readings, replacements } = await this.meter.history(db, v.id);
    const byId = new Map(readings.map((r) => [r.id, r]));
    const cycleEntries: CycleEntry[] = entries.map((e) => {
      const r = e.readingId ? byId.get(e.readingId) : undefined;
      return {
        id: e.id, at: e.eventAt.getTime(), fuelType: e.fuelType, quantity: Number(e.quantity), isFull: e.isFull, status: e.status, flags: e.flags,
        odometerCum: cumulative(r?.value ?? e.odometer, e.eventAt.getTime(), replacements), odometerTrusted: !!r && isTrusted(r.status),
      };
    });
    const cycles = fullToFullCycles(cycleEntries).filter((c) => c.endAt >= from && c.endAt <= to);
    const inPeriod = entries.filter((e) => e.status === "accepted" && e.eventAt.getTime() >= from && e.eventAt.getTime() <= to);
    const types = [...new Set(entries.map((e) => e.fuelType))];
    return {
      purchased: types.map((t) => {
        const list = inPeriod.filter((e) => e.fuelType === t);
        return { fuelType: t, unit: (list[0]?.unit ?? entries.find((e) => e.fuelType === t)!.unit), quantity: Math.round(list.reduce((s, e) => s + Number(e.quantity), 0) * 1000) / 1000, grossMinor: list.reduce((s, e) => s + (e.grossMinor ?? 0), 0) };
      }),
      consumption: types.map((t) => ({ fuelType: t, ...consumption(cycles.filter((c) => c.fuelType === t)) })),
      cycles: cycles.map((c) => ({ ...c, startAt: new Date(c.startAt).toISOString(), endAt: new Date(c.endAt).toISOString() })),
    };
  }

  @Requires("fuel.read") @Get(routes.currentFuelPrices.path)
  async prices(@Ctx() ctx: RequestContext) {
    const { country } = await companyOf(await this.tdb.for(ctx));
    const now = new Date();
    const items = [];
    for (const f of country.fuelTypes) {
      const P = schema.fuelPrices;
      const [p] = await this.control.select().from(P).where(and(eq(P.countryCode, country.code), eq(P.fuelType, f.code), lte(P.effectiveFrom, now))).orderBy(desc(P.effectiveFrom)).limit(1);
      if (p) items.push({ id: p.id, countryCode: p.countryCode, fuelType: p.fuelType, priceMinor: p.priceMinor, currency: p.currency, effectiveFrom: p.effectiveFrom.toISOString() });
    }
    return { items };
  }
}

