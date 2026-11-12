import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import ExcelJS from "exceljs";
import { and, asc, desc, eq, gte, inArray, lt, lte, notInArray, or, isNull, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { REPORT_IDS, routes, type Report, type ReportId } from "@fleet/contracts";
import { schema } from "@fleet/db";
import { branchFilter, daysBetween, documentValidity, localDate, reportedCost } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { notFound, validation } from "../infra/errors.js";
import { TenantDb } from "../fleet/tenant-db.js";
import { companyOf, type DbOrTx } from "../m2/common.js";
import { zonedStart } from "../m2/costs.controller.js";
import { loadDocumentTypes } from "../documents/document-types.js";
import { MaintenanceService } from "../m4/maintenance.service.js";
import { DashboardService } from "./dashboard.service.js";

type Col = Report["columns"][number];
type Q = z.output<typeof routes.report.query>;
type Cell = string | number | null;
const MAX_ROWS = 20_000;

/** Column labels (AR/EN, NFR: the export speaks the user's language). */
const L: Record<string, [string, string]> = {
  date: ["التاريخ", "Date"], vehicle: ["المركبة", "Vehicle"], branch: ["الفرع", "Branch"], driver: ["السائق", "Driver"], fuelType: ["نوع الوقود", "Fuel type"],
  quantity: ["الكمية", "Quantity"], amount: ["المبلغ", "Amount"], status: ["الحالة", "Status"], flags: ["الملاحظات", "Flags"], odometer: ["العداد", "Odometer"],
  kind: ["النوع", "Kind"], type: ["النوع", "Type"], items: ["البنود", "Items"], due: ["الاستحقاق", "Due"], entity: ["السجل", "Record"], document: ["المستند", "Document"],
  expiry: ["تاريخ الانتهاء", "Expiry"], validity: ["الصلاحية", "Validity"], daysLeft: ["الأيام المتبقية", "Days left"], category: ["الفئة", "Category"],
  net: ["الصافي", "Net"], tax: ["الضريبة", "Tax"], gross: ["الإجمالي", "Gross"], reported: ["المحتسب", "Reported"], source: ["المصدر", "Source"],
  value: ["القراءة", "Reading"], reasons: ["الأسباب", "Reasons"], role: ["الدور", "Role"], start: ["البداية", "Start"], end: ["النهاية", "End"],
  actor: ["المستخدم", "Actor"], action: ["الإجراء", "Action"], ref: ["الرقم المرجعي", "Reference"], payment: ["السداد", "Payment"],
};

/**
 * E18 standard reports (RPT-001..007, + fines) and their Excel/CSV export (RPT-010). The same query feeds the
 * screen and the file, so totals match; rows are limited to the user's branches; every export is audited.
 */
@Controller()
export class ReportsController {
  constructor(private readonly tdb: TenantDb, private readonly dashboard: DashboardService, private readonly maintenance: MaintenanceService) {}

  private branches(ctx: RequestContext, branchId?: string): readonly string[] | null {
    const f = branchFilter(ctx, ctx.scope!);
    if (branchId) {
      if (f && !f.includes(branchId)) return [];
      return [branchId];
    }
    return f;
  }

  private async period(db: DbOrTx, q: { from?: string; to?: string }) {
    const { company } = await companyOf(db);
    const today = localDate(new Date(), company.timezone);
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    if (to < from) throw validation({ to: "before_from" });
    if (daysBetween(from, to) > 366) throw validation({ from: "range_too_long" });
    return { from, to, tz: company.timezone, start: zonedStart(from, company.timezone), end: zonedStart(new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), company.timezone) };
  }

  @Requires("report.read") @Get(routes.dashboard.path)
  async dash(@Query(new ZodPipe(routes.dashboard.query)) q: z.output<typeof routes.dashboard.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const p = await this.period(db, q);
    return this.dashboard.build(db, this.branches(ctx, q.branchId), p);
  }

  @Requires("report.read") @Get(routes.report.path)
  async report(@Param("id") id: string, @Query(new ZodPipe(routes.report.query)) q: Q, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return this.build(db, ctx, id, q);
  }

  @Requires("report.export") @Get(routes.exportReport.path)
  async export(@Param("id") id: string, @Query(new ZodPipe(routes.exportReport.query)) q: Q, @Ctx() ctx: RequestContext, @Res() res: Response) {
    const db = await this.tdb.for(ctx);
    const r = await this.build(db, ctx, id, q);
    const format = q.format ?? "xlsx";
    await TenantDb.audit(db, ctx, "report.exported", "report", ctx.identityId, { report: id, format, from: r.from, to: r.to, branchId: q.branchId ?? null, vehicleClass: q.vehicleClass ?? null, rows: r.rows.length });
    const name = `${id}_${r.from}_${r.to}.${format}`;
    res.setHeader("content-disposition", `attachment; filename="${name}"`);
    res.setHeader("cache-control", "private, no-store");
    if (format === "csv") {
      const esc = (v: Cell) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const lines = [r.columns.map((c) => esc(c.label)).join(","), ...r.rows.map((row) => r.columns.map((c) => esc(row[c.key] ?? null)).join(","))];
      res.setHeader("content-type", "text/csv; charset=utf-8");
      // BOM so Excel opens Arabic text as UTF-8
      res.end("﻿" + lines.join("\r\n"));
      return;
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(id, { views: [{ rightToLeft: (q.locale ?? "ar") === "ar" }] });
    ws.columns = r.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4) }));
    for (const row of r.rows) ws.addRow(Object.fromEntries(r.columns.map((c) => [c.key, c.type === "money" && typeof row[c.key] === "number" ? (row[c.key] as number) / 100 : row[c.key]])));
    if (Object.keys(r.totals).length) ws.addRow(Object.fromEntries(r.columns.map((c, i) => [c.key, i === 0 ? ((q.locale ?? "ar") === "ar" ? "الإجمالي" : "Total") : r.totals[c.key] != null ? (c.type === "money" ? r.totals[c.key]! / 100 : r.totals[c.key]) : null])));
    ws.getRow(1).font = { bold: true };
    res.setHeader("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  // ---------------------------------------------------------------- report builders

  private async build(db: DbOrTx, ctx: RequestContext, id: string, q: Q): Promise<Report> {
    if (!(REPORT_IDS as readonly string[]).includes(id)) throw notFound("report");
    const p = await this.period(db, q);
    const locale = q.locale ?? "ar";
    const branches = this.branches(ctx, q.branchId);
    const inScope = (b: string | null | undefined) => !branches || (!!b && branches.includes(b));
    const V = schema.vehicles;
    const vehicles = (await db.select().from(V)).filter((v) => inScope(v.branchId) && (!q.vehicleClass || v.requiredLicenseCategory === q.vehicleClass));
    const vName = new Map(vehicles.map((v) => [v.id, `${v.fleetNumber} · ${v.registrationNumber}`]));
    const vIds = vehicles.map((v) => v.id);
    const drivers = await db.select({ id: schema.drivers.id, name: schema.drivers.fullName, branchId: schema.drivers.branchId }).from(schema.drivers);
    const dName = new Map(drivers.map((d) => [d.id, d.name]));
    const bName = new Map((await db.select().from(schema.branches)).map((b) => [b.id, b.name]));
    const col = (key: string, type: Col["type"] = "text"): Col => ({ key, label: L[key]?.[locale === "ar" ? 0 : 1] ?? key, type });
    const out = (columns: Col[], rows: { row: Record<string, Cell>; link: Report["links"][number] }[], totalKeys: string[] = []): Report => {
      const limited = rows.slice(0, MAX_ROWS);
      const totals = Object.fromEntries(totalKeys.map((k) => [k, Math.round(limited.reduce((s, r) => s + (typeof r.row[k] === "number" ? (r.row[k] as number) : 0), 0) * 1000) / 1000]));
      return { id: id as ReportId, from: p.from, to: p.to, columns, rows: limited.map((r) => r.row), totals, links: limited.map((r) => r.link) };
    };
    const day = (d: Date) => localDate(d, p.tz);
    if (!vIds.length && id !== "audit") return out([col("vehicle")], []);

    switch (id as ReportId) {
      case "fuel": { // RPT-001
        const F = schema.fuelEntries;
        const rows = await db.select().from(F).where(and(inArray(F.vehicleId, vIds), gte(F.eventAt, p.start), lt(F.eventAt, p.end), notInArray(F.status, ["voided"]))).orderBy(asc(F.eventAt));
        return out([col("date", "datetime"), col("vehicle"), col("driver"), col("fuelType"), col("quantity", "number"), col("odometer", "number"), col("amount", "money"), col("status"), col("flags")],
          rows.map((e) => ({ row: { date: e.eventAt.toISOString(), vehicle: vName.get(e.vehicleId) ?? null, driver: e.driverId ? dName.get(e.driverId) ?? null : null, fuelType: e.fuelType,
            quantity: Number(e.quantity), odometer: e.odometer, amount: e.netMinor + e.taxMinor, status: e.status, flags: e.flags.join(" ") }, link: { entityType: "fuel_entry", entityId: e.id } })),
          ["quantity", "amount"]);
      }
      case "maintenance": { // RPT-002: history in the period + what is due now
        const MV = schema.maintenanceVisits;
        const visits = await db.select().from(MV).where(and(inArray(MV.vehicleId, vIds), eq(MV.status, "completed"), gte(MV.visitDate, p.from), lte(MV.visitDate, p.to))).orderBy(asc(MV.visitDate));
        const items = visits.length ? await db.select().from(schema.maintenanceVisitItems).where(inArray(schema.maintenanceVisitItems.visitId, visits.map((v) => v.id))) : [];
        const today = localDate(new Date(), p.tz);
        const states = await this.maintenance.evaluate(db, vehicles.filter((v) => v.status === "active"), today);
        const due = [...states.values()].flatMap((s) => s.items.filter((i) => i.due.status !== "ok").map((i) => ({ s, i })));
        return out([col("kind"), col("date", "date"), col("vehicle"), col("type"), col("items"), col("odometer", "number"), col("gross", "money"), col("due")], [
          ...visits.map((v) => ({ row: { kind: "history", date: v.visitDate, vehicle: vName.get(v.vehicleId) ?? null, type: v.type, items: items.filter((x) => x.visitId === v.id).map((x) => x.itemCode).join(" "),
            odometer: v.odometer, gross: v.grossMinor, due: null }, link: { entityType: "maintenance_visit", entityId: v.id } })),
          ...due.map(({ s, i }) => ({ row: { kind: "due", date: i.due.dueDate, vehicle: vName.get(s.vehicleId) ?? null, type: i.due.status, items: i.code, odometer: i.due.dueKm, gross: null,
            due: [i.due.remainingKm != null ? `${i.due.remainingKm} km` : null, i.due.remainingDays != null ? `${i.due.remainingDays} d` : null].filter(Boolean).join(" / ") }, link: { entityType: "vehicle", entityId: s.vehicleId } })),
        ], ["gross"]);
      }
      case "documents": { // RPT-003: current documents with an expiry up to the end of the period, soonest first
        const { types } = await loadDocumentTypes(db);
        const D = schema.documents;
        const ent = new Set([...vIds, ...drivers.filter((d) => inScope(d.branchId)).map((d) => d.id)]);
        const docs = (await db.select().from(D).where(and(eq(D.status, "verified"), lte(D.expiryDate, p.to)))).filter((d) => ent.has(d.entityId));
        const latest = new Map<string, (typeof docs)[number]>();
        const all = await db.select({ e: D.entityId, t: D.typeCode, v: D.version }).from(D).where(eq(D.status, "verified"));
        for (const d of docs) if (!all.some((x) => x.e === d.entityId && x.t === d.typeCode && x.v > d.version)) latest.set(d.id, d);
        const today = localDate(new Date(), p.tz);
        return out([col("entity"), col("document"), col("expiry", "date"), col("daysLeft", "number"), col("validity")],
          [...latest.values()].sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!)).map((d) => ({
            row: { entity: d.entityType === "vehicle" ? vName.get(d.entityId) ?? null : dName.get(d.entityId) ?? null, document: types.find((t) => t.code === d.typeCode)?.name[locale] ?? d.typeCode,
              expiry: d.expiryDate, daysLeft: daysBetween(today, d.expiryDate!), validity: documentValidity(d.expiryDate, today, DEFAULTS.DOC_LEAD_DAYS, DEFAULTS.DOC_GRACE_DAYS) },
            link: { entityType: d.entityType, entityId: d.entityId } })));
      }
      case "costs": { // RPT-004
        const C = schema.costRecords;
        const rows = (await db.select().from(C).where(and(eq(C.status, "active"), gte(C.expenseDate, p.from), lte(C.expenseDate, p.to))).orderBy(asc(C.expenseDate)))
          .filter((c) => inScope(c.branchId) && (!c.vehicleId || vIds.includes(c.vehicleId)) && (!q.vehicleClass || !!c.vehicleId));
        return out([col("date", "date"), col("vehicle"), col("branch"), col("category"), col("net", "money"), col("tax", "money"), col("gross", "money"), col("reported", "money"), col("source")],
          rows.map((c) => {
            const gross = c.grossMinor ?? c.netMinor + c.taxMinor;
            return { row: { date: c.expenseDate, vehicle: c.vehicleId ? vName.get(c.vehicleId) ?? null : null, branch: bName.get(c.branchId) ?? null, category: c.category, net: c.netMinor, tax: c.taxMinor,
              gross, reported: reportedCost({ netMinor: c.netMinor, grossMinor: gross }, c.taxRecoverable), source: c.sourceType }, link: { entityType: c.sourceType === "manual" ? "cost_record" : c.sourceType, entityId: c.sourceId ?? c.id } };
          }), ["net", "tax", "gross", "reported"]);
      }
      case "odometer_exceptions": { // RPT-005
        const R = schema.meterReadings;
        const rows = await db.select().from(R).where(and(inArray(R.vehicleId, vIds), gte(R.eventAt, p.start), lt(R.eventAt, p.end), inArray(R.status, ["warning", "conflict", "corrected", "excluded"]))).orderBy(asc(R.eventAt));
        return out([col("date", "datetime"), col("vehicle"), col("value", "number"), col("source"), col("status"), col("reasons")],
          rows.map((r) => ({ row: { date: r.eventAt.toISOString(), vehicle: vName.get(r.vehicleId) ?? null, value: r.value, source: r.sourceType, status: r.status, reasons: r.reasons.join(" ") }, link: { entityType: "vehicle", entityId: r.vehicleId } })));
      }
      case "assignments": { // RPT-006
        const A = schema.assignments;
        const rows = await db.select().from(A).where(and(inArray(A.vehicleId, vIds), eq(A.status, "active"), lt(A.startsAt, p.end), or(isNull(A.endsAt), gte(A.endsAt, p.start)))).orderBy(asc(A.startsAt));
        const H = schema.handovers;
        const hs = await db.select().from(H).where(and(inArray(H.vehicleId, vIds), gte(H.eventAt, p.start), lt(H.eventAt, p.end))).orderBy(asc(H.eventAt));
        return out([col("start", "datetime"), col("end", "datetime"), col("vehicle"), col("driver"), col("role")], [
          ...rows.map((a) => ({ row: { start: a.startsAt.toISOString(), end: a.endsAt?.toISOString() ?? null, vehicle: vName.get(a.vehicleId) ?? null, driver: dName.get(a.driverId) ?? null, role: a.role }, link: { entityType: "assignment", entityId: a.id } })),
          ...hs.map((h) => ({ row: { start: h.eventAt.toISOString(), end: null, vehicle: vName.get(h.vehicleId) ?? null, driver: dName.get(h.toDriverId) ?? null, role: "handover" }, link: { entityType: "vehicle", entityId: h.vehicleId } })),
        ].sort((a, b) => String(a.row.start).localeCompare(String(b.row.start))));
      }
      case "audit": { // RPT-007
        const AU = schema.auditLog;
        const where: SQL[] = [gte(AU.at, p.start), lt(AU.at, p.end)];
        if (branches) where.push(branches.length ? inArray(AU.branchId, [...branches]) : eq(AU.id, -1));
        const rows = await db.select().from(AU).where(and(...where)).orderBy(desc(AU.at)).limit(MAX_ROWS);
        return out([col("date", "datetime"), col("actor"), col("action"), col("entity")],
          rows.map((a) => ({ row: { date: a.at.toISOString(), actor: a.actorId, action: a.action, entity: a.entityType }, link: a.entityId && a.entityType ? { entityType: a.entityType, entityId: a.entityId } : null })));
      }
      case "fines": {
        const FI = schema.fines;
        const rows = await db.select().from(FI).where(and(inArray(FI.vehicleId, vIds), eq(FI.status, "active"), gte(FI.violationAt, p.start), lt(FI.violationAt, p.end))).orderBy(asc(FI.violationAt));
        return out([col("date", "datetime"), col("vehicle"), col("driver"), col("ref"), col("amount", "money"), col("payment")],
          rows.map((f) => ({ row: { date: f.violationAt.toISOString(), vehicle: vName.get(f.vehicleId) ?? null, driver: f.driverId ? dName.get(f.driverId) ?? null : null, ref: f.authorityRef, amount: f.amountMinor, payment: f.paymentStatus },
            link: { entityType: "fine", entityId: f.id } })), ["amount"]);
      }
    }
  }
}
