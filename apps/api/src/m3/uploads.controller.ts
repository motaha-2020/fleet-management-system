import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULTS } from "@fleet/config";
import { routes, type UploadState } from "@fleet/contracts";
import { schema, newId } from "@fleet/db";
import { branchFilter } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { AppError, conflict, notFound, validation } from "../infra/errors.js";
import { readCapped } from "../files/read-capped.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { FuelService } from "../m2/fuel.service.js";
import { DefectService } from "../m4/defect.service.js";
import { MeterService } from "../m2/meter.service.js";

const U = schema.uploads;
const F = schema.fuelEntries;
type UploadRow = typeof U.$inferSelect;

const stateOf = (u: UploadRow): UploadState => ({
  uploadId: u.id, recordType: u.recordType, recordId: u.recordId, totalBytes: u.totalBytes, receivedBytes: u.receivedBytes, completed: !!u.completedAt,
});

/**
 * OFF-008 / US-E14-05: photos after text, resumable. The device starts an upload for a record that the server
 * already accepted, then sends chunks at the offset the server reports. A dropped connection resumes from
 * there; a retried chunk is harmless. When the last byte arrives the SHA-256 is checked and the file is
 * attached through the same path as a direct upload.
 */
@Controller()
export class UploadsController {
  constructor(private readonly tdb: TenantDb, private readonly fuel: FuelService, private readonly defects: DefectService, private readonly meter: MeterService) {}

  /** The record a photo belongs to (fuel receipt, defect or meter photo), locked and in scope, with how to attach the file. */
  private async target(tx: Tx, ctx: RequestContext, recordType: UploadRow["recordType"], id: string) {
    if (recordType === "odometer_photo") {
      const [r] = await tx.select().from(schema.meterReadings).where(eq(schema.meterReadings.id, id)).for("update");
      if (!r) throw notFound("reading");
      const [v] = await tx.select({ branchId: schema.vehicles.branchId }).from(schema.vehicles).where(eq(schema.vehicles.id, r.vehicleId));
      const branchId = v?.branchId ?? "";
      if (ctx.role === "driver" ? r.createdBy !== ctx.identityId : !!branchFilter(ctx, ctx.scope!) && !branchFilter(ctx, ctx.scope!)!.includes(branchId)) throw notFound("reading");
      return {
        branchId, hasFile: !!r.photoFileKey, exists: () => conflict("photo_exists", "A photo is already attached"),
        attach: (file: Buffer) => this.meter.attachPhoto(tx, ctx, r, file, branchId),
      };
    }
    if (recordType === "defect_photo") {
      const [d] = await tx.select().from(schema.defects).where(eq(schema.defects.id, id)).for("update");
      if (!d) throw notFound("defect");
      if (ctx.role === "driver" ? d.createdBy !== ctx.identityId : !!branchFilter(ctx, ctx.scope!) && !branchFilter(ctx, ctx.scope!)!.includes(d.branchId)) throw notFound("defect");
      return {
        branchId: d.branchId, hasFile: !!d.photoFileKey, exists: () => conflict("photo_exists", "A photo is already attached"),
        attach: (file: Buffer) => this.defects.attachPhoto(tx, ctx, d, file),
      };
    }
    const e = await this.fuelEntry(tx, ctx, id);
    return {
      branchId: e.branchId, hasFile: !!e.receiptFileKey, exists: () => conflict("receipt_exists", "A receipt is already attached; request a correction to change it"),
      attach: (file: Buffer) => this.fuel.attachReceipt(tx, ctx, e, file),
    };
  }

  /** The fuel entry the photo belongs to, locked and in the caller's scope (drivers: their own entries). */
  private async fuelEntry(tx: Tx, ctx: RequestContext, id: string) {
    const [e] = await tx.select().from(F).where(eq(F.id, id)).for("update");
    if (!e) throw notFound("fuel entry");
    if (ctx.role === "driver") {
      if (e.createdBy !== ctx.identityId) throw notFound("fuel entry");
    } else {
      const filter = branchFilter(ctx, ctx.scope!);
      if (filter && !filter.includes(e.branchId)) throw notFound("fuel entry");
    }
    return e;
  }

