import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { routes } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { currentOdometer } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, forbidden, validation } from "../infra/errors.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { eventTime, loadVehicle } from "./common.js";
import { MeterService } from "./meter.service.js";

/** E08: unified odometer timeline, manual/opening readings, meter replacement. */
@Controller()
export class OdometerController {
  constructor(private readonly tdb: TenantDb, private readonly meter: MeterService) {}

  @Requires("odometer.read") @Get(routes.vehicleOdometer.path)
  async view(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const v = await loadVehicle(db, ctx, id);
    const { rows, reps, replacements, domain } = await this.meter.history(db, v.id);
    const cur = currentOdometer(domain, replacements);
    return {
      current: cur ? { value: cur.value, cumulative: cur.cumulative, at: new Date(cur.at).toISOString() } : null,
      readings: rows.map((r) => this.meter.toDto(r, replacements)).reverse(),
      replacements: reps.map((r) => ({ id: r.id, eventAt: r.eventAt.toISOString(), oldFinal: r.oldFinal, newStart: r.newStart, reason: r.reason })),
    };
  }

  /** ODO-001: manual reading (drivers: on vehicles assigned to them) or opening balance (staff, first reading only). */
  @Requires("odometer.write") @Post(routes.createReading.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createReading.body)) b: z.output<typeof routes.createReading.body>, @Ctx() ctx: RequestContext) {
    if (b.opening && ctx.role === "driver") throw forbidden("Opening balances are entered by the office");
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const R = schema.meterReadings;
      if (b.id) {
        const [existing] = await tx.select().from(R).where(eq(R.id, b.id));
        if (existing) return this.meter.toDto(existing, (await this.meter.history(tx, existing.vehicleId)).replacements);
      }
      const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true });
      const at = eventTime(b.eventAt, v);
      if (b.opening) {
        const [any] = await tx.select({ id: R.id }).from(R).where(eq(R.vehicleId, v.id)).limit(1);
        if (any) throw conflict("has_readings", "The vehicle already has readings; use a manual reading");
      }
      const row = await this.meter.record(tx, { vehicleId: v.id, value: b.value, at, sourceType: b.opening ? "opening" : "manual", sourceId: null, createdBy: ctx.identityId });
      await TenantDb.audit(tx, ctx, "odometer.recorded", "vehicle", v.id, { value: b.value, at, status: row.status, reasons: row.reasons }, null, v.branchId);
      return this.meter.toDto(row, (await this.meter.history(tx, v.id)).replacements);
    });
  }

  /** ODO-009 / US-E08-05: a new meter starts a new segment; total distance continues. */
  @Requires("odometer.replace") @Post(routes.createReplacement.path) @HttpCode(201)
  async replace(@Body(new ZodPipe(routes.createReplacement.body)) b: z.output<typeof routes.createReplacement.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true });
      const at = eventTime(b.eventAt, v);
      const M = schema.meterReplacements;
      const [dup] = await tx.select({ id: M.id }).from(M).where(and(eq(M.vehicleId, v.id), eq(M.eventAt, at)));
      if (dup) throw conflict("duplicate", "A replacement at this time already exists");
      if (b.newStart > b.oldFinal) throw validation({ newStart: "out_of_range" });
      const id = b.id ?? newId();
      const [row] = await tx.insert(M).values({ id, vehicleId: v.id, eventAt: at, oldFinal: b.oldFinal, newStart: b.newStart, reason: b.reason ?? null, createdBy: ctx.identityId }).returning();
      // Boundary readings: the old meter's final value just before, and the new meter's start.
      await this.meter.record(tx, { vehicleId: v.id, value: b.oldFinal, at: new Date(at.getTime() - 1), sourceType: "replacement", sourceId: id, createdBy: ctx.identityId });
      await this.meter.record(tx, { vehicleId: v.id, value: b.newStart, at, sourceType: "replacement", sourceId: id, createdBy: ctx.identityId });
      await TenantDb.audit(tx, ctx, "odometer.replaced", "vehicle", v.id, { oldFinal: b.oldFinal, newStart: b.newStart, at }, null, v.branchId);
      return { id: row!.id, eventAt: row!.eventAt.toISOString(), oldFinal: row!.oldFinal, newStart: row!.newStart, reason: row!.reason };
    });
  }
}
