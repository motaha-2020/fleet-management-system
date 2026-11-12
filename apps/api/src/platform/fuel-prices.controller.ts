import { Body, Controller, Get, HttpCode, Inject, Post, Query } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { COUNTRY_TEMPLATES } from "@fleet/config";
import { routes } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB } from "../infra/tokens.js";
import { conflict, uniqueViolation, validation } from "../infra/errors.js";

const P = schema.fuelPrices;
const toPrice = (p: typeof P.$inferSelect) => ({ id: p.id, countryCode: p.countryCode, fuelType: p.fuelType, priceMinor: p.priceMinor, currency: p.currency, effectiveFrom: p.effectiveFrom.toISOString() });

/** FUEL-017 / US-E09-10: official prices, effective-dated and append-only; past evaluations never change. */
@Controller()
export class FuelPricesController {
  constructor(@Inject(CONTROL_DB) private readonly db: Db) {}

  @Requires("fuel_price.manage") @Get(routes.listFuelPrices.path)
  async list(@Query(new ZodPipe(routes.listFuelPrices.query)) q: z.output<typeof routes.listFuelPrices.query>) {
    const rows = await this.db.select().from(P).where(q.countryCode ? eq(P.countryCode, q.countryCode) : undefined).orderBy(P.countryCode, P.fuelType, desc(P.effectiveFrom));
    return { items: rows.map(toPrice) };
  }

  @Requires("fuel_price.manage") @Post(routes.createFuelPrice.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createFuelPrice.body)) b: z.output<typeof routes.createFuelPrice.body>, @Ctx() ctx: RequestContext) {
    const country = COUNTRY_TEMPLATES[b.countryCode];
    if (!country) throw validation({ countryCode: "no active country template" });
    if (!country.fuelTypes.some((f) => f.code === b.fuelType)) throw validation({ fuelType: "unknown_fuel_type" });
    try {
      const [row] = await this.db.insert(P).values({ id: newId(), countryCode: b.countryCode, fuelType: b.fuelType, priceMinor: b.priceMinor, currency: country.currency, effectiveFrom: new Date(b.effectiveFrom), createdBy: ctx.identityId }).returning();
      await this.db.insert(schema.platformAudit).values({ actorId: ctx.identityId, action: "fuel_price.created", detail: toPrice(row!) });
      return toPrice(row!);
    } catch (e) {
      if (uniqueViolation(e)) throw conflict("duplicate", "A price for this fuel and time already exists", { effectiveFrom: "taken" });
      throw e;
    }
  }
}

