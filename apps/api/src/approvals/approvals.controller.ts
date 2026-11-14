import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { routes, type ApprovalItem } from "@fleet/contracts";
import { schema, type Db } from "@fleet/db";
import { branchFilter } from "@fleet/domain";
import { Ctx, Requires, tenantOf, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { CONTROL_DB } from "../infra/tokens.js";
import { conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { FuelRecalc } from "../m2/fuel-recalc.service.js";
import { AlertService } from "../m5/alert.service.js";
import { APPROVAL_TYPES, ApprovalService, type ApprovalType } from "./approval.service.js";
import { MaintenanceController } from "../m4/maintenance.controller.js";

const S = schema;
const R = S.meterReadings, F = S.fuelEntries, C = S.costRecords, MV = S.maintenanceVisits;
const isType = (t: string): t is ApprovalType => (APPROVAL_TYPES as readonly string[]).includes(t);
const geo = (r: { latitude: number | null; longitude: number | null; locationAccuracyM: number | null }) =>
  r.latitude != null && r.longitude != null ? { lat: Number(r.latitude), lng: Number(r.longitude), accuracyM: r.locationAccuracyM } : null;

/**
 * Owner decision (14 Nov 2026): one inbox for the fleet manager (and the company admin) with everything that waits
 * for approval — manual odometer readings, fuel entries, costs/invoices and finished maintenance visits — with the
 * photo and the place. Approving makes the record count; rejecting keeps it (visible, not counted) with the reason,
 * and the driver who recorded it is told.
 */
@Controller()
export class ApprovalsController {
  constructor(
    @Inject(CONTROL_DB) private readonly control: Db,
    private readonly tdb: TenantDb,
    private readonly approvals: ApprovalService,
    private readonly recalc: FuelRecalc,
    private readonly alerts: AlertService,
  ) {}

  @Requires("approval.decide", "fuel.review") @Get(routes.listApprovals.path)
  async list(@Query(new ZodPipe(routes.listApprovals.query)) q: z.output<typeof routes.listApprovals.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const filter = branchFilter(ctx, ctx.scope!);
    const inScope = (branchId: string) => !filter || filter.includes(branchId);
    const want = (t: ApprovalType) => !q.type || q.type === t;
    const vehicles = await db.select({ id: S.vehicles.id, branchId: S.vehicles.branchId, f: S.vehicles.fleetNumber, r: S.vehicles.registrationNumber }).from(S.vehicles);
    const vById = new Map(vehicles.map((v) => [v.id, v]));
    const drivers = await db.select({ identityId: S.drivers.identityId, name: S.drivers.fullName }).from(S.drivers);
    const driverName = new Map(drivers.map((d) => [d.identityId, d.name]));
    const items: Omit<ApprovalItem, "createdByName" | "canDecide">[] = [];
    const base = (vehicleId: string | null, branchId: string) => ({
      vehicleId, vehicleLabel: vehicleId ? `${vById.get(vehicleId)?.f ?? ""} · ${vById.get(vehicleId)?.r ?? ""}` : null, branchId,
      odometer: null, quantity: null, unit: null, amountMinor: null, currency: null, category: null, description: null, flags: [] as string[], photo: null, location: null,
    });

    if (want("odometer") && ctx.permissions["approval.decide"]) {
      const rows = await db.select().from(R).where(and(eq(R.approvalStatus, "pending"), inArray(R.sourceType, ["manual", "opening"])));
      for (const r of rows) {
        const v = vById.get(r.vehicleId);
        if (!v || !inScope(v.branchId)) continue;
        items.push({ ...base(r.vehicleId, v.branchId), type: "odometer", id: r.id, at: r.eventAt.toISOString(), createdBy: r.createdBy, byDriver: driverName.has(r.createdBy),
          odometer: r.value, flags: r.reasons.map((x) => `odometer_${x}`), photo: r.photoFileKey ? "odometer" : null, location: geo(r) });
      }
    }
    if (want("fuel")) {
      const rows = await db.select().from(F).where(eq(F.status, "under_review"));
      for (const e of rows) {
        if (!inScope(e.branchId)) continue;
        items.push({ ...base(e.vehicleId, e.branchId), type: "fuel", id: e.id, at: e.eventAt.toISOString(), createdBy: e.createdBy, byDriver: driverName.has(e.createdBy),
          odometer: e.odometer, quantity: Number(e.quantity), unit: e.unit, amountMinor: e.netMinor + e.taxMinor, currency: e.currency, category: e.fuelType,
          flags: e.flags, photo: e.receiptFileKey ? "receipt" : null, location: geo(e) });
      }
    }
    if (want("cost") && ctx.permissions["approval.decide"]) {
      const rows = await db.select().from(C).where(eq(C.status, "pending"));
      for (const c of rows) {
        if (!inScope(c.branchId)) continue;
        items.push({ ...base(c.vehicleId, c.branchId), type: "cost", id: c.id, at: new Date(`${c.expenseDate}T12:00:00Z`).toISOString(), createdBy: c.createdBy, byDriver: driverName.has(c.createdBy),
          amountMinor: c.grossMinor ?? c.netMinor + c.taxMinor, currency: c.currency, category: c.category, description: c.description, flags: c.flags });
      }
    }
    if (want("maintenance") && ctx.permissions["approval.decide"]) {
      const rows = await db.select().from(MV).where(eq(MV.status, "pending_approval"));
      for (const m of rows) {
        if (!inScope(m.branchId)) continue;
        items.push({ ...base(m.vehicleId, m.branchId), type: "maintenance", id: m.id, at: new Date(`${m.visitDate}T12:00:00Z`).toISOString(), createdBy: m.createdBy, byDriver: driverName.has(m.createdBy),
          odometer: m.odometer, amountMinor: m.grossMinor ?? (m.netMinor ?? 0) + m.taxMinor, currency: m.currency, category: m.type, description: m.notes });
      }
    }
    // Names of office staff come from the platform; drivers' from the company.
    const staffIds = [...new Set(items.filter((i) => !i.byDriver).map((i) => i.createdBy))];
    const staff = staffIds.length ? await this.control.select({ id: S.identities.id, name: S.identities.displayName }).from(S.identities).where(inArray(S.identities.id, staffIds)) : [];
    const staffName = new Map(staff.map((s) => [s.id, s.name]));
    const out: ApprovalItem[] = [];
    for (const i of items.sort((a, b) => a.at.localeCompare(b.at))) {
      const canDecide = i.type === "fuel" && !(await this.fuelNeedsApproval(db, i.id))
        ? !!ctx.permissions["fuel.review"] && i.createdBy !== ctx.identityId
        : await this.approvals.canDecide(db, ctx, i, i.byDriver);
      out.push({ ...i, createdByName: (i.byDriver ? driverName.get(i.createdBy) : staffName.get(i.createdBy)) ?? null, canDecide });
    }
    return { items: out };
  }

  private async fuelNeedsApproval(db: Db, id: string) {
    const [e] = await db.select({ n: F.needsApproval }).from(F).where(eq(F.id, id));
    return !!e?.n;
  }

  @Requires("approval.decide", "fuel.review") @Post(routes.approveItem.path) @HttpCode(200)
  async approve(@Param("type") type: string, @Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    if (!isType(type)) throw notFound("approval");
    const db = await this.tdb.for(ctx);
    await db.transaction((tx) => this.decide(tx, ctx, type, id, null));
    return { type, id, status: "approved" as const };
  }

  @Requires("approval.decide", "fuel.review") @Post(routes.rejectItem.path) @HttpCode(200)
  async reject(@Param("type") type: string, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.rejectItem.body)) b: z.output<typeof routes.rejectItem.body>, @Ctx() ctx: RequestContext) {
    if (!isType(type)) throw notFound("approval");
    const db = await this.tdb.for(ctx);
    await db.transaction((tx) => this.decide(tx, ctx, type, id, b.reason));
    return { type, id, status: "rejected" as const };
  }

  /** reason null = approve. */
  private async decide(tx: Tx, ctx: RequestContext, type: ApprovalType, id: string, reason: string | null) {
    const now = new Date();
    const decided = { decidedBy: ctx.identityId, decidedAt: now };
    let owner: { createdBy: string; vehicleId: string | null; branchId: string; what: string } | null = null;
    switch (type) {
      case "odometer": {
        const [r] = await tx.select().from(R).where(eq(R.id, id)).for("update");
        const [v] = r ? await tx.select({ branchId: S.vehicles.branchId }).from(S.vehicles).where(eq(S.vehicles.id, r.vehicleId)) : [];
        if (!r || !v) throw notFound("reading");
        if (r.approvalStatus !== "pending") throw conflict("already_decided", "This was already decided");
        await this.approvals.assertDecider(tx, ctx, { createdBy: r.createdBy, branchId: v.branchId });
        await tx.update(R).set({ approvalStatus: reason ? "rejected" : "approved", decisionReason: reason, ...decided }).where(eq(R.id, id));
        await TenantDb.audit(tx, ctx, reason ? "odometer.rejected" : "odometer.approved", "vehicle", r.vehicleId, { readingId: id, value: r.value, reason }, null, v.branchId);
        owner = { createdBy: r.createdBy, vehicleId: r.vehicleId, branchId: v.branchId, what: `odometer:${r.value}` };
        break;
      }
      case "fuel": {
        const [e] = await tx.select().from(F).where(eq(F.id, id)).for("update");
        if (!e) throw notFound("fuel entry");
        if (e.status !== "under_review") throw conflict("already_decided", "This was already decided");
        if (e.needsApproval) await this.approvals.assertDecider(tx, ctx, e);
        else {
          // Entries waiting only for review of their findings (not for approval) follow the fuel review rules.
          if (!ctx.permissions["fuel.review"]) throw forbidden();
          if (e.createdBy === ctx.identityId) throw forbidden("You cannot verify a record you created");
          const filter = branchFilter(ctx, ctx.permissions["fuel.review"]);
          if (filter && !filter.includes(e.branchId)) throw notFound("fuel entry");
        }
        if (!reason) {
          const [row] = await tx.update(F).set({ status: "accepted", needsApproval: false, reviewedBy: ctx.identityId, reviewedAt: now }).where(eq(F.id, id)).returning();
          await this.recalc.ensureCost(tx, ctx, row!);
          if (e.readingId) await tx.update(R).set({ approvalStatus: "approved", ...decided }).where(and(eq(R.id, e.readingId), eq(R.approvalStatus, "pending")));
        } else {
          await tx.update(F).set({ status: "voided", needsApproval: false, voidReason: reason, reviewedBy: ctx.identityId, reviewedAt: now }).where(eq(F.id, id));
          await this.recalc.voidCost(tx, id);
          if (e.readingId) await tx.update(R).set({ status: "excluded", approvalStatus: "rejected", decisionReason: reason, ...decided }).where(eq(R.id, e.readingId));
        }
        await TenantDb.audit(tx, ctx, reason ? "fuel.voided" : "fuel.accepted", "fuel_entry", id, { status: reason ? "voided" : "accepted", reason, via: "approvals" }, { status: e.status }, e.branchId);
        owner = { createdBy: e.createdBy, vehicleId: e.vehicleId, branchId: e.branchId, what: `fuel:${e.quantity}` };
        break;
      }
      case "cost": {
        const [c] = await tx.select().from(C).where(eq(C.id, id)).for("update");
        if (!c) throw notFound("cost");
        if (c.status !== "pending") throw conflict("already_decided", "This was already decided");
        await this.approvals.assertDecider(tx, ctx, c);
        await tx.update(C).set({ status: reason ? "voided" : "active", decisionReason: reason, ...decided }).where(eq(C.id, id));
        await TenantDb.audit(tx, ctx, reason ? "cost.rejected" : "cost.approved", "cost_record", id, { reason }, { status: c.status }, c.branchId);
        owner = { createdBy: c.createdBy, vehicleId: c.vehicleId, branchId: c.branchId, what: `cost:${c.category}` };
        break;
      }
      case "maintenance": {
        const [m] = await tx.select().from(MV).where(eq(MV.id, id)).for("update");
        if (!m) throw notFound("visit");
        if (m.status !== "pending_approval") throw conflict("already_decided", "This was already decided");
        await this.approvals.assertDecider(tx, ctx, m);
        if (!m.readingId) throw validation({ odometer: "odometer_required" });
        if (!reason) {
          await tx.update(R).set({ approvalStatus: "approved", ...decided }).where(and(eq(R.id, m.readingId), eq(R.approvalStatus, "pending")));
          await MaintenanceController.finalize(tx, ctx, m, { id: m.vehicleId, branchId: m.branchId }, m.readingId);
          await tx.update(MV).set(decided).where(eq(MV.id, id));
        } else {
          await tx.update(MV).set({ status: "voided", voidReason: reason, decisionReason: reason, ...decided }).where(eq(MV.id, id));
          await tx.update(R).set({ status: "excluded", approvalStatus: "rejected", decisionReason: reason, ...decided }).where(eq(R.id, m.readingId));
          await TenantDb.audit(tx, ctx, "maintenance_visit.rejected", "maintenance_visit", id, { reason }, { status: m.status }, m.branchId);
        }
        owner = { createdBy: m.createdBy, vehicleId: m.vehicleId, branchId: m.branchId, what: `maintenance:${m.type}` };
        break;
      }
    }
    // The driver who recorded it is told, with the reason (like a rejected defect report).
    if (reason && owner && owner.createdBy !== ctx.identityId && (await this.approvals.isDriver(tx, owner.createdBy))) {
      const [v] = owner.vehicleId ? await tx.select({ f: S.vehicles.fleetNumber, r: S.vehicles.registrationNumber }).from(S.vehicles).where(eq(S.vehicles.id, owner.vehicleId)) : [];
      await this.alerts.raise(tx, tenantOf(ctx), {
        type: "record_rejected", entityType: "vehicle", entityId: owner.vehicleId ?? id, branchId: owner.branchId, ownerId: owner.createdBy,
        params: { label: v ? `${v.f} · ${v.r}` : undefined, description: type, reason },
      });
    }
  }

  @Requires("approval.decide", "policy.manage") @Get(routes.getApprovalSettings.path)
  async settings(@Ctx() ctx: RequestContext) {
    return { items: await this.approvals.all(await this.tdb.for(ctx)) };
  }

  /** Company admin: approval is required by default; a type can be made automatic. */
  @Requires("policy.manage") @Post(routes.setApprovalSetting.path) @HttpCode(200)
  async setSetting(@Body(new ZodPipe(routes.setApprovalSetting.body)) b: z.output<typeof routes.setApprovalSetting.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const before = await this.approvals.mode(db, b.type);
    await this.approvals.setMode(db, ctx, b.type, b.mode);
    const [c] = await db.select({ id: S.company.id }).from(S.company).limit(1);
    await TenantDb.audit(db, ctx, "approval.setting_changed", "company", c!.id, { type: b.type, mode: b.mode }, { mode: before });
    return { items: await this.approvals.all(db) };
  }
}
