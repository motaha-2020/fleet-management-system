import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { schema, newId, type ReadingSource } from "@fleet/db";
import { classifyReading, cumulative, sniffMime, type Reading, type Replacement } from "@fleet/domain";
import type { MeterReading } from "@fleet/contracts";
import { tenantOf, type RequestContext } from "../auth/context.js";
import { AppError, conflict, notFound } from "../infra/errors.js";
import { STORAGE } from "../infra/tokens.js";
import { TenantKeys } from "../infra/tenant-keys.js";
import { encryptFile, type ObjectStorage } from "../files/storage.js";
import { TenantDb } from "../fleet/tenant-db.js";
import type { DbOrTx } from "./common.js";
import { DEFAULTS } from "@fleet/config";
import { policiesFor } from "./policies.js";

const R = schema.meterReadings;
type Row = typeof R.$inferSelect;

/** What the driver app captured with a reading: when the meter photo was taken and where. */
export interface ReadingCapture {
  photoTakenAt?: Date | null;
  location?: { lat: number; lng: number; accuracyM: number | null } | null;
  locationStatus?: "ok" | "denied" | "unavailable" | null;
}

/**
 * The odometer ledger (ODO-001..010). Every source writes through `record`, which classifies the
 * reading against the vehicle's history (the caller holds the vehicle row lock, so readings of one
 * vehicle are serialized). Readings are never rewritten: a correction marks the old one Corrected
 * and adds a new version.
 */
@Injectable()
export class MeterService {
  constructor(private readonly keys: TenantKeys, @Inject(STORAGE) private readonly storage: ObjectStorage) {}

  async history(db: DbOrTx, vehicleId: string) {
    const readings = await db.select().from(R).where(eq(R.vehicleId, vehicleId)).orderBy(asc(R.eventAt));
    const reps = await db.select().from(schema.meterReplacements).where(eq(schema.meterReplacements.vehicleId, vehicleId)).orderBy(asc(schema.meterReplacements.eventAt));
    const replacements: Replacement[] = reps.map((r) => ({ at: r.eventAt.getTime(), oldFinal: r.oldFinal, newStart: r.newStart }));
    return { rows: readings, reps, replacements, domain: readings.map(toDomain) };
  }

  async record(
    tx: DbOrTx,
    input: { id?: string; vehicleId: string; value: number; at: Date; sourceType: ReadingSource; sourceId: string | null; createdBy: string; excludeIds?: string[]; capture?: ReadingCapture; pending?: boolean },
  ): Promise<Row> {
    const { domain, replacements } = await this.history(tx, input.vehicleId);
    const others = domain.filter((r) => !input.excludeIds?.includes(r.id));
    // GEN-007: the daily-distance threshold in force at the reading's time.
    const policy = await policiesFor(tx, input.at);
    const c = classifyReading({ value: input.value, at: input.at.getTime(), source: input.sourceType }, others, replacements,
      { maxPerDay: policy.odo_max_km_per_day, corrobKm: DEFAULTS.ODO_CORROB_KM, corrobMinutes: DEFAULTS.ODO_CORROB_MINUTES });
    const [row] = await tx.insert(R).values({
      id: input.id ?? newId(), vehicleId: input.vehicleId, value: input.value, eventAt: input.at, sourceType: input.sourceType, sourceId: input.sourceId,
      status: c.status, reasons: c.reasons, corroborates: c.corroborates, createdBy: input.createdBy,
      approvalStatus: input.pending ? "pending" : "approved",
      ...(input.capture ? {
        photoTakenAt: input.capture.photoTakenAt ?? null,
        latitude: input.capture.location?.lat ?? null, longitude: input.capture.location?.lng ?? null,
        locationAccuracyM: input.capture.location?.accuracyM != null ? Math.round(input.capture.location.accuracyM) : null,
        locationStatus: input.capture.locationStatus ?? (input.capture.location ? "ok" : null),
      } : {}),
    }).returning();
    return row!;
  }

  /** The meter photo of a driver-app reading (encrypted at rest, one per reading, JPG/PNG only). */
  async attachPhoto(tx: DbOrTx, ctx: RequestContext, r: Row, bytes: Buffer, branchId: string): Promise<Row> {
    const mime = sniffMime(bytes);
    if (!mime || mime === "application/pdf") throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_file_type", "Only JPG or PNG");
    if (ctx.role === "driver" && r.createdBy !== ctx.identityId) throw notFound("reading");
    if (r.photoFileKey) throw conflict("photo_exists", "A photo is already attached");
    const tenantId = tenantOf(ctx);
    const key = `t/${tenantId}/odometer/${r.id}/${randomBytes(8).toString("hex")}`;
    await this.storage.put(key, encryptFile((await this.keys.for(tenantId)).fileKey, bytes));
    const [row] = await tx.update(R).set({ photoFileKey: key, photoMime: mime }).where(eq(R.id, r.id)).returning();
    await TenantDb.audit(tx, ctx, "odometer.photo_uploaded", "vehicle", r.vehicleId, { readingId: r.id, mime, size: bytes.length }, null, branchId);
    return row!;
  }

  toDto(r: Row, replacements: readonly Replacement[]): MeterReading {
    return {
      id: r.id, vehicleId: r.vehicleId, value: r.value, cumulative: cumulative(r.value, r.eventAt.getTime(), replacements),
      eventAt: r.eventAt.toISOString(), recordedAt: r.recordedAt.toISOString(), sourceType: r.sourceType, sourceId: r.sourceId,
      status: r.status, reasons: r.reasons, corroborates: r.corroborates, correctedBy: r.correctedBy,
      hasPhoto: !!r.photoFileKey, photoTakenAt: r.photoTakenAt?.toISOString() ?? null,
      location: r.latitude != null && r.longitude != null ? { lat: Number(r.latitude), lng: Number(r.longitude), accuracyM: r.locationAccuracyM } : null,
      locationStatus: r.locationStatus ?? null,
      approvalStatus: r.approvalStatus, decisionReason: r.decisionReason,
    };
  }
}

/** Owner decision (14 Nov 2026): a reading waiting for approval, or rejected, does not count anywhere (as if excluded). */
export const toDomain = (r: Row): Reading => ({ id: r.id, value: r.value, at: r.eventAt.getTime(), status: r.approvalStatus === "approved" ? r.status : "excluded", source: r.sourceType });
