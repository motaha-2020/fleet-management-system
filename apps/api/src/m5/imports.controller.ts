import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { Response } from "express";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { and, desc, eq, ne, inArray } from "drizzle-orm";
import type { z } from "zod";
import { COST_CATEGORIES, IMPORT_ENTITIES, routes, type ImportBatch } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter, canAccessBranch, localDate } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { AppError, conflict, notFound, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { companyOf, iso, type DbOrTx } from "../m2/common.js";
import { MeterService } from "../m2/meter.service.js";
import { VehiclesController } from "../fleet/vehicles.controller.js";
import { DriversController } from "../fleet/drivers.controller.js";
import { FinesController } from "./fines.controller.js";
import { OpsLog } from "../infra/ops-log.js";

type ImportEntity = (typeof IMPORT_ENTITIES)[number];
const B = schema.importBatches;
type BatchRow = typeof B.$inferSelect;
type RowErr = { row: number; column: string; code: string };
const MAX_ROWS = 5_000;
const PREVIEW = 50;

/** IMP-001: the official template of each entity (column order of the CSV). */
export const TEMPLATES: Record<ImportEntity, readonly string[]> = {
  vehicles: ["branch", "fleetNumber", "registrationNumber", "vin", "make", "model", "year", "primaryFuelType", "primaryTankCapacity", "secondaryFuelType", "secondaryTankCapacity", "meterType", "requiredLicenseCategory", "ownershipType"],
  drivers: ["branch", "fullName", "username", "phone", "employeeRef", "nationalId", "licenseNumber", "licenseCategories", "licenseExpiry"],
  opening_odometer: ["vehicle", "value", "date"],
  fines: ["vehicle", "violationAt", "amount", "authorityRef", "dueDate", "description"],
  costs: ["vehicle", "branch", "category", "net", "tax", "expenseDate", "eInvoiceUuid", "description"],
};
const REQUIRED: Record<ImportEntity, readonly string[]> = {
  vehicles: ["branch", "fleetNumber", "registrationNumber", "make", "model", "year", "primaryFuelType", "primaryTankCapacity", "requiredLicenseCategory"],
  drivers: ["branch", "fullName", "username"],
  opening_odometer: ["vehicle", "value", "date"],
  fines: ["vehicle", "violationAt", "amount"],
  costs: ["category", "net", "expenseDate"],
};
/** IMP-003: financial records are all-or-nothing. */
const FINANCIAL: readonly ImportEntity[] = ["fines", "costs"];

// ---------------------------------------------------------------- parsing

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

async function parseFile(name: string, bytes: Buffer): Promise<string[][]> {
  if (bytes.subarray(0, 2).toString() === "PK" || /\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const out: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = (r.values as unknown[]).slice(1).map((v) => {
        if (v == null) return "";
        if (v instanceof Date) return v.toISOString();
        if (typeof v === "object" && v && "text" in v) return String((v as { text: unknown }).text);
        if (typeof v === "object" && v && "result" in v) return String((v as { result: unknown }).result);
        return String(v);
      });
      out.push(vals);
    });
    return out;
  }
  return parseCsv(bytes.toString("utf8"));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]/g, "");

/**
 * E17 import (IMP-001..006): Upload → Mapping → Preview → Validation → Error review → Approval → Import → Audit.
 * Rows go through the same rules as the screens (the same create paths). Financial batches are all-or-nothing in
 * one transaction; master data may be partial, with the rejected rows downloadable. A batch whose records are
 * still unused can be rolled back.
 */
@Controller()
export class ImportsController {
  constructor(private readonly tdb: TenantDb, private readonly meter: MeterService, private readonly modules: ModuleRef, private readonly ops: OpsLog) {}

  private dto(b: BatchRow, canRollback = false): ImportBatch {
    return {
      id: b.id, entity: b.entity, mode: b.mode, status: b.status, fileName: b.fileName, rowCount: b.rowCount, errorCount: b.errorCount, importedCount: b.importedCount,
      mapping: b.mapping, errors: b.errors, preview: b.rows.slice(0, PREVIEW), createdBy: b.createdBy, createdAt: b.createdAt.toISOString(),
      importedAt: iso(b.importedAt), rolledBackAt: iso(b.rolledBackAt), rollbackReason: b.rollbackReason, canRollback,
    };
  }

