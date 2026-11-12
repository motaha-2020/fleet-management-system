import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { COUNTRY_TEMPLATES } from "@fleet/config";
import { routes, type Vehicle } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, canAccessBranch, canChangeVehicleStatus, canDisposeVehicle, localDate, normalizeRegistration, validateVehicleDraft, type VehicleDraft } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, forbidden, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "./tenant-db.js";
import { driverVehicleIds } from "../m2/common.js";

const V = schema.vehicles;

@Controller()
export class VehiclesController {
  constructor(private readonly tdb: TenantDb) {}

  @Requires("vehicle.read") @Get(routes.listVehicles.path)
  async list(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const where: SQL[] = [];
    if (ctx.role === "driver") {
      // "assigned" scope: vehicles the driver holds an active assignment on (E07), operable ones only.
      const ids = await driverVehicleIds(db, ctx.driverId);
      if (!ids.length) return { items: [] };
      where.push(inArray(V.id, ids), eq(V.status, "active"));
    } else {
      const filter = branchFilter(ctx, ctx.scope!);
      if (filter && !filter.length) return { items: [] };
      if (filter) where.push(inArray(V.branchId, [...filter]));
    }
    const rows = await db.select().from(V).where(and(...where)).orderBy(desc(V.createdAt)).limit(500);
    return { items: rows.map(toVehicle) };
  }

  @Requires("vehicle.read") @Get(routes.getVehicle.path)
  async get(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const [v] = await db.select().from(V).where(eq(V.id, id));
    // Out-of-scope records look exactly like missing ones (no existence leak).
    if (!v) throw notFound("vehicle");
    if (ctx.role === "driver" ? v.status !== "active" || !(await driverVehicleIds(db, ctx.driverId)).includes(v.id) : !canAccessBranch(ctx, ctx.scope!, v.branchId)) throw notFound("vehicle");
    return toVehicle(v);
  }

  @Requires("vehicle.write") @Post(routes.createVehicle.path)
  async create(
    @Body(new ZodPipe(routes.createVehicle.body)) b: z.output<typeof routes.createVehicle.body>,
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!canAccessBranch(ctx, ctx.scope!, b.branchId)) throw forbidden("You can only add vehicles to your branches");
    const db = await this.tdb.for(ctx);

    // Idempotent create: retrying with the same client id returns the existing record.
    if (b.id) {
      const [existing] = await db.select().from(V).where(eq(V.id, b.id));
      if (existing) {
        if (!canAccessBranch(ctx, ctx.scope!, existing.branchId)) throw conflict("id_in_use", "This id is already used");
        res.status(200);
        return toVehicle(existing);
      }
    }

    const country = await this.country(db);
    const [branch] = await db.select({ id: schema.branches.id }).from(schema.branches).where(eq(schema.branches.id, b.branchId));
    if (!branch) throw validation({ branchId: "unknown_branch" });

    const vin = b.vin ? b.vin.toUpperCase() : null;
    const errors = validateVehicleDraft({ ...b, vin }, country, new Date().getFullYear());
    if (Object.keys(errors).length) throw validation(errors as Record<string, string>);

    const registrationNormalized = normalizeRegistration(b.registrationNumber);
    await this.assertUnique(db, b.fleetNumber, registrationNormalized, vin);

