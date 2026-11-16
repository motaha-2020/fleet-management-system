import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { routes, type Customer } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, notFound, uniqueViolation } from "../infra/errors.js";
import { TenantDb } from "../fleet/tenant-db.js";

const C = schema.customers;
type Row = typeof C.$inferSelect;
const dto = (c: Row): Customer => ({ id: c.id, name: c.name, contactName: c.contactName, phone: c.phone, email: c.email, notes: c.notes, status: c.status });
const taken = (e: unknown) => {
  if (uniqueViolation(e)) throw conflict("customer_name_taken", "A customer with this name exists", { name: "taken" });
  throw e;
};

/** Owner decision (14 Nov 2026): customers are data only (no sign-in); tasks are done for them. */
@Controller()
export class CustomersController {
  constructor(private readonly tdb: TenantDb) {}

  @Requires("customer.read", "task.write") @Get(routes.listCustomers.path)
  async list(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return { items: (await db.select().from(C).orderBy(asc(C.name))).map(dto) };
  }

  @Requires("customer.write") @Post(routes.createCustomer.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createCustomer.body)) b: z.output<typeof routes.createCustomer.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const id = newId();
    const [row] = await db.insert(C).values({
      id, name: b.name, contactName: b.contactName || null, phone: b.phone || null, email: b.email || null, notes: b.notes || null, createdBy: ctx.identityId,
    }).returning().catch(taken);
    await TenantDb.audit(db, ctx, "customer.created", "customer", id, dto(row!));
    return dto(row!);
  }

  @Requires("customer.write") @Patch(routes.updateCustomer.path)
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateCustomer.body)) b: z.output<typeof routes.updateCustomer.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const [before] = await db.select().from(C).where(eq(C.id, id));
    if (!before) throw notFound("customer");
    const set: Partial<Row> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    for (const k of ["contactName", "phone", "email", "notes"] as const) if (b[k] !== undefined) set[k] = b[k] || null;
    if (b.status) set.status = b.status;
    const [row] = await db.update(C).set(set).where(eq(C.id, id)).returning().catch(taken);
    await TenantDb.audit(db, ctx, "customer.updated", "customer", id, dto(row!), dto(before));
    return dto(row!);
  }
}