  private async load(db: DbOrTx, ctx: RequestContext, id: string, lock = false) {
    const q = db.select().from(B).where(eq(B.id, id));
    const [b] = lock ? await q.for("update") : await q;
    const f = branchFilter(ctx, ctx.scope!);
    if (!b || (f && b.createdBy !== ctx.identityId && !b.branchIds.every((x) => f.includes(x)))) throw notFound("import");
    return b;
  }

  // ---------------------------------------------------------------- templates (declared before /imports/:id)

  @Requires("import.manage") @Get(routes.importTemplate.path)
  template(@Param("entity") entity: string, @Res() res: Response) {
    if (!(IMPORT_ENTITIES as readonly string[]).includes(entity)) throw notFound("template");
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${entity}_template.csv"`);
    res.end("﻿" + TEMPLATES[entity as ImportEntity].join(",") + "\r\n");
  }

  @Requires("import.manage") @Get(routes.listImports.path)
  async list(@Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const f = branchFilter(ctx, ctx.scope!);
    const rows = (await db.select().from(B).orderBy(desc(B.createdAt)).limit(200)).filter((b) => !f || b.createdBy === ctx.identityId || b.branchIds.every((x) => f.includes(x)));
    return { items: rows.map((b) => this.dto(b)) };
  }

  @Requires("import.manage") @Get(routes.getImport.path)
  async get(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const b = await this.load(db, ctx, id);
    return this.dto(b, (await this.rollbackBlockers(db, b)) === null);
  }

  // ---------------------------------------------------------------- upload, map, validate

