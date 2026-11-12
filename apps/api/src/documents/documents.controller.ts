import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { and, desc, eq, inArray, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import type { z } from "zod";
import { COUNTRY_TEMPLATES, DEFAULTS } from "@fleet/config";
import { routes, type Document, type DocumentType } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
import {
  authorize, branchFilter, canAccessBranch, canTransitionDocument, checkTypeSetting, documentValidity, driverCan,
  effectiveDocumentTypes, localDate, sniffMime, type EffectiveDocumentType,
} from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { AppError, conflict, forbidden, notFound, uniqueViolation, validation } from "../infra/errors.js";
import { TenantKeys } from "../infra/tenant-keys.js";
import { STORAGE } from "../infra/tokens.js";
import { decryptFile, encryptFile, type ObjectStorage } from "../files/storage.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { loadDocumentTypes } from "./document-types.js";
import { readCapped } from "../files/read-capped.js";
import { driverVehicleIds } from "../m2/common.js";

const DOC = schema.documents;
type DocRow = typeof DOC.$inferSelect;
type EntityType = "vehicle" | "driver";
interface EntityRef { type: EntityType; id: string; branchId: string }

/**
 * Documents (E11). Rules that matter for trust:
 *  - Maker ≠ Checker on verify/reject (GEN-004), also enforced by a DB CHECK.
 *  - Validity (dates) is separate from verification status (DOC-004).
 *  - Sensitive types (drug test, criminal record…) only for roles with driver.view_sensitive (DRV-007).
 *  - Drivers see documents of their vehicles/themselves per type visibility; view ≠ download (DOC-007).
 *  - Files are type-sniffed, size-capped, encrypted per tenant, and every download is audited (DOC-008).
 */
@Controller()
export class DocumentsController {
  constructor(
    private readonly tdb: TenantDb,
    private readonly keys: TenantKeys,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  // ------------------------------------------------------------------ types
  private types(db: Db) {
    return loadDocumentTypes(db);
  }

  private canSeeSensitive(ctx: RequestContext) {
    return authorize(ctx.role, "driver.view_sensitive").allowed;
  }

  /** Types this user may see at all. */
  private typeVisible(ctx: RequestContext, t: EffectiveDocumentType) {
    if (t.sensitive && !this.canSeeSensitive(ctx)) return false;
    if (ctx.role === "driver") return driverCan(t.driverVisibility, "view");
    return true;
  }

  private toType(t: EffectiveDocumentType): DocumentType {
    return {
      code: t.code, entityType: t.entityType, name: t.name, mandatory: t.mandatory, countryMandatory: t.countryMandatory, hasExpiry: t.hasExpiry,
      risk: t.risk, driverVisibility: t.driverVisibility, sensitive: t.sensitive, source: t.source, active: t.active,
    };
  }

  @Requires("document.read") @Get(routes.listDocumentTypes.path)
  async listTypes(@Ctx() ctx: RequestContext) {
    const { types } = await this.types(await this.tdb.for(ctx));
    return { items: types.filter((t) => this.typeVisible(ctx, t)).map((t) => this.toType(t)) };
  }

  @Requires("document_type.manage") @Post(routes.createDocumentType.path) @HttpCode(201)
  async createType(@Body(new ZodPipe(routes.createDocumentType.body)) b: z.output<typeof routes.createDocumentType.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const code = `C_${b.code}`;
    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.documentTypes).values({
          code, entityType: b.entityType, nameAr: b.nameAr, nameEn: b.nameEn, mandatory: b.mandatory, hasExpiry: b.hasExpiry, risk: b.risk,
          driverVisibility: b.sensitive ? "none" : b.driverVisibility, sensitive: b.sensitive, createdBy: ctx.identityId,
        });
        await TenantDb.audit(tx, ctx, "document_type.created", "document_type", newId(), { ...b, code });
      });
    } catch (e) {
      if (uniqueViolation(e)) throw conflict("duplicate", "A document type with this code exists", { code: "taken" });
      throw e;
    }
    return this.toType((await this.types(db)).byCode.get(code)!);
  }

  /** US-E03-02: the company may tighten a country type, never relax it; custom types are fully editable. */
  @Requires("document_type.manage") @Patch(routes.updateDocumentType.path)
  async updateType(@Param("code") code: string, @Body(new ZodPipe(routes.updateDocumentType.body)) b: z.output<typeof routes.updateDocumentType.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const { byCode } = await this.types(db);
    const t = byCode.get(code);
    if (!t) throw notFound("document type");
    if (t.source === "country") {
      if (b.active === false) throw validation({ active: "country_type" });
      const country = { ...t, mandatory: t.countryMandatory };
      const err = checkTypeSetting(country, { mandatory: b.mandatory, driverVisibility: b.driverVisibility });
      if (err) throw validation({ [err === "country_mandatory" ? "mandatory" : "driverVisibility"]: err });
      await db.transaction(async (tx) => {
        await tx.insert(schema.documentTypeSettings).values({ code, mandatory: b.mandatory ?? null, driverVisibility: b.driverVisibility ?? null, updatedBy: ctx.identityId })
          .onConflictDoUpdate({
            target: schema.documentTypeSettings.code,
            set: {
              ...(b.mandatory !== undefined ? { mandatory: b.mandatory } : {}),
              ...(b.driverVisibility !== undefined ? { driverVisibility: b.driverVisibility } : {}),
              updatedBy: ctx.identityId, updatedAt: new Date(),
            },
          });
        await TenantDb.audit(tx, ctx, "document_type.setting_changed", "document_type", newId(), { code, ...b });
      });
    } else {
      if (t.sensitive && b.driverVisibility && b.driverVisibility !== "none") throw validation({ driverVisibility: "sensitive_not_visible" });
      await db.transaction(async (tx) => {
        await tx.update(schema.documentTypes).set({
          ...(b.mandatory !== undefined ? { mandatory: b.mandatory } : {}),
          ...(b.driverVisibility !== undefined ? { driverVisibility: b.driverVisibility } : {}),
          ...(b.active !== undefined ? { status: b.active ? "active" : "inactive" } : {}),
        }).where(eq(schema.documentTypes.code, code));
        await TenantDb.audit(tx, ctx, "document_type.updated", "document_type", newId(), { code, ...b });
      });
    }
    return this.toType((await this.types(db)).byCode.get(code)!);
  }

  // ------------------------------------------------------------------ entity scope
  private async entity(db: Db | Tx, type: EntityType, id: string): Promise<EntityRef & { status: string } | null> {
    if (type === "vehicle") {
      const [v] = await db.select({ branchId: schema.vehicles.branchId, status: schema.vehicles.status }).from(schema.vehicles).where(eq(schema.vehicles.id, id));
      return v ? { type, id, ...v } : null;
    }
    const [d] = await db.select({ branchId: schema.drivers.branchId, status: schema.drivers.employmentStatus }).from(schema.drivers).where(eq(schema.drivers.id, id));
    return d ? { type, id, ...d } : null;
  }

  /** Can this user act on documents of this entity, for the scope granted to the current action? */
  private async entityInScope(db: Db | Tx, ctx: RequestContext, e: EntityRef & { status: string }): Promise<boolean> {
    const scope = ctx.scope!;
    if (ctx.role === "driver") {
      if (e.type === "driver") return e.id === ctx.driverId;
      // "assigned": vehicles the driver holds an active assignment on (E07).
      return scope === "assigned" && e.status === "active" && (await driverVehicleIds(db, ctx.driverId)).includes(e.id);
    }
    return canAccessBranch(ctx, scope, e.branchId);
  }

  private async loadInScope(db: Db | Tx, ctx: RequestContext, id: string, lock = false) {
    const q = db.select().from(DOC).where(eq(DOC.id, id));
    const [d] = lock ? await q.for("update") : await q;
    if (!d) throw notFound("document");
    const e = await this.entity(db, d.entityType, d.entityId);
    if (!e || !(await this.entityInScope(db, ctx, e))) throw notFound("document");
    return { doc: d, entity: e };
  }

  private toDoc(d: DocRow, ctx: RequestContext, t: EffectiveDocumentType | undefined, today: string): Document {
    const canDownload = !!d.fileKey && authorize(ctx.role, "document.download").allowed && (ctx.role !== "driver" || (!!t && driverCan(t.driverVisibility, "download")));
    return {
      id: d.id, entityType: d.entityType, entityId: d.entityId, typeCode: d.typeCode, number: d.number, issueDate: d.issueDate, expiryDate: d.expiryDate,
      version: d.version, status: d.status, validity: documentValidity(d.expiryDate, today, DEFAULTS.DOC_LEAD_DAYS, DEFAULTS.DOC_GRACE_DAYS),
      file: d.fileKey && d.fileName && d.fileMime && d.fileSize ? { name: d.fileName, mime: d.fileMime, size: d.fileSize } : null,
      createdBy: d.createdBy, createdAt: d.createdAt.toISOString(), verifiedBy: d.verifiedBy, verifiedAt: d.verifiedAt?.toISOString() ?? null,
      rejectionReason: d.rejectionReason, supersededBy: d.supersededBy, canDownload,
    };
  }

  // ------------------------------------------------------------------ list
  @Requires("document.read") @Get(routes.listDocuments.path)
  async list(@Query(new ZodPipe(routes.listDocuments.query)) q: z.output<typeof routes.listDocuments.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const { types, byCode, today } = await this.types(db);
    const visibleCodes = types.filter((t) => this.typeVisible(ctx, t)).map((t) => t.code);
    if (!visibleCodes.length) return { items: [], missingMandatory: [] };
    const where: SQL[] = [inArray(DOC.typeCode, visibleCodes)];
    if (q.status) where.push(eq(DOC.status, q.status));
    else if (q.includeHistory !== "true") where.push(notInArray(DOC.status, ["superseded"]));
    if (ctx.role === "driver") where.push(inArray(DOC.status, ["verified", "pending"]));

    if (q.entityType && q.entityId) {
      const e = await this.entity(db, q.entityType, q.entityId);
      if (!e || !(await this.entityInScope(db, ctx, e))) throw notFound(q.entityType);
      where.push(eq(DOC.entityType, q.entityType), eq(DOC.entityId, q.entityId));
      const rows = await db.select().from(DOC).where(and(...where)).orderBy(DOC.typeCode, desc(DOC.version));
      const present = new Set(rows.filter((r) => r.status === "pending" || r.status === "verified").map((r) => r.typeCode));
      const missingMandatory = ctx.role === "driver" ? [] : types
        .filter((t) => t.entityType === q.entityType && t.mandatory && t.active && this.typeVisible(ctx, t) && !present.has(t.code))
        .map((t) => t.code);
      return { items: rows.map((r) => this.toDoc(r, ctx, byCode.get(r.typeCode), today)), missingMandatory };
    }
    if (q.entityType || q.entityId) throw validation({ entityId: "entity_type_and_id_together" });
    if (ctx.role === "driver") throw validation({ entityId: "required" });

    // Queue views (e.g. pending verification) across the user's branches.
    const filter = branchFilter(ctx, ctx.scope!);
    if (filter && !filter.length) return { items: [], missingMandatory: [] };
    if (filter) {
      const branchList = sql`ARRAY[${sql.join(filter.map((b) => sql`${b}::uuid`), sql`, `)}]::uuid[]`;
      where.push(sql`(
        (${DOC.entityType} = 'vehicle' AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = ${DOC.entityId} AND v.branch_id = ANY(${branchList})))
        OR (${DOC.entityType} = 'driver' AND EXISTS (SELECT 1 FROM drivers d WHERE d.id = ${DOC.entityId} AND d.branch_id = ANY(${branchList}))))`);
    }
    const rows = await db.select().from(DOC).where(and(...where)).orderBy(desc(DOC.createdAt)).limit(200);
    return { items: rows.map((r) => this.toDoc(r, ctx, byCode.get(r.typeCode), today)), missingMandatory: [] };
  }

  // ------------------------------------------------------------------ create / upload / submit
  @Requires("document.upload") @Post(routes.createDocument.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createDocument.body)) b: z.output<typeof routes.createDocument.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const { byCode, today, country } = await this.types(db);
    const t = byCode.get(b.typeCode);
    if (!t || !t.active || !this.typeVisible(ctx, t)) throw validation({ typeCode: "unknown_document_type" });
    if (t.entityType !== b.entityType) throw validation({ typeCode: "wrong_entity_type" });
    if (t.hasExpiry && !b.expiryDate) throw validation({ expiryDate: "required" });
    if (!t.hasExpiry && b.expiryDate) throw validation({ expiryDate: "not_applicable" });
    if (b.issueDate && b.issueDate > today) throw validation({ issueDate: "future_not_allowed" });
    if (b.issueDate && b.expiryDate && b.expiryDate < b.issueDate) throw validation({ expiryDate: "before_issue_date" });
    if (ctx.role === "driver" && !(b.entityType === "driver" && b.entityId === ctx.driverId)) throw forbidden("Drivers can only upload their own documents");

    return db.transaction(async (tx) => {
      const e = await this.entity(tx, b.entityType, b.entityId);
      if (!e || !(await this.entityInScope(db, ctx, e))) throw notFound(b.entityType);
      if (e.type === "vehicle" && e.status === "disposed") throw conflict("vehicle_disposed", "Cannot add documents to a disposed vehicle");
      // Serialize versions per entity+type.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${b.entityId}:${b.typeCode}`}))`);
      const [{ v }] = (await tx.select({ v: sql<number>`coalesce(max(${DOC.version}), 0)::int` }).from(DOC)
        .where(and(eq(DOC.entityType, b.entityType), eq(DOC.entityId, b.entityId), eq(DOC.typeCode, b.typeCode)))) as [{ v: number }];
      const [row] = await tx.insert(DOC).values({
        id: b.id ?? newId(), entityType: b.entityType, entityId: b.entityId, typeCode: b.typeCode, number: b.number ?? null,
        issueDate: b.issueDate ?? null, expiryDate: b.expiryDate ?? null, countryCode: country.code, version: v + 1, status: "draft", createdBy: ctx.identityId,
      }).returning();
      await TenantDb.audit(tx, ctx, "document.created", "document", row!.id, { typeCode: b.typeCode, entityType: b.entityType, entityId: b.entityId, version: v + 1 }, null, e.branchId);
      return this.toDoc(row!, ctx, t, today);
    });
  }

  /** Raw body upload, read with a hard size cap; the type is detected from the bytes (US-E11-02). */
  @Requires("document.upload") @Post(routes.uploadDocumentFile.path) @HttpCode(200)
  async upload(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request, @Ctx() ctx: RequestContext) {
    const bytes = await readCapped(req, DEFAULTS.FILE_DOC_MAX_BYTES);
    if (!bytes.length) throw validation({ file: "required" });
    const mime = sniffMime(bytes);
    if (!mime || !DEFAULTS.FILE_DOC_MIME_TYPES.includes(mime)) {
      throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_file_type", "Only PDF, JPG and PNG files are allowed");
    }
    const rawName = decodeURIComponent(String(req.headers["x-file-name"] ?? "document"));
    const fileName = rawName.replace(/[\\/\u0000-\u001f"]/g, "_").slice(0, 200) || "document";

    const db = await this.tdb.for(ctx);
    const tenantId = tenantOf(ctx);
    const { byCode, today } = await this.types(db);
    const crypto = await this.keys.for(tenantId);
    return db.transaction(async (tx) => {
      const { doc, entity } = await this.loadInScope(tx, ctx, id, true);
      if (doc.status !== "draft") throw conflict("not_draft", "The file can only be changed while the document is a draft");
      if (ctx.role === "driver" && doc.createdBy !== ctx.identityId) throw notFound("document");
      const key = `t/${tenantId}/documents/${doc.id}/${randomBytes(8).toString("hex")}`;
      await this.storage.put(key, encryptFile(crypto.fileKey, bytes));
      const [row] = await tx.update(DOC).set({
        fileKey: key, fileName, fileMime: mime, fileSize: bytes.length, fileSha256: createHash("sha256").update(bytes).digest("hex"),
      }).where(eq(DOC.id, id)).returning();
      await TenantDb.audit(tx, ctx, "document.file_uploaded", "document", id, { fileName, mime, size: bytes.length }, null, entity.branchId);
      return this.toDoc(row!, ctx, byCode.get(row!.typeCode), today);
    });
  }

  @Requires("document.upload") @Post(routes.submitDocument.path) @HttpCode(200)
  async submit(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    return this.transition(ctx, id, "pending", async (doc) => {
      if (!doc.fileKey) throw validation({ file: "required" });
      if (ctx.role === "driver" && doc.createdBy !== ctx.identityId) throw notFound("document");
      return { submittedAt: new Date() };
    });
  }

  // ------------------------------------------------------------------ verify / reject (Maker ≠ Checker)
  @Requires("document.verify") @Post(routes.verifyDocument.path) @HttpCode(200)
  async verify(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    return this.transition(ctx, id, "verified", async (doc, tx) => {
      this.makerChecker(ctx, doc);
      // DOC-005: the previous verified version becomes Superseded but stays readable.
      await tx.update(DOC).set({ status: "superseded", supersededBy: doc.id })
        .where(and(eq(DOC.entityType, doc.entityType), eq(DOC.entityId, doc.entityId), eq(DOC.typeCode, doc.typeCode), eq(DOC.status, "verified"), ne(DOC.id, doc.id)));
      return { verifiedBy: ctx.identityId, verifiedAt: new Date() };
    });
  }

  @Requires("document.verify") @Post(routes.rejectDocument.path) @HttpCode(200)
  async reject(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.rejectDocument.body)) b: z.output<typeof routes.rejectDocument.body>, @Ctx() ctx: RequestContext) {
    return this.transition(ctx, id, "rejected", async (doc) => {
      this.makerChecker(ctx, doc);
      return { verifiedBy: ctx.identityId, verifiedAt: new Date(), rejectionReason: b.reason };
    });
  }

  private makerChecker(ctx: RequestContext, doc: DocRow) {
    if (doc.createdBy === ctx.identityId) throw new AppError(HttpStatus.FORBIDDEN, "maker_checker", "You cannot verify a record you created");
  }

  private async transition(ctx: RequestContext, id: string, to: "pending" | "verified" | "rejected", apply: (doc: DocRow, tx: Tx) => Promise<Partial<DocRow>>) {
    const db = await this.tdb.for(ctx);
    const { byCode, today } = await this.types(db);
    return db.transaction(async (tx) => {
      const { doc, entity } = await this.loadInScope(tx, ctx, id, true);
      if (!canTransitionDocument(doc.status, to)) throw conflict("invalid_transition", `A ${doc.status} document cannot become ${to}`);
      const t = byCode.get(doc.typeCode);
      if (t && !this.typeVisible(ctx, t)) throw notFound("document");
      const extra = await apply(doc, tx);
      const [row] = await tx.update(DOC).set({ status: to, ...extra }).where(eq(DOC.id, id)).returning();
      await TenantDb.audit(tx, ctx, `document.${to === "pending" ? "submitted" : to}`, "document", id,
        { status: to, ...(extra.rejectionReason ? { reason: extra.rejectionReason } : {}) }, { status: doc.status }, entity.branchId);
      return this.toDoc(row!, ctx, t, today);
    });
  }

  // ------------------------------------------------------------------ download (audited)
  @Requires("document.download") @Get(routes.downloadDocument.path)
  async download(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext, @Res() res: Response) {
    const db = await this.tdb.for(ctx);
    const { byCode } = await this.types(db);
    const { doc, entity } = await this.loadInScope(db, ctx, id);
    const t = byCode.get(doc.typeCode);
    if (!t || !this.typeVisible(ctx, t)) throw notFound("document");
    if (ctx.role === "driver") {
      if (!driverCan(t.driverVisibility, "download")) throw forbidden("This document can be viewed but not downloaded");
      if (doc.status !== "verified" && doc.status !== "pending") throw notFound("document");
    }
    if (!doc.fileKey || !doc.fileMime) throw notFound("file");
    const plain = decryptFile((await this.keys.for(tenantOf(ctx))).fileKey, await this.storage.get(doc.fileKey));
    await TenantDb.audit(db, ctx, "document.downloaded", "document", id, { fileName: doc.fileName }, null, entity.branchId);
    res.setHeader("content-type", doc.fileMime);
    res.setHeader("content-length", String(plain.length));
    res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName ?? "document")}`);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "private, no-store");
    res.end(plain);
  }
}
