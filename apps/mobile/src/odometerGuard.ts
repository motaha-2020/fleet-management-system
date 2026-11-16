import { t } from "./theme";

/** Biggest believable distance since the last reading before the driver is asked to check the number again. */
export const ODOMETER_JUMP_KM = 2000;

/**
 * QA 16 Nov 2026: a reading below the last one (or far above it) is almost always a typo. Returns the warning to show,
 * or null. The screen keeps the value the driver was warned about: pressing Submit again with the same number goes
 * through (the server still flags it for the approver).
 */
export function odometerWarning(odo: number, last: number | null, alreadyWarned: number | null): string | null {
  if (last == null || alreadyWarned === odo) return null;
  const fmt = (n: number) => n.toLocaleString("en");
  if (odo < last) return t.driverApp.odometerBelowLast.replace("{value}", fmt(odo)).replace("{last}", fmt(last));
  if (odo - last > ODOMETER_JUMP_KM) return t.driverApp.odometerBigJump.replace("{value}", fmt(odo)).replace("{last}", fmt(last)).replace("{diff}", fmt(odo - last));
  return null;
}
