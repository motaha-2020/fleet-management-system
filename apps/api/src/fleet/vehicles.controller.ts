import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { and, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { COUNTRY_TEMPLATES } from "@fleet/config";
import { routes, type Vehicle } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, canAccessBranch, normalizeRegistration, validateVehicleDraft } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, forbidden, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantDb } from "./tenant-db.js";

const V = schema.vehicles;

@Controller()
export class VehiclesController {
  constructor(private readonly tdb: TenantDb) {}

  @Requires("vehicle.read") @Get(routes.listVehicles.path)
  async list(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [] };
    const where: SQL[] = [];
    if (filter) where.push(inArray(V.branchId, [...filter]));
    // Drivers only see vehicles that can be operated (not drafts / disposed).
    if (ctx.role === "driver") where.push(eq(V.status, "active"));
    const rows = await db.select().from(V).where(and(...where)).orderBy(desc(V.createdAt)).limit(500);
    return { items: rows.map(toVehicle) };
  }

  @Requires("vehicle.read") @Get(routes.getVehicle.path)
  async get(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const [v] = await db.select().from(V).where(eq(V.id, id));
    // Out-of-scope records look exactly like missing ones (no existence leak).
    if (!v || !canAccessBranch(ctx, ctx.scope!, v.branchId) || (ctx.role === "driver" && v.status !== "active")) throw notFound("vehicle");
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

    const [company] = await db.select().from(schema.company).limit(1);
    const country = COUNTRY_TEMPLATES[company?.countryCode ?? ""];
    if (!country) throw new Error("tenant has no country template");
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

  /** VEH-002 with a useful message: names the conflicting vehicle (US-E05-01). */
  private async assertUnique(db: Awaited<ReturnType<TenantDb["for"]>>, fleetNumber: string, reg: string, vin: string | null) {
    const match = [sql`lower(${V.fleetNumber}) = lower(${fleetNumber})`, eq(V.registrationNormalized, reg)];
    if (vin) match.push(eq(V.vin, vin));
    const clashes = await db.select({ id: V.id, fleetNumber: V.fleetNumber, reg: V.registrationNormalized, vin: V.vin }).from(V)
      .where(and(ne(V.status, "disposed"), or(...match)));
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
    createdAt: v.createdAt.toISOString(),
  };
}
