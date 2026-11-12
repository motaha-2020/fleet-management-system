import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { routes } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { initialFuelStatus, needsReview, sniffMime, type FuelFlag } from "@fleet/domain";
import { tenantOf, type RequestContext } from "../auth/context.js";
import { AppError, conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { STORAGE } from "../infra/tokens.js";
import { TenantKeys } from "../infra/tenant-keys.js";
import { encryptFile, type ObjectStorage } from "../files/storage.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { companyOf, eventTime, loadVehicle } from "./common.js";
import { MeterService } from "./meter.service.js";
import { FuelRecalc } from "./fuel-recalc.service.js";
import { ReadinessService } from "../m4/readiness.service.js";

const F = schema.fuelEntries;
type Row = typeof F.$inferSelect;
type VehicleRow = typeof schema.vehicles.$inferSelect;
export type CreateFuelBody = z.output<typeof routes.createFuelEntry.body>;

export interface CreateFuelOptions {
  /** Vehicle already loaded, locked and scope-checked by the caller (offline sync checks scope at event time). */
  vehicle?: VehicleRow;
  /** Event time already decided by the caller (offline sync: device time or the drift-corrected estimate). */
  at?: Date;
  /** Extra review flags from the caller (offline sync: clock_drift). */
  extraFlags?: FuelFlag[];
}

/**
 * E09 fuel entry creation, shared by POST /fuel-entries and the fuel.create sync handler (E14).
 * Records are never rejected for business-rule findings (GEN-012): they are saved with flags and go to review.
 */
@Injectable()
export class FuelService {
  constructor(
    private readonly meter: MeterService,
    private readonly recalc: FuelRecalc,
    private readonly keys: TenantKeys,
    private readonly readiness: ReadinessService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Receipt photo for an entry already loaded, locked and scope-checked by the caller (POST /fuel-entries/:id/receipt
   * and the resumable upload, US-E14-05). Arriving clears missing_receipt and may complete acceptance.
   */
  async attachReceipt(tx: Tx, ctx: RequestContext, e: Row, bytes: Buffer): Promise<Row> {
    const mime = sniffMime(bytes);
    if (!mime) throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_file_type", "Only JPG, PNG or PDF");
    if (e.status === "voided") throw conflict("voided", "This entry is voided");
    if (ctx.role === "driver" && e.createdBy !== ctx.identityId) throw notFound("fuel entry");
    if (e.receiptFileKey) throw conflict("receipt_exists", "A receipt is already attached; request a correction to change it");
    const tenantId = tenantOf(ctx);
    const crypto = await this.keys.for(tenantId);
    const key = `t/${tenantId}/fuel/${e.id}/${randomBytes(8).toString("hex")}`;
    await this.storage.put(key, encryptFile(crypto.fileKey, bytes));
    const flags = e.flags.filter((f) => f !== "missing_receipt");
    const accept = e.status === "under_review" && !needsReview(flags) && !e.reviewedBy;
    const [row] = await tx.update(F).set({ receiptFileKey: key, receiptFileMime: mime, flags, ...(accept ? { status: "accepted" as const } : {}) }).where(eq(F.id, e.id)).returning();
    if (accept) await this.recalc.ensureCost(tx, ctx, row!);
    await TenantDb.audit(tx, ctx, "fuel.receipt_uploaded", "fuel_entry", e.id, { mime, size: bytes.length, status: row!.status }, null, e.branchId);
    return row!;
  }

  async create(tx: Tx, ctx: RequestContext, b: CreateFuelBody, opts: CreateFuelOptions = {}): Promise<{ row: Row; created: boolean }> {
    const { country } = await companyOf(tx);
    const driverId: string | null = ctx.role === "driver" ? (ctx.driverId ?? null) : (b.driverId ?? null);
    if (ctx.role === "driver" && b.driverId && b.driverId !== ctx.driverId) throw forbidden("Drivers record their own fuel entries");
    const fuel = country.fuelTypes.find((f) => f.code === b.fuelType);
    if (!fuel) throw validation({ fuelType: "unknown_fuel_type" });
    if (b.taxMinor >= b.amountMinor) throw validation({ taxMinor: "out_of_range" });

    // Idempotent: a retried submit with the same id returns the stored entry (Worked Example E5).
    if (b.id) {
      const [existing] = await tx.select().from(F).where(eq(F.id, b.id));
      if (existing) {
        if (existing.createdBy !== ctx.identityId) throw conflict("id_in_use", "This id is already used");
        return { row: existing, created: false };
      }
    }
    const v = opts.vehicle ?? (await loadVehicle(tx, ctx, b.vehicleId, { lock: true, allowUnassigned: true }));
    if (driverId) {
      const [d] = await tx.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.id, driverId));
      if (!d) throw validation({ driverId: "unknown_driver" });
    }
    const at = opts.at ?? eventTime(b.eventAt, v);
    const id = b.id ?? newId();
    const reading = await this.meter.record(tx, { vehicleId: v.id, value: b.odometer, at, sourceType: "fuel", sourceId: id, createdBy: ctx.identityId });
    const evaluated = await this.recalc.evaluate(tx, {
      selfId: id, vehicle: v, driverId, fuelType: b.fuelType, quantity: b.quantity, grossMinor: b.amountMinor, at,
      receiptRef: b.receiptRef ?? null, hasReceiptFile: false, payment: b.payment, readingStatus: reading.status, countryCode: country.code,
    });
    const { reference } = evaluated;
    const flags: FuelFlag[] = [...evaluated.flags, ...(opts.extraFlags ?? []).filter((f) => !evaluated.flags.includes(f))];
    // US-E12-02: fuel is a fact and is never blocked; a restricted vehicle is noted for information only.
    if ((await this.readiness.evaluate(tx, { vehicle: v }, at)).outcome === "restricted") flags.push("vehicle_restricted");
    const [row] = await tx.insert(F).values({
      id, vehicleId: v.id, driverId, branchId: v.branchId, eventAt: at, odometer: b.odometer, readingId: reading.id,
      fuelType: b.fuelType, quantity: b.quantity, unit: fuel.unit, isFull: b.isFull, netMinor: b.amountMinor - b.taxMinor, taxMinor: b.taxMinor,
      currency: country.currency, payment: b.payment, receiptRef: b.receiptRef ?? null,
      referencePriceMinor: reference?.priceMinor ?? null, referenceOfficial: reference?.official ?? null,
      status: initialFuelStatus(flags), flags, notes: b.notes ?? null, createdBy: ctx.identityId,
    }).returning();
    if (row!.status === "accepted") await this.recalc.ensureCost(tx, ctx, row!);
    await TenantDb.audit(tx, ctx, "fuel.created", "fuel_entry", id, { status: row!.status, flags, quantity: b.quantity, amountMinor: b.amountMinor }, null, v.branchId);
    return { row: row!, created: true };
  }
}
