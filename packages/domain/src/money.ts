import type { Measured } from "./meter.js";

/** Money is integer minor units (piasters) + currency (Architecture §7). */
export interface Money { netMinor: number; taxMinor: number; grossMinor: number; currency: string }

export function money(netMinor: number, taxMinor: number, currency: string): Money {
  if (!Number.isInteger(netMinor) || !Number.isInteger(taxMinor)) throw new RangeError("amounts must be integer minor units");
  return { netMinor, taxMinor, grossMinor: netMinor + taxMinor, currency };
}

/**
 * FIN-005 + FIN-013: reports use Net, except that non-recoverable tax is part of the cost
 * (e.g. fuel in Egypt) — then the reported cost is Gross.
 */
export const reportedCost = (m: Pick<Money, "netMinor" | "grossMinor">, taxRecoverable: boolean) => (taxRecoverable ? m.netMinor : m.grossMinor);

/**
 * FIN-009 / Worked Example E3: cost per km over valid distance. No usable distance (0, or
 * unavailable) → Unavailable, never 0 or ∞. Quality is inherited from the distance.
 */
export function costPerKm(costMinor: number, distance: Measured): Measured {
  if (distance.value === null || distance.value <= 0 || distance.quality === "unavailable") return { value: null, quality: "unavailable" };
  return { value: Math.round((costMinor / distance.value) * 100) / 100, quality: distance.quality };
}