    const id = b.id ?? newId();
    try {
      const row = await db.transaction(async (tx) => {
        const [v] = await tx.insert(V).values({
          id,
          branchId: b.branchId,
          fleetNumber: b.fleetNumber,
          registrationNumber: b.registrationNumber,
          registrationNormalized,
          vin,
          make: b.make,
          model: b.model,
          year: b.year,
          primaryFuelType: b.primaryFuelType,
          primaryTankCapacity: b.primaryTankCapacity!,
          secondaryFuelType: b.secondaryFuelType ?? null,
          secondaryTankCapacity: b.secondaryTankCapacity ?? null,
          meterType: b.meterType,
          requiredLicenseCategory: b.requiredLicenseCategory!,
          ownershipType: b.ownershipType,
          status: b.status,
          createdBy: ctx.identityId,
        }).returning();
        await TenantDb.audit(tx, ctx, "vehicle.created", "vehicle", id, toVehicle(v!));
        return v!;
      });
      res.status(201);
      return toVehicle(row);
    } catch (e) {
      // Safety net: the partial unique indexes catch races the pre-check cannot.
      const c = uniqueViolation(e);
      if (c) {
        await this.assertUnique(db, b.fleetNumber, registrationNormalized, vin);
        throw conflict("duplicate", "A vehicle with the same identifiers already exists");
      }
      throw e;
    }
  }

  /** Loads a vehicle the user may act on with `action`, locked for update; 404 when out of scope. */
  private async lockInScope(tx: Tx, ctx: RequestContext, id: string) {
    const [v] = await tx.select().from(V).where(eq(V.id, id)).for("update");
    if (!v || !canAccessBranch(ctx, ctx.scope!, v.branchId)) throw notFound("vehicle");
    return v;
  }

  /** Edit master data. Every change is audited with before/after (formal Corrections arrive in E16). */
  @Requires("vehicle.write") @Patch(routes.updateVehicle.path)
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateVehicle.body)) b: z.output<typeof routes.updateVehicle.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const country = await this.country(db);
    return db.transaction(async (tx) => {
      const before = await this.lockInScope(tx, ctx, id);
      if (before.status === "disposed") throw conflict("vehicle_disposed", "A disposed vehicle cannot be edited");
      const merged: VehicleDraft = {
        fleetNumber: b.fleetNumber ?? before.fleetNumber,
        registrationNumber: b.registrationNumber ?? before.registrationNumber,
        vin: b.vin === undefined ? before.vin : b.vin ? b.vin.toUpperCase() : null,
        make: b.make ?? before.make,
        model: b.model ?? before.model,
        year: b.year ?? before.year,
        primaryFuelType: b.primaryFuelType ?? before.primaryFuelType,
        primaryTankCapacity: b.primaryTankCapacity === undefined ? Number(before.primaryTankCapacity) : b.primaryTankCapacity,
        secondaryFuelType: b.secondaryFuelType === undefined ? before.secondaryFuelType : b.secondaryFuelType,
        secondaryTankCapacity: b.secondaryTankCapacity === undefined ? (before.secondaryTankCapacity == null ? null : Number(before.secondaryTankCapacity)) : b.secondaryTankCapacity,
        meterType: b.meterType ?? before.meterType,
        requiredLicenseCategory: b.requiredLicenseCategory === undefined ? before.requiredLicenseCategory : b.requiredLicenseCategory,
        ownershipType: b.ownershipType ?? before.ownershipType,
      };
      const errors = validateVehicleDraft(merged, country, new Date().getFullYear());
      if (Object.keys(errors).length) throw validation(errors as Record<string, string>);
      const registrationNormalized = normalizeRegistration(merged.registrationNumber);
      await this.assertUnique(tx, merged.fleetNumber, registrationNormalized, merged.vin ?? null, id);
      const [row] = await tx.update(V).set({
        ...merged,
        vin: merged.vin ?? null,
        secondaryFuelType: merged.secondaryFuelType ?? null,
        secondaryTankCapacity: merged.secondaryTankCapacity ?? null,
        primaryTankCapacity: merged.primaryTankCapacity!,
        requiredLicenseCategory: merged.requiredLicenseCategory!,
        registrationNormalized,
        updatedAt: new Date(),
      }).where(eq(V.id, id)).returning();
      await TenantDb.audit(tx, ctx, "vehicle.updated", "vehicle", id, toVehicle(row!), toVehicle(before), row!.branchId);
      return toVehicle(row!);
    });
  }

  /** VEH-003: Draft → Active ⇄ Inactive. */
  @Requires("vehicle.write") @Post(routes.changeVehicleStatus.path) @HttpCode(200)
  async changeStatus(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.changeVehicleStatus.body)) b: z.output<typeof routes.changeVehicleStatus.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const before = await this.lockInScope(tx, ctx, id);
      if (!canChangeVehicleStatus(before.status, b.status)) throw conflict("invalid_transition", `Cannot change a ${before.status} vehicle to ${b.status}`);
      const [row] = await tx.update(V).set({ status: b.status, updatedAt: new Date() }).where(eq(V.id, id)).returning();
      await TenantDb.audit(tx, ctx, "vehicle.status_changed", "vehicle", id, { status: b.status, reason: b.reason ?? null }, { status: before.status }, row!.branchId);
      return toVehicle(row!);
    });
  }

  /**
   * VEH-005: the vehicle moves to another branch from `effectiveAt`. History rows keep where it was,
   * so reports for the old branch before that time do not change. The user needs scope on both branches.
   */
  @Requires("vehicle.transfer") @Post(routes.transferVehicle.path) @HttpCode(200)
  async transfer(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.transferVehicle.body)) b: z.output<typeof routes.transferVehicle.body>, @Ctx() ctx: RequestContext) {
    if (!canAccessBranch(ctx, ctx.scope!, b.toBranchId)) throw forbidden("You need access to the destination branch");
    const effectiveAt = b.effectiveAt ? new Date(b.effectiveAt) : new Date();
    if (effectiveAt.getTime() > Date.now() + 60_000) throw validation({ effectiveAt: "future_not_allowed" });
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const before = await this.lockInScope(tx, ctx, id);
      if (before.status === "disposed") throw conflict("vehicle_disposed", "A disposed vehicle cannot be transferred");
      if (before.branchId === b.toBranchId) throw validation({ toBranchId: "same_branch" });
      const [target] = await tx.select({ id: schema.branches.id, status: schema.branches.status }).from(schema.branches).where(eq(schema.branches.id, b.toBranchId));
      if (!target || target.status !== "active") throw validation({ toBranchId: "unknown_branch" });
      const [last] = await tx.select({ at: schema.vehicleBranchHistory.effectiveAt }).from(schema.vehicleBranchHistory)
        .where(eq(schema.vehicleBranchHistory.vehicleId, id)).orderBy(desc(schema.vehicleBranchHistory.effectiveAt)).limit(1);
      if (last && effectiveAt <= last.at) throw validation({ effectiveAt: "before_previous_transfer" });
      await tx.insert(schema.vehicleBranchHistory).values({ id: newId(), vehicleId: id, fromBranchId: before.branchId, toBranchId: b.toBranchId, effectiveAt, reason: b.reason ?? null, createdBy: ctx.identityId });
      const [row] = await tx.update(V).set({ branchId: b.toBranchId, updatedAt: new Date() }).where(eq(V.id, id)).returning();
      await TenantDb.audit(tx, ctx, "vehicle.transferred", "vehicle", id, { branchId: b.toBranchId, effectiveAt }, { branchId: before.branchId }, b.toBranchId);
      return toVehicle(row!);
    });
  }

  /** VEH-006: disposal is final; later operations dated after it are refused by their modules. */
  @Requires("vehicle.dispose") @Post(routes.disposeVehicle.path) @HttpCode(200)
  async dispose(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.disposeVehicle.body)) b: z.output<typeof routes.disposeVehicle.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const [company] = await db.select().from(schema.company).limit(1);
    if (b.date > localDate(new Date(), company?.timezone ?? "Africa/Cairo")) throw validation({ date: "future_not_allowed" });
    if (b.saleValueMinor != null && b.reason !== "sold") throw validation({ saleValueMinor: "only_when_sold" });
    return db.transaction(async (tx) => {
      const before = await this.lockInScope(tx, ctx, id);
      if (!canDisposeVehicle(before.status)) throw conflict("invalid_transition", `Cannot dispose a ${before.status} vehicle`);
      const [row] = await tx.update(V).set({
        status: "disposed", disposedAt: b.date, disposalReason: b.reason, disposalOdometer: b.finalOdometer, disposalValueMinor: b.saleValueMinor ?? null, updatedAt: new Date(),
      }).where(eq(V.id, id)).returning();
      await TenantDb.audit(tx, ctx, "vehicle.disposed", "vehicle", id, toVehicle(row!), { status: before.status }, row!.branchId);
      return toVehicle(row!);
    });
  }

  @Requires("vehicle.read") @Get(routes.vehicleBranchHistory.path)
  async branchHistory(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const [v] = await db.select({ branchId: V.branchId, status: V.status }).from(V).where(eq(V.id, id));
    if (!v || !canAccessBranch(ctx, ctx.scope!, v.branchId) || ctx.role === "driver") throw notFound("vehicle");
    const H = schema.vehicleBranchHistory;
    const rows = await db.select().from(H).where(eq(H.vehicleId, id)).orderBy(desc(H.effectiveAt));
    return { items: rows.map((h) => ({ id: h.id, fromBranchId: h.fromBranchId, toBranchId: h.toBranchId, effectiveAt: h.effectiveAt.toISOString(), reason: h.reason, createdBy: h.createdBy })) };
  }

  private async country(db: Awaited<ReturnType<TenantDb["for"]>>) {
    const [company] = await db.select().from(schema.company).limit(1);
    const country = COUNTRY_TEMPLATES[company?.countryCode ?? ""];
    if (!country) throw new Error("tenant has no country template");
    return country;
  }

  /** VEH-002 with a useful message: names the conflicting vehicle (US-E05-01). */
  private async assertUnique(db: Awaited<ReturnType<TenantDb["for"]>> | Tx, fleetNumber: string, reg: string, vin: string | null, exceptId?: string) {
    const match = [sql`lower(${V.fleetNumber}) = lower(${fleetNumber})`, eq(V.registrationNormalized, reg)];
    if (vin) match.push(eq(V.vin, vin));
    const clashes = await db.select({ id: V.id, fleetNumber: V.fleetNumber, reg: V.registrationNormalized, vin: V.vin }).from(V)
      .where(and(ne(V.status, "disposed"), or(...match), exceptId ? ne(V.id, exceptId) : undefined));
    if (!clashes.length) return;
    const fields: Record<string, string> = {};
    for (const c of clashes) {
      if (c.fleetNumber.toLowerCase() === fleetNumber.toLowerCase()) fields.fleetNumber = `duplicate:${c.id}:${c.fleetNumber}`;
      if (c.reg === reg) fields.registrationNumber = `duplicate:${c.id}:${c.fleetNumber}`;
      if (vin && c.vin === vin) fields.vin = `duplicate:${c.id}:${c.fleetNumber}`;
    }
    throw conflict("duplicate", "A vehicle with the same identifiers already exists", fields);
  }
}

export function toVehicle(v: typeof V.$inferSelect): Vehicle {
  return {
    id: v.id,
    branchId: v.branchId,
    fleetNumber: v.fleetNumber,
    registrationNumber: v.registrationNumber,
    vin: v.vin,
    make: v.make,
    model: v.model,
    year: v.year,
    primaryFuelType: v.primaryFuelType,
    primaryTankCapacity: Number(v.primaryTankCapacity),
    secondaryFuelType: v.secondaryFuelType,
    secondaryTankCapacity: v.secondaryTankCapacity == null ? null : Number(v.secondaryTankCapacity),
    meterType: v.meterType,
    requiredLicenseCategory: v.requiredLicenseCategory,
    ownershipType: v.ownershipType,
    status: v.status,
    disposal: v.status === "disposed" && v.disposedAt && v.disposalReason
      ? { date: v.disposedAt, reason: v.disposalReason, finalOdometer: v.disposalOdometer, saleValueMinor: v.disposalValueMinor }
      : null,
    createdAt: v.createdAt.toISOString(),
  };
}