  @Requires("fuel.create") @Post(routes.startUpload.path) @HttpCode(200)
  async start(@Body(new ZodPipe(routes.startUpload.body)) b: z.output<typeof routes.startUpload.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      // Text first: the record must already exist (404 tells the device to sync the event before the photo).
      const t = await this.target(tx, ctx, b.recordType, b.recordId);
      const [u] = await tx.select().from(U).where(and(eq(U.recordType, b.recordType), eq(U.recordId, b.recordId))).for("update");
      if (u) {
        if (u.createdBy !== ctx.identityId) throw conflict("upload_in_progress", "Another upload is attached to this record");
        if (u.completedAt || (u.sha256 === b.sha256 && u.totalBytes === b.totalBytes)) return stateOf(u);
        // A different file for the same record before completion (the photo was retaken): start over.
        const [reset] = await tx.update(U).set({ sha256: b.sha256, totalBytes: b.totalBytes, receivedBytes: 0, data: null, updatedAt: new Date() }).where(eq(U.id, u.id)).returning();
        return stateOf(reset!);
      }
      if (t.hasFile) throw t.exists();
      const [row] = await tx.insert(U).values({ id: newId(), recordType: b.recordType, recordId: b.recordId, totalBytes: b.totalBytes, sha256: b.sha256, createdBy: ctx.identityId }).returning();
      return stateOf(row!);
    });
  }

  @Requires("fuel.create") @Patch(routes.uploadChunk.path) @HttpCode(200)
  async chunk(@Param("id", ParseUUIDPipe) id: string, @Req() req: Request, @Ctx() ctx: RequestContext) {
    const offset = Number(req.headers["upload-offset"]);
    if (!Number.isInteger(offset) || offset < 0) throw validation({ uploadOffset: "required" });
    const bytes = await readCapped(req, DEFAULTS.UPLOAD_CHUNK_MAX_BYTES);
    const db = await this.tdb.for(ctx);
    const out = await db.transaction(async (tx): Promise<UploadState | "checksum_mismatch"> => {
      const [u] = await tx.select().from(U).where(eq(U.id, id)).for("update");
      if (!u || u.createdBy !== ctx.identityId) throw notFound("upload");
      if (u.completedAt) return stateOf(u);
      // Ahead of what the server has: the device must resume from receivedBytes.
      if (offset > u.receivedBytes) {
        throw new AppError(HttpStatus.CONFLICT, "offset_mismatch", "Resume from the received offset", { uploadOffset: String(u.receivedBytes) });
      }
      // A retried chunk overlaps what is already stored: keep only the new tail.
      const fresh = bytes.subarray(u.receivedBytes - offset);
      if (u.receivedBytes + fresh.length > u.totalBytes) throw validation({ uploadOffset: "beyond_total" });
      let row = u;
      if (fresh.length) {
        [row] = (await tx.update(U).set({
          data: sql`coalesce(${U.data}, ''::bytea) || ${fresh}`, receivedBytes: u.receivedBytes + fresh.length, updatedAt: new Date(),
        }).where(eq(U.id, id)).returning()) as [UploadRow];
      }
      if (row.receivedBytes < row.totalBytes) return stateOf(row);

      // Complete: check the whole file, then attach it like a direct upload.
      const file = Buffer.from(row.data ?? Buffer.alloc(0));
      if (createHash("sha256").update(file).digest("hex") !== row.sha256) {
        // Reset is committed; the error is raised after the transaction (throwing here would roll it back).
        await tx.update(U).set({ data: null, receivedBytes: 0, updatedAt: new Date() }).where(eq(U.id, id));
        return "checksum_mismatch";
      }
      const t = await this.target(tx, ctx, row.recordType, row.recordId);
      await t.attach(file);
      const [done] = await tx.update(U).set({ data: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(U.id, id)).returning();
      await TenantDb.audit(tx, ctx, "upload.completed", "upload", id, { recordType: row.recordType, recordId: row.recordId, bytes: row.totalBytes }, null, t.branchId);
      return stateOf(done!);
    });
    if (out === "checksum_mismatch") throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, "checksum_mismatch", "The file arrived damaged; send it again from the start");
    return out;
  }
}
