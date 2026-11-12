import { Injectable } from "@nestjs/common";
import { asc, eq, inArray } from "drizzle-orm";
import { DEFAULTS } from "@fleet/config";
import { schema } from "@fleet/db";
import {
  cumulative, currentOdometer, effectiveInterval, isTrusted, maintenanceDue, templateMatches, validDistance,
  type IsoDate, type ItemDue, type Reading, type Replacement,
} from "@fleet/domain";
import type { DbOrTx } from "../m2/common.js";
import { toDomain } from "../m2/meter.service.js";

type VehicleRow = typeof schema.vehicles.$inferSelect;
const T = schema.maintenanceTemplates;
const TI = schema.maintenanceTemplateItems;

export interface VehicleItem {
  code: string; name: string; safety: boolean; templateId: string;
  intervalKm: number | null; intervalMonths: number | null; overridden: boolean;
  baseline: { doneOn: IsoDate; odometer: number | null; sourceType: "visit" | "opening" } | null;
  due: ItemDue;
}
export interface VehicleMaintenanceState { vehicleId: string; currentOdometer: number | null; kmPerDay: number | null; items: VehicleItem[] }

/**
 * E10 preventive maintenance (MNT-001..005). The template that applies to a vehicle is the most specific
 * active one by make/model; a vehicle override replaces an item's interval for that vehicle only. Due status is
 * computed on the continuous (cumulative) odometer scale so meter replacements do not reset intervals.
 */
@Injectable()
export class MaintenanceService {
  /** Batch evaluation for many vehicles (due list, readiness lists). */
  async evaluate(db: DbOrTx, vehicles: readonly VehicleRow[], today: IsoDate, now = Date.now()): Promise<Map<string, VehicleMaintenanceState>> {
    const out = new Map<string, VehicleMaintenanceState>();
    if (!vehicles.length) return out;
    const ids = vehicles.map((v) => v.id);
    const templates = await db.select().from(T).where(eq(T.status, "active"));
    const items = templates.length ? await db.select().from(TI).where(inArray(TI.templateId, templates.map((t) => t.id))) : [];
    const overrides = await db.select().from(schema.vehicleMaintenanceOverrides).where(inArray(schema.vehicleMaintenanceOverrides.vehicleId, ids));
    const baselines = await db.select().from(schema.maintenanceBaselines).where(inArray(schema.maintenanceBaselines.vehicleId, ids));
    const readings = await db.select().from(schema.meterReadings).where(inArray(schema.meterReadings.vehicleId, ids)).orderBy(asc(schema.meterReadings.eventAt));
    const reps = await db.select().from(schema.meterReplacements).where(inArray(schema.meterReplacements.vehicleId, ids)).orderBy(asc(schema.meterReplacements.eventAt));

    for (const v of vehicles) {
      const template = templates
        .map((t) => ({ t, score: templateMatches(t, v) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id))[0]?.t;
      const rs = readings.filter((r) => r.vehicleId === v.id);
      const domain: Reading[] = rs.map(toDomain);
      const replacements: Replacement[] = reps.filter((r) => r.vehicleId === v.id).map((r) => ({ at: r.eventAt.getTime(), oldFinal: r.oldFinal, newStart: r.newStart }));
      const cur = currentOdometer(domain, replacements);
      const window = DEFAULTS.MNT_FORECAST_WINDOW_DAYS * 86_400_000;
      const dist = validDistance(domain, replacements, now - window, now);
      const kmPerDay = dist.value != null && dist.quality === "reliable" ? dist.value / DEFAULTS.MNT_FORECAST_WINDOW_DAYS : null;

      const list: VehicleItem[] = [];
      for (const i of items.filter((x) => template && x.templateId === template.id && x.status === "active")) {
        const ov = overrides.find((o) => o.vehicleId === v.id && o.itemCode === i.code);
        const interval = effectiveInterval({ km: i.intervalKm, months: i.intervalMonths }, ov ? { km: ov.intervalKm, months: ov.intervalMonths } : null);
        const b = baselines.find((x) => x.vehicleId === v.id && x.itemCode === i.code);
        let baseline = null;
        if (b) {
          const reading = b.readingId ? rs.find((r) => r.id === b.readingId) : undefined;
          const at = reading ? reading.eventAt.getTime() : Date.parse(`${b.doneOn}T12:00:00Z`);
          const cumKm = b.odometer != null ? cumulative(b.odometer, at, replacements) : null;
          // MNT-005: a baseline whose reading is not trusted gives an Estimated due point.
          const estimated = b.sourceType === "visit" && (!reading || !isTrusted(reading.status));
          baseline = { cumKm, date: b.doneOn, estimated };
        }
        const due = maintenanceDue(interval, baseline, { date: today, cumKm: cur?.cumulative ?? null, kmPerDay });
        list.push({
          code: i.code, name: i.name, safety: i.safety, templateId: i.templateId, intervalKm: interval.km, intervalMonths: interval.months, overridden: !!ov,
          baseline: b ? { doneOn: b.doneOn, odometer: b.odometer, sourceType: b.sourceType } : null, due,
        });
      }
      out.set(v.id, { vehicleId: v.id, currentOdometer: cur?.value ?? null, kmPerDay: kmPerDay != null ? Math.round(kmPerDay * 10) / 10 : null, items: list });
    }
    return out;
  }

  async forVehicle(db: DbOrTx, v: VehicleRow, today: IsoDate) {
    return (await this.evaluate(db, [v], today)).get(v.id)!;
  }
}
