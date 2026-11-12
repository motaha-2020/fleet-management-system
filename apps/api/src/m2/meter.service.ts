import { Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { schema, newId, type ReadingSource } from "@fleet/db";
import { classifyReading, cumulative, type Reading, type Replacement } from "@fleet/domain";
import type { MeterReading } from "@fleet/contracts";
import type { DbOrTx } from "./common.js";

const R = schema.meterReadings;
type Row = typeof R.$inferSelect;

/**
 * The odometer ledger (ODO-001..010). Every source writes through `record`, which classifies the
 * reading against the vehicle's history (the caller holds the vehicle row lock, so readings of one
 * vehicle are serialized). Readings are never rewritten: a correction marks the old one Corrected
 * and adds a new version.
 */
@Injectable()
export class MeterService {
  async history(db: DbOrTx, vehicleId: string) {
    const readings = await db.select().from(R).where(eq(R.vehicleId, vehicleId)).orderBy(asc(R.eventAt));
    const reps = await db.select().from(schema.meterReplacements).where(eq(schema.meterReplacements.vehicleId, vehicleId)).orderBy(asc(schema.meterReplacements.eventAt));
    const replacements: Replacement[] = reps.map((r) => ({ at: r.eventAt.getTime(), oldFinal: r.oldFinal, newStart: r.newStart }));
    return { rows: readings, reps, replacements, domain: readings.map(toDomain) };
  }

  async record(
    tx: DbOrTx,
    input: { id?: string; vehicleId: string; value: number; at: Date; sourceType: ReadingSource; sourceId: string | null; createdBy: string; excludeIds?: string[] },
  ): Promise<Row> {
    const { domain, replacements } = await this.history(tx, input.vehicleId);
    const others = domain.filter((r) => !input.excludeIds?.includes(r.id));
    const c = classifyReading({ value: input.value, at: input.at.getTime(), source: input.sourceType }, others, replacements);
    const [row] = await tx.insert(R).values({
      id: input.id ?? newId(), vehicleId: input.vehicleId, value: input.value, eventAt: input.at, sourceType: input.sourceType, sourceId: input.sourceId,
      status: c.status, reasons: c.reasons, corroborates: c.corroborates, createdBy: input.createdBy,
    }).returning();
    return row!;
  }

  toDto(r: Row, replacements: readonly Replacement[]): MeterReading {
    return {
      id: r.id, vehicleId: r.vehicleId, value: r.value, cumulative: cumulative(r.value, r.eventAt.getTime(), replacements),
      eventAt: r.eventAt.toISOString(), recordedAt: r.recordedAt.toISOString(), sourceType: r.sourceType, sourceId: r.sourceId,
      status: r.status, reasons: r.reasons, corroborates: r.corroborates, correctedBy: r.correctedBy,
    };
  }
}

export const toDomain = (r: Row): Reading => ({ id: r.id, value: r.value, at: r.eventAt.getTime(), status: r.status, source: r.sourceType });
