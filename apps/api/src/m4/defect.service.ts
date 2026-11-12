import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Defect } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { sniffMime } from "@fleet/domain";
import { tenantOf, type RequestContext } from "../auth/context.js";
import { AppError, conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { STORAGE } from "../infra/tokens.js";
import { TenantKeys } from "../infra/tenant-keys.js";
import { encryptFile, type ObjectStorage } from "../files/storage.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { iso } from "../m2/common.js";

const D = schema.defects;
export type DefectRow = typeof D.$inferSelect;
type VehicleRow = typeof schema.vehicles.$inferSelect;

export const toDefect = (d: DefectRow): Defect => ({
  id: d.id, vehicleId: d.vehicleId, branchId: d.branchId, driverId: d.driverId, reportedAt: d.reportedAt.toISOString(), recordedAt: d.recordedAt.toISOString(),
  description: d.description, severity: d.severity, drivable: d.drivable, hasPhoto: !!d.photoFileKey, status: d.status, decidedBy: d.decidedBy,
  decidedAt: iso(d.decidedAt), decisionReason: d.decisionReason, workOrderId: d.workOrderId, duplicateOf: d.duplicateOf, flags: d.flags, createdBy: d.createdBy,
});

export interface DefectInput { id?: string; description: string; severity: Defect["severity"]; drivable: boolean; driverId?: string | null }

/** WO-001 defect reports, shared by POST /defects and the defect.report sync handler (E14). */
@Injectable()
export class DefectService {
  constructor(private readonly keys: TenantKeys, @Inject(STORAGE) private readonly storage: ObjectStorage) {}

  /** The caller has loaded, locked and scope-checked the vehicle and decided the report time. */
  async create(tx: Tx, ctx: RequestContext, v: VehicleRow, b: DefectInput, at: Date, flags: string[] = []): Promise<{ row: DefectRow; created: boolean }> {
    if (b.id) {
      const [existing] = await tx.select().from(D).where(eq(D.id, b.id));
      if (existing) {
        if (existing.createdBy !== ctx.identityId) throw conflict("id_in_use", "This id is already used");
        return { row: existing, created: false };
      }
    }
    if (ctx.role === "driver" && b.driverId && b.driverId !== ctx.driverId) throw forbidden("Drivers report their own defects");
    const driverId = ctx.role === "driver" ? (ctx.driverId ?? null) : (b.driverId ?? null);
    if (driverId && ctx.role !== "driver") {
      const [d] = await tx.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.id, driverId));
      if (!d) throw validation({ driverId: "unknown_driver" });
    }
    if (v.status === "disposed") throw conflict("vehicle_disposed", "The vehicle is disposed");
    const [row] = await tx.insert(D).values({
      id: b.id ?? newId(), vehicleId: v.id, branchId: v.branchId, driverId, reportedAt: at, description: b.description, severity: b.severity,
      drivable: b.drivable, flags, createdBy: ctx.identityId,
    }).returning();
    await TenantDb.audit(tx, ctx, "defect.reported", "defect", row!.id, { severity: b.severity, drivable: b.drivable, flags }, null, v.branchId);
    return { row: row!, created: true };
  }

  async attachPhoto(tx: Tx, ctx: RequestContext, d: DefectRow, bytes: Buffer): Promise<DefectRow> {
    const mime = sniffMime(bytes);
    if (!mime || mime === "application/pdf") throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_file_type", "Only JPG or PNG");
    if (ctx.role === "driver" && d.createdBy !== ctx.identityId) throw notFound("defect");
    if (d.photoFileKey) throw conflict("photo_exists", "A photo is already attached");
    const tenantId = tenantOf(ctx);
    const key = `t/${tenantId}/defects/${d.id}/${randomBytes(8).toString("hex")}`;
    await this.storage.put(key, encryptFile((await this.keys.for(tenantId)).fileKey, bytes));
    const [row] = await tx.update(D).set({ photoFileKey: key, photoMime: mime }).where(eq(D.id, d.id)).returning();
    await TenantDb.audit(tx, ctx, "defect.photo_uploaded", "defect", d.id, { mime, size: bytes.length }, null, d.branchId);
    return row!;
  }
}
