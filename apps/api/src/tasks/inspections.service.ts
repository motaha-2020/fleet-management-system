import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { routes, type Inspection } from "@fleet/contracts";
import { INSPECTION_ITEMS, INSPECTION_CODES } from "@fleet/config";
import { schema, newId } from "@fleet/db";
import { tenantOf, type RequestContext } from "../auth/context.js";
import { validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { MeterService } from "../m2/meter.service.js";
import { eventTime, loadVehicle } from "../m2/common.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { AlertService } from "../m5/alert.service.js";

const I = schema.inspections;
type Row = typeof I.$inferSelect;
const CRITICAL = new Set<string>(INSPECTION_ITEMS.filter((i) => i.critical).map((i) => i.code));

export const toInspection = (r: Row): Inspection => ({
  id: r.id, vehicleId: r.vehicleId, branchId: r.branchId, driverId: r.driverId, inspectedAt: r.inspectedAt.toISOString(), odometer: r.odometer,
  items: r.items.map((i) => ({ code: i.code, ok: i.ok, note: i.note ?? null })), failed: r.failed, notes: r.notes, status: r.status,
  decisionReason: r.decisionReason, createdBy: r.createdBy,
});

/** Recording an inspection, shared by the web/API and the driver app's offline sync (inspection.create). */
@Injectable()
export class InspectionsService {
  constructor(private readonly meter: MeterService, private readonly approvals: ApprovalService, private readonly alerts: AlertService) {}

  async create(tx: Tx, ctx: RequestContext, b: z.output<typeof routes.createInspection.body>): Promise<Inspection> {
    const codes = new Set(b.items.map((i) => i.code));
    if (codes.size !== b.items.length) throw validation({ items: "duplicate_item" });
    const unknown = b.items.find((i) => !(INSPECTION_CODES as readonly string[]).includes(i.code));
    if (unknown) throw validation({ items: `unknown_item:${unknown.code}` });
    if (b.id) {
      const [existing] = await tx.select().from(I).where(eq(I.id, b.id));
      if (existing) return toInspection(existing);
    }
    const v = await loadVehicle(tx, ctx, b.vehicleId, { lock: true, allowUnassigned: ctx.role !== "driver" });
    const at = eventTime(b.at, v);
    const pending = await this.approvals.needsApproval(tx, ctx, "inspection");
    const id = b.id ?? newId();
    const reading = b.odometer != null
      ? await this.meter.record(tx, { vehicleId: v.id, value: b.odometer, at, sourceType: "inspection", sourceId: id, createdBy: ctx.identityId, pending })
      : null;
    const items = b.items.map((i) => ({ code: i.code, ok: i.ok, note: i.note ?? null }));
    const failed = items.filter((i) => !i.ok);
    const [row] = await tx.insert(I).values({
      id, vehicleId: v.id, branchId: v.branchId, driverId: ctx.role === "driver" ? ctx.driverId ?? null : null, inspectedAt: at,
      odometer: b.odometer ?? null, readingId: reading?.id ?? null, items, failed: failed.length, notes: b.notes ?? null,
      status: pending ? "pending" : "approved", createdBy: ctx.identityId,
    }).returning();
    await TenantDb.audit(tx, ctx, "inspection.recorded", "vehicle", v.id, { inspectionId: id, failed: failed.map((i) => i.code), status: row!.status }, null, v.branchId);
    if (failed.some((i) => CRITICAL.has(i.code))) {
      await this.alerts.raiseToRole(tx, tenantOf(ctx), {
        type: "inspection_failed", entityType: "vehicle", entityId: v.id, branchId: v.branchId,
        params: { label: `${v.fleetNumber} · ${v.registrationNumber}`, description: failed.map((i) => i.code).join(", ") },
      });
    }
    return toInspection(row!);
  }
}
