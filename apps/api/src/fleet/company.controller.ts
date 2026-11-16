import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { randomBytes } from "node:crypto";
import { routes, type CompanyProfile } from "@fleet/contracts";
import { schema, type Db } from "@fleet/db";
import { sniffMime } from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB, STORAGE } from "../infra/tokens.js";
import { AppError, notFound, validation } from "../infra/errors.js";
import { TenantDb } from "./tenant-db.js";
import { TenantKeys } from "../infra/tenant-keys.js";
import { decryptFile, encryptFile, type ObjectStorage } from "../files/storage.js";
import { readCapped } from "../files/read-capped.js";

const S = schema;
const LOGO_MAX_BYTES = 1024 * 1024;
type Row = typeof S.company.$inferSelect;

const dto = (c: Row): CompanyProfile => ({
  name: c.name, countryCode: c.countryCode, currency: c.currency, timezone: c.timezone,
  address: c.address, phone: c.phone, email: c.email, commercialRegister: c.commercialRegister, taxNumber: c.taxNumber,
  hasLogo: !!c.logoFileKey, updatedAt: c.updatedAt.toISOString(),
});

/** Owner decision (14 Nov 2026): the company admin keeps the company profile up to date; everyone in it can see it. */
@Controller()
export class CompanyController {
  constructor(
    @Inject(CONTROL_DB) private readonly control: Db,
    private readonly tdb: TenantDb,
    private readonly keys: TenantKeys,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private async row(db: Db): Promise<Row> {
    const [c] = await db.select().from(S.company).limit(1);
    if (!c) throw notFound("company");
    return c;
  }

  @Get(routes.getCompany.path)
  async get(@Ctx() ctx: RequestContext) {
    if (!ctx.tenantId) throw notFound("company");
    return dto(await this.row(await this.tdb.for(ctx)));
  }

  @Requires("company.manage") @Patch(routes.updateCompany.path)
  async update(@Body(new ZodPipe(routes.updateCompany.body)) b: z.output<typeof routes.updateCompany.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const before = await this.row(db);
    const set: Partial<Row> = { updatedAt: new Date() };
    if (b.name !== undefined) set.name = b.name;
    for (const k of ["address", "phone", "email", "commercialRegister", "taxNumber"] as const) {
      if (b[k] !== undefined) set[k] = b[k] || null;
    }
    const [after] = await db.update(S.company).set(set).where(eq(S.company.id, before.id)).returning();
    // The platform keeps the company name for its own lists, sign-in and emails.
    if (b.name && b.name !== before.name) await this.control.update(S.tenants).set({ name: b.name, updatedAt: new Date() }).where(eq(S.tenants.id, tenantOf(ctx)));
    const pick = (c: Row) => ({ name: c.name, address: c.address, phone: c.phone, email: c.email, commercialRegister: c.commercialRegister, taxNumber: c.taxNumber });
    await TenantDb.audit(db, ctx, "company.updated", "company", before.id, pick(after!), pick(before));
    return dto(after!);
  }

  /** PNG or JPG up to 1 MB, detected from the bytes; stored encrypted like every company file. */
  @Requires("company.manage") @Post(routes.uploadCompanyLogo.path) @HttpCode(200)
  async uploadLogo(@Req() req: Request, @Ctx() ctx: RequestContext) {
    const bytes = await readCapped(req, LOGO_MAX_BYTES);
    if (!bytes.length) throw validation({ file: "required" });
    const mime = sniffMime(bytes);
    if (mime !== "image/png" && mime !== "image/jpeg") throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_file_type", "Only PNG and JPG logos are allowed");
    const tenantId = tenantOf(ctx);
    const db = await this.tdb.for(ctx);
    const c = await this.row(db);
    const key = `t/${tenantId}/company/logo-${randomBytes(8).toString("hex")}`;
    await this.storage.put(key, encryptFile((await this.keys.for(tenantId)).fileKey, bytes));
    const [after] = await db.update(S.company).set({ logoFileKey: key, logoMime: mime, updatedAt: new Date() }).where(eq(S.company.id, c.id)).returning();
    await TenantDb.audit(db, ctx, "company.logo_uploaded", "company", c.id, { mime, size: bytes.length });
    return dto(after!);
  }

  @Get(routes.companyLogo.path)
  async logo(@Ctx() ctx: RequestContext, @Res() res: Response) {
    if (!ctx.tenantId) throw notFound("company");
    const c = await this.row(await this.tdb.for(ctx));
    if (!c.logoFileKey || !c.logoMime) throw notFound("logo");
    const plain = decryptFile((await this.keys.for(tenantOf(ctx))).fileKey, await this.storage.get(c.logoFileKey));
    res.setHeader("content-type", c.logoMime);
    res.setHeader("content-length", String(plain.length));
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "private, max-age=300");
    res.end(plain);
  }
}