  @Requires("import.manage") @Post(routes.createImport.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createImport.body)) b: z.output<typeof routes.createImport.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const bytes = Buffer.from(b.content, "base64");
    if (!bytes.length) throw validation({ content: "required" });
    let table: string[][];
    try { table = await parseFile(b.fileName, bytes); } catch { throw validation({ content: "unreadable_file" }); }
    if (table.length < 2) throw validation({ content: "no_rows" });
    if (table.length - 1 > MAX_ROWS) throw validation({ content: "too_many_rows" });
    const fields = TEMPLATES[b.entity];
    const header = table[0]!;
    // Mapping: explicit, else by name.
    const mapping: Record<string, string> = {};
    header.forEach((h) => {
      const explicit = b.mapping?.[h];
      const auto = fields.find((f) => norm(f) === norm(h));
      const target = explicit ?? auto;
      if (target && fields.includes(target)) mapping[h] = target;
    });
    const missing = REQUIRED[b.entity].filter((f) => !Object.values(mapping).includes(f));
    if (missing.length) throw validation({ mapping: `missing:${missing.join("|")}` });
    const rows = table.slice(1).map((r) => Object.fromEntries(header.flatMap((h, i) => (mapping[h] ? [[mapping[h]!, (r[i] ?? "").trim()]] : []))) as Record<string, string>);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const { errors, branchIds } = await this.validate(db, ctx, b.entity, rows);
    // IMP-005: the same file again is detected before anything is imported.
    const [same] = await db.select({ id: B.id }).from(B).where(and(eq(B.entity, b.entity), eq(B.fileSha256, sha), inArray(B.status, ["imported", "partially_imported"])));
    if (same) errors.unshift({ row: 0, column: "file", code: `file_already_imported:${same.id}` });
    const mode = FINANCIAL.includes(b.entity) ? "all_or_nothing" : (b.mode ?? "partial");
    const [row] = await db.insert(B).values({
      id: newId(), entity: b.entity, mode, fileName: b.fileName, fileSha256: sha, mapping, rows, errors, rowCount: rows.length,
      errorCount: new Set(errors.map((e) => e.row)).size, branchIds: [...new Set(branchIds)], createdBy: ctx.identityId,
    }).returning();
    await TenantDb.audit(db, ctx, "import.validated", "import_batch", row!.id, { entity: b.entity, rows: rows.length, errors: row!.errorCount, mode });
    return this.dto(row!);
  }

  /** Field-level checks before anything is saved (IMP-002 "Validation → Error review"). */
  private async validate(db: DbOrTx, ctx: RequestContext, entity: ImportEntity, rows: Record<string, string>[]) {
    const errors: RowErr[] = [];
    const branchIds: string[] = [];
    const err = (row: number, column: string, code: string) => errors.push({ row, column, code });
    const { country, company } = await companyOf(db);
    const branches = await db.select().from(schema.branches);
    const vehicles = await db.select().from(schema.vehicles);
    const branchOf = (code: string) => branches.find((b) => b.code.toLowerCase() === code.toLowerCase());
    const vehicleOf = (ref: string) => vehicles.find((v) => v.fleetNumber.toLowerCase() === ref.toLowerCase() || v.registrationNormalized === ref.replace(/\s+/g, "").toLowerCase());
    const num = (s: string) => (s === "" ? null : Number(s.replace(/,/g, "")));
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
    const seen = new Map<string, number>();
    const unique = (i: number, col: string, key: string) => {
      const k = `${col}:${key.toLowerCase()}`;
      if (seen.has(k)) err(i, col, `duplicate_in_file:${seen.get(k)}`); else seen.set(k, i);
    };
    const today = localDate(new Date(), company.timezone);
    const readings = entity === "opening_odometer" ? await db.select({ v: schema.meterReadings.vehicleId }).from(schema.meterReadings) : [];
    const fines = entity === "fines" ? await db.select({ ref: schema.fines.authorityRef }).from(schema.fines).where(eq(schema.fines.status, "active")) : [];
    const costs = entity === "costs" ? await db.select().from(schema.costRecords).where(eq(schema.costRecords.status, "active")) : [];
    const usernames = entity === "drivers" ? new Set((await db.select({ u: schema.drivers.username }).from(schema.drivers)).map((d) => (d.u ?? "").toLowerCase())) : new Set<string>();

    rows.forEach((r, idx) => {
      const i = idx + 1;
      for (const f of REQUIRED[entity]) if (!r[f]) err(i, f, "required");
      const scopeBranch = (col: string, branchId: string | undefined) => {
        if (!branchId) return;
        if (!canAccessBranch(ctx, ctx.scope!, branchId)) err(i, col, "out_of_scope");
        branchIds.push(branchId);
      };
      const needVehicle = (col = "vehicle") => {
        if (!r[col]) return undefined;
        const v = vehicleOf(r[col]!);
        if (!v) { err(i, col, "unknown_vehicle"); return undefined; }
        scopeBranch(col, v.branchId);
        return v;
      };
      switch (entity) {
        case "vehicles": {
          const b = r.branch ? branchOf(r.branch) : undefined;
          if (r.branch && !b) err(i, "branch", "unknown_branch");
          scopeBranch("branch", b?.id);
          if (r.fleetNumber) { unique(i, "fleetNumber", r.fleetNumber); if (vehicles.some((v) => v.fleetNumber.toLowerCase() === r.fleetNumber!.toLowerCase())) err(i, "fleetNumber", "duplicate"); }
          if (r.registrationNumber) unique(i, "registrationNumber", r.registrationNumber.replace(/\s+/g, ""));
          if (r.year && !Number.isInteger(num(r.year))) err(i, "year", "out_of_range");
          if (r.primaryFuelType && !country.fuelTypes.some((f) => f.code === r.primaryFuelType)) err(i, "primaryFuelType", "unknown_fuel_type");
          if (r.primaryTankCapacity && !(num(r.primaryTankCapacity)! > 0)) err(i, "primaryTankCapacity", "out_of_range");
          if (r.requiredLicenseCategory && !country.licenseCategories.some((l) => l.code === r.requiredLicenseCategory)) err(i, "requiredLicenseCategory", "unknown_license_category");
          if (r.meterType && !["distance", "hours", "both"].includes(r.meterType)) err(i, "meterType", "out_of_range");
          if (r.ownershipType && !["owned", "leased", "rented"].includes(r.ownershipType)) err(i, "ownershipType", "out_of_range");
          break;
        }
        case "drivers": {
          const b = r.branch ? branchOf(r.branch) : undefined;
          if (r.branch && !b) err(i, "branch", "unknown_branch");
          scopeBranch("branch", b?.id);
          if (r.username) { unique(i, "username", r.username); if (!/^[a-z0-9._-]{3,64}$/i.test(r.username)) err(i, "username", "invalid"); else if (usernames.has(r.username.toLowerCase())) err(i, "username", "taken"); }
          for (const c of (r.licenseCategories ?? "").split("|").filter(Boolean)) if (!country.licenseCategories.some((l) => l.code === c)) err(i, "licenseCategories", "unknown_license_category");
          if (r.licenseExpiry && !isDate(r.licenseExpiry)) err(i, "licenseExpiry", "invalid_date");
          break;
        }
        case "opening_odometer": {
          const v = needVehicle();
          if (v) { unique(i, "vehicle", v.id); if (readings.some((x) => x.v === v.id)) err(i, "vehicle", "has_readings"); }
          if (r.value && !(Number.isInteger(num(r.value)) && num(r.value)! >= 0)) err(i, "value", "out_of_range");
          if (r.date && !isDate(r.date)) err(i, "date", "invalid_date"); else if (r.date && r.date > today) err(i, "date", "future_not_allowed");
          break;
        }
        case "fines": {
          needVehicle();
          if (r.violationAt && Number.isNaN(Date.parse(r.violationAt))) err(i, "violationAt", "invalid_date");
          if (r.amount && !(num(r.amount)! > 0)) err(i, "amount", "out_of_range");
          if (r.dueDate && !isDate(r.dueDate)) err(i, "dueDate", "invalid_date");
          if (r.authorityRef) { unique(i, "authorityRef", r.authorityRef); if (fines.some((f) => f.ref === r.authorityRef)) err(i, "authorityRef", "duplicate"); }
          break;
        }
        case "costs": {
          const v = needVehicle();
          const b = !r.vehicle && r.branch ? branchOf(r.branch) : undefined;
          if (!r.vehicle && !r.branch) err(i, "vehicle", "required");
          if (!r.vehicle && r.branch && !b) err(i, "branch", "unknown_branch");
          scopeBranch("branch", b?.id);
          if (r.category && (!(COST_CATEGORIES as readonly string[]).includes(r.category) || r.category === "fuel")) err(i, "category", r.category === "fuel" ? "use_fuel_entries" : "out_of_range");
          const net = num(r.net ?? "");
          const tax = num(r.tax ?? "") ?? 0;
          if (r.net && !(net! >= 0)) err(i, "net", "out_of_range");
          if (r.tax && !(tax >= 0)) err(i, "tax", "out_of_range");
          if (r.expenseDate && !isDate(r.expenseDate)) err(i, "expenseDate", "invalid_date");
          // IMP-005: the same expense already recorded (e-invoice, or same vehicle/date/category/amount)
          if (r.eInvoiceUuid) { unique(i, "eInvoiceUuid", r.eInvoiceUuid); if (costs.some((c) => c.eInvoiceUuid === r.eInvoiceUuid)) err(i, "eInvoiceUuid", "duplicate"); }
          else if (v && net != null && costs.some((c) => c.vehicleId === v.id && c.expenseDate === r.expenseDate && c.category === r.category && c.netMinor === Math.round(net * 100))) err(i, "net", "duplicate");
          if (v && net != null && r.expenseDate) unique(i, "net", `${v.id}|${r.expenseDate}|${r.category}|${net}`);
          break;
        }
      }
    });
    return { errors, branchIds };
  }

  // ---------------------------------------------------------------- approve → import

  @Requires("import.manage") @Post(routes.approveImport.path) @HttpCode(200)
  async approve(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const b = await this.load(db, ctx, id);
    if (b.status !== "validated") throw conflict("invalid_transition", `A ${b.status} batch cannot be imported`);
    if (b.errors.some((e) => e.row === 0)) throw new AppError(422, "file_already_imported", "This file was already imported", { file: b.errors.find((e) => e.row === 0)!.code });
    const bad = new Set(b.errors.map((e) => e.row));
    if (b.mode === "all_or_nothing" && bad.size) throw new AppError(422, "batch_has_errors", "Fix the errors: financial batches are imported all or nothing", { errors: String(bad.size) });
    const toImport = b.rows.map((r, idx) => ({ r, i: idx + 1 })).filter((x) => !bad.has(x.i));
    const results: { row: number; entityType: string; id: string }[] = [];
    const late: RowErr[] = [];
    const fieldErr = (i: number, e: unknown) => {
      const body = (e as { getResponse?: () => { error?: { code?: string; fields?: Record<string, string> } } }).getResponse?.()?.error;
      const fields = Object.entries(body?.fields ?? {});
      if (fields.length) for (const [k, v] of fields) late.push({ row: i, column: k, code: v });
      else late.push({ row: i, column: "row", code: body?.code ?? "failed" });
    };

    if (b.mode === "all_or_nothing") {
      try {
        await db.transaction(async (tx) => {
          for (const { r, i } of toImport) {
            try { results.push(await this.importFinancial(tx, ctx, b, r)); } catch (e) { fieldErr(i, e); throw e; }
          }
        });
      } catch {
        results.length = 0;
      }
    } else {
      for (const { r, i } of toImport) {
        try { results.push({ ...(await this.importMaster(db, ctx, b, r)), row: i }); } catch (e) { fieldErr(i, e); }
      }
    }
    if (b.mode === "all_or_nothing") results.forEach((x, k) => (x.row = toImport[k]!.i));
    const errors = [...b.errors, ...late];
    const status = !results.length ? "failed" : results.length === b.rows.length ? "imported" : "partially_imported";
    const [row] = await db.update(B).set({
      status, results, errors, errorCount: new Set(errors.map((e) => e.row)).size, importedCount: results.length, importedBy: ctx.identityId, importedAt: new Date(),
    }).where(eq(B.id, id)).returning();
    await TenantDb.audit(db, ctx, "import.imported", "import_batch", id, { entity: b.entity, status, imported: results.length, rejected: b.rows.length - results.length });
    if (status !== "imported") {
      await this.ops.record({ tenantId: ctx.tenantId, kind: "import", severity: status === "failed" ? "error" : "warning", code: `${b.entity}:${status}`,
        detail: { batchId: id, rows: b.rows.length, imported: results.length, firstErrors: late.slice(0, 5) } });
    }
    if (status === "failed" && b.mode === "all_or_nothing") throw new AppError(422, "batch_has_errors", "Nothing was imported", { errors: String(late.length) });
    return this.dto(row!, (await this.rollbackBlockers(db, row!)) === null);
  }

  private async importFinancial(tx: Tx, ctx: RequestContext, b: BatchRow, r: Record<string, string>) {
    const vehicles = await tx.select().from(schema.vehicles);
    const v = r.vehicle ? vehicles.find((x) => x.fleetNumber.toLowerCase() === r.vehicle!.toLowerCase() || x.registrationNormalized === r.vehicle!.replace(/\s+/g, "").toLowerCase()) : undefined;
    const minor = (s: string | undefined) => Math.round(Number((s ?? "0").replace(/,/g, "")) * 100);
    if (b.entity === "fines") {
      const violationAt = /^\d{4}-\d{2}-\d{2}$/.test(r.violationAt!) ? `${r.violationAt}T12:00:00Z` : new Date(r.violationAt!).toISOString();
      const { row } = await FinesController.create(tx, ctx, {
        vehicleId: v!.id, violationAt, amountMinor: minor(r.amount), authorityRef: r.authorityRef || null, dueDate: r.dueDate || null, description: r.description || null,
      }, { source: "import", batchId: b.id });
      return { row: 0, entityType: "fine", id: row.id };
    }
    // costs
    const { country } = await companyOf(tx);
    const branchId = v ? v.branchId : (await tx.select().from(schema.branches)).find((x) => x.code.toLowerCase() === (r.branch ?? "").toLowerCase())!.id;
    const category = r.category as (typeof COST_CATEGORIES)[number];
    const id = newId();
    await tx.insert(schema.costRecords).values({
      id, category, vehicleId: v?.id ?? null, branchId, netMinor: minor(r.net), taxMinor: minor(r.tax), currency: country.currency, taxRecoverable: country.taxRecoverable[category],
      expenseDate: r.expenseDate!, sourceType: "manual", sourceId: null, eInvoiceUuid: r.eInvoiceUuid || null, description: r.description || null, flags: [],
      importBatchId: b.id, createdBy: ctx.identityId,
    });
    await TenantDb.audit(tx, ctx, "cost.created", "cost_record", id, { category, netMinor: minor(r.net), importBatchId: b.id }, null, branchId);
    return { row: 0, entityType: "cost_record", id };
  }

  /** Master data and opening balances: the same create paths as the screens (IMP-004: an opening reading is not an expense). */
  private async importMaster(db: DbOrTx, ctx: RequestContext, b: BatchRow, r: Record<string, string>) {
    const res = { status: () => res } as unknown as Response;
    const branches = await db.select().from(schema.branches);
    const branchId = () => branches.find((x) => x.code.toLowerCase() === (r.branch ?? "").toLowerCase())!.id;
    const n = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : null);
    if (b.entity === "vehicles") {
      const c = this.modules.get(VehiclesController, { strict: false });
      const body = routes.createVehicle.body.parse({
        branchId: branchId(), fleetNumber: r.fleetNumber, registrationNumber: r.registrationNumber, vin: r.vin || null, make: r.make, model: r.model, year: n(r.year),
        primaryFuelType: r.primaryFuelType, primaryTankCapacity: n(r.primaryTankCapacity), secondaryFuelType: r.secondaryFuelType || null, secondaryTankCapacity: n(r.secondaryTankCapacity),
        meterType: r.meterType || "distance", requiredLicenseCategory: r.requiredLicenseCategory, ownershipType: r.ownershipType || "owned",
      });
      const v = await c.create(body, ctx, res);
      return { row: 0, entityType: "vehicle", id: v.id };
    }
    if (b.entity === "drivers") {
      const c = this.modules.get(DriversController, { strict: false });
      const body = routes.createDriver.body.parse({
        branchId: branchId(), fullName: r.fullName, username: r.username, phone: r.phone || null, employeeRef: r.employeeRef || null, nationalId: r.nationalId || null,
        licenseNumber: r.licenseNumber || null, licenseCategories: (r.licenseCategories ?? "").split("|").filter(Boolean), licenseExpiry: r.licenseExpiry || null,
      });
      const d = await c.create(body, ctx, res);
      return { row: 0, entityType: "driver", id: d.id };
    }
    // opening_odometer
    return (db as Tx).transaction(async (tx) => {
      const vehicles = await tx.select().from(schema.vehicles);
      const v = vehicles.find((x) => x.fleetNumber.toLowerCase() === r.vehicle!.toLowerCase() || x.registrationNormalized === r.vehicle!.replace(/\s+/g, "").toLowerCase())!;
      await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, v.id)).for("update");
      const [any] = await tx.select({ id: schema.meterReadings.id }).from(schema.meterReadings).where(eq(schema.meterReadings.vehicleId, v.id)).limit(1);
      if (any) throw conflict("has_readings", "The vehicle already has readings", { vehicle: "has_readings" });
      const row = await this.meter.record(tx, { vehicleId: v.id, value: Number(r.value), at: new Date(`${r.date}T12:00:00Z`), sourceType: "opening", sourceId: null, createdBy: ctx.identityId });
      await TenantDb.audit(tx, ctx, "odometer.recorded", "vehicle", v.id, { value: Number(r.value), opening: true, importBatchId: b.id }, null, v.branchId);
      return { row: 0, entityType: "meter_reading", id: row.id };
    });
  }

  // ---------------------------------------------------------------- rejected rows & rollback

  @Requires("import.manage") @Get(routes.importRejected.path)
  async rejected(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext, @Res() res: Response) {
    const db = await this.tdb.for(ctx);
    const b = await this.load(db, ctx, id);
    const fields = TEMPLATES[b.entity];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [[...fields, "row", "errors"].join(",")];
    const bad = [...new Set(b.errors.filter((e) => e.row > 0).map((e) => e.row))].sort((x, y) => x - y);
    for (const i of bad) {
      const r = b.rows[i - 1] ?? {};
      lines.push([...fields.map((f) => esc(r[f] ?? "")), String(i), esc(b.errors.filter((e) => e.row === i).map((e) => `${e.column}:${e.code}`).join(" "))].join(","));
    }
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${b.entity}_rejected.csv"`);
    res.end("﻿" + lines.join("\r\n"));
  }

  /**
   * IMP-006: a batch can be undone while nothing has used its records; after that, corrections only.
   * Master data (vehicles, drivers) is not rolled back: records are never hard-deleted (Architecture §7).
   */
  private async rollbackBlockers(db: DbOrTx, b: BatchRow): Promise<string | null> {
    if (b.status !== "imported" && b.status !== "partially_imported") return "not_imported";
    if (b.entity === "vehicles" || b.entity === "drivers") return "master_data";
    const ids = b.results.map((r) => r.id);
    if (!ids.length) return null;
    if (b.entity === "costs") {
      const [corr] = await db.select({ id: schema.corrections.id }).from(schema.corrections).where(and(eq(schema.corrections.recordType, "cost_record"), inArray(schema.corrections.recordId, ids))).limit(1);
      return corr ? "records_in_use" : null;
    }
    if (b.entity === "fines") {
      const used = await db.select({ id: schema.fines.id }).from(schema.fines).where(and(inArray(schema.fines.id, ids), ne(schema.fines.paymentStatus, "unpaid")));
      return used.length ? "records_in_use" : null;
    }
    // opening readings: in use once the vehicle has any later reading
    const rs = await db.select().from(schema.meterReadings).where(inArray(schema.meterReadings.id, ids));
    for (const r of rs) {
      const [other] = await db.select({ id: schema.meterReadings.id }).from(schema.meterReadings).where(and(eq(schema.meterReadings.vehicleId, r.vehicleId), ne(schema.meterReadings.id, r.id))).limit(1);
      if (other) return "records_in_use";
    }
    return null;
  }

  @Requires("import.manage") @Post(routes.rollbackImport.path) @HttpCode(200)
  async rollback(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.rollbackImport.body)) body: z.output<typeof routes.rollbackImport.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const b = await this.load(tx, ctx, id, true);
      const blocker = await this.rollbackBlockers(tx, b);
      if (blocker) throw conflict(blocker === "not_imported" ? "invalid_transition" : blocker, "This batch cannot be rolled back");
      const ids = b.results.map((r) => r.id);
      if (ids.length) {
        if (b.entity === "costs") await tx.update(schema.costRecords).set({ status: "voided" }).where(inArray(schema.costRecords.id, ids));
        if (b.entity === "fines") {
          await tx.update(schema.fines).set({ status: "voided", voidReason: `Import rollback: ${body.reason}`, updatedAt: new Date() }).where(inArray(schema.fines.id, ids));
          await tx.update(schema.costRecords).set({ status: "voided" }).where(and(eq(schema.costRecords.sourceType, "fine"), inArray(schema.costRecords.sourceId, ids)));
        }
        if (b.entity === "opening_odometer") await tx.update(schema.meterReadings).set({ status: "excluded" }).where(inArray(schema.meterReadings.id, ids));
      }
      const [row] = await tx.update(B).set({ status: "rolled_back", rolledBackBy: ctx.identityId, rolledBackAt: new Date(), rollbackReason: body.reason }).where(eq(B.id, id)).returning();
      await TenantDb.audit(tx, ctx, "import.rolled_back", "import_batch", id, { entity: b.entity, records: ids.length, reason: body.reason });
      return this.dto(row!);
    });
  }
}
