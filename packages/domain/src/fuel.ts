import { DEFAULTS } from "@fleet/config";
import type { Measured, Quality } from "./meter.js";

export type FuelEntryStatus = "submitted" | "under_review" | "accepted" | "voided";
export const FUEL_STATUSES: readonly FuelEntryStatus[] = ["submitted", "under_review", "accepted", "voided"];

/** Conflict flags block the entry from KPIs until reviewed; warnings only send it to review. */
export const FUEL_CONFLICT_FLAGS = ["tank_exceeded", "odometer_conflict", "possible_duplicate"] as const;
export const FUEL_WARNING_FLAGS = ["fuel_type_mismatch", "price_deviation", "no_assignment", "odometer_warning", "missing_receipt"] as const;
export type FuelFlag = (typeof FUEL_CONFLICT_FLAGS)[number] | (typeof FUEL_WARNING_FLAGS)[number];
export const isConflictFlag = (f: string) => (FUEL_CONFLICT_FLAGS as readonly string[]).includes(f);

export interface FuelCheckInput {
  vehicle: { primaryFuelType: string; primaryTankCapacity: number; secondaryFuelType: string | null; secondaryTankCapacity: number | null };
  fuelType: string;
  quantity: number;
  grossMinor: number;
  at: number;
  /** Official price for the fuel type valid at the event time (FUEL-017), else a company reference. */
  reference: { priceMinor: number; official: boolean } | null;
  /** Other non-voided entries of the vehicle near this one, for duplicate detection (FUEL-006). */
  nearby: readonly { id: string; at: number; quantity: number; grossMinor: number; receiptRef: string | null }[];
  receiptRef: string | null;
  hasAssignment: boolean;
  odometer: "valid" | "warning" | "conflict";
}

/** Rules FUEL-004..008 + FUEL-016. Pure: the API supplies the context. */
export function fuelFlags(e: FuelCheckInput, cfg = {
  tankTol: DEFAULTS.FUEL_TANK_TOLERANCE, priceTol: DEFAULTS.FUEL_PRICE_TOLERANCE,
  officialTol: DEFAULTS.FUEL_OFFICIAL_PRICE_TOLERANCE, dupMinutes: DEFAULTS.FUEL_DUPLICATE_WINDOW_MINUTES,
}): FuelFlag[] {
  const flags: FuelFlag[] = [];
  const v = e.vehicle;
  const capacity = e.fuelType === v.primaryFuelType ? v.primaryTankCapacity : e.fuelType === v.secondaryFuelType ? v.secondaryTankCapacity : null;
  if (capacity === null) flags.push("fuel_type_mismatch");
  // Tank check uses the capacity of the chosen fuel's tank; for an unknown type, the larger tank.
  const cap = capacity ?? Math.max(v.primaryTankCapacity, v.secondaryTankCapacity ?? 0);
  if (e.quantity > cap * (1 + cfg.tankTol) + 1e-9) flags.push("tank_exceeded");
  if (e.reference && e.reference.priceMinor > 0) {
    const unit = e.grossMinor / e.quantity;
    const tol = e.reference.official ? cfg.officialTol : cfg.priceTol;
    if (Math.abs(unit - e.reference.priceMinor) / e.reference.priceMinor > tol + 1e-9) flags.push("price_deviation");
  }
  const dup = e.nearby.some((n) =>
    (e.receiptRef && n.receiptRef && n.receiptRef === e.receiptRef) ||
    (Math.abs(n.at - e.at) <= cfg.dupMinutes * 60_000 && n.grossMinor === e.grossMinor && Math.abs(n.quantity - e.quantity) < 1e-6));
  if (dup) flags.push("possible_duplicate");
  if (!e.hasAssignment) flags.push("no_assignment");
  if (e.odometer === "conflict") flags.push("odometer_conflict");
  if (e.odometer === "warning") flags.push("odometer_warning");
  return flags;
}

/** FUEL-002 (review mode "flagged only"): clean entries are accepted, flagged ones wait for review. */
export const initialFuelStatus = (flags: readonly FuelFlag[]): FuelEntryStatus => (flags.length ? "under_review" : "accepted");

export interface CycleEntry {
  id: string;
  at: number;
  fuelType: string;
  quantity: number;
  isFull: boolean;
  status: FuelEntryStatus;
  flags: readonly string[];
  /** Cumulative odometer of the entry's reading, and whether that reading is trusted. */
  odometerCum: number;
  odometerTrusted: boolean;
}

export interface Cycle { fuelType: string; startId: string; endId: string; startAt: number; endAt: number; quantity: number; km: number; per100: number | null; quality: Quality }

/**
 * FUEL-011/012/016: Full-to-Full, separately per fuel type. Quantity = everything after the
 * previous Full up to and including the current Full. The cycle is Reliable only if both boundary
 * readings are trusted and no entry in it is in conflict or still under review; voided entries are
 * ignored entirely.
 */
export function fullToFullCycles(entries: readonly CycleEntry[]): Cycle[] {
  const cycles: Cycle[] = [];
  const byType = new Map<string, CycleEntry[]>();
  for (const e of entries) {
    if (e.status === "voided") continue;
    byType.set(e.fuelType, [...(byType.get(e.fuelType) ?? []), e]);
  }
  for (const [fuelType, list] of byType) {
    list.sort((a, b) => a.at - b.at || a.odometerCum - b.odometerCum);
    let start: CycleEntry | null = null;
    let inner: CycleEntry[] = [];
    for (const e of list) {
      if (!start) {
        if (e.isFull) start = e;
        continue;
      }
      inner.push(e);
      if (!e.isFull) continue;
      const quantity = inner.reduce((s, x) => s + x.quantity, 0);
      const km = e.odometerCum - start.odometerCum;
      const clean = start.odometerTrusted && e.odometerTrusted && km > 0
        && inner.every((x) => x.status === "accepted" && !x.flags.some(isConflictFlag));
      cycles.push({
        fuelType, startId: start.id, endId: e.id, startAt: start.at, endAt: e.at, quantity: round3(quantity), km,
        per100: km > 0 ? round2((quantity / km) * 100) : null, quality: clean ? "reliable" : km > 0 ? "partial" : "unavailable",
      });
      start = e;
      inner = [];
    }
  }
  return cycles.sort((a, b) => a.endAt - b.endAt);
}

/** Consumption for cycles ending in a period: Σ quantity ÷ Σ km over Reliable cycles (FUEL-011). */
export function consumption(cycles: readonly Cycle[]): Measured {
  const reliable = cycles.filter((c) => c.quality === "reliable");
  if (!reliable.length) return { value: null, quality: "unavailable" };
  const q = reliable.reduce((s, c) => s + c.quantity, 0);
  const km = reliable.reduce((s, c) => s + c.km, 0);
  return { value: round2((q / km) * 100), quality: reliable.length === cycles.length ? "reliable" : "partial" };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
