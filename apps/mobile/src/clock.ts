import FleetClock from "../modules/fleet-clock";

/**
 * Clock for the Offline Grant. With the native module (dev/production build) the reading is
 * monotonic across app restarts until the phone reboots. Without it (Expo Go, web) there is no
 * trustworthy elapsed time and every offline event is flagged time_unverified.
 */
export interface ClockReading { monotonicMs: number; bootId: string }

export const clock = {
  native: FleetClock !== null,
  read(): ClockReading | null {
    if (!FleetClock) return null;
    return { monotonicMs: FleetClock.monotonicMs(), bootId: FleetClock.bootId() };
  },
  /** ms elapsed since `since`, or null when the phone rebooted or the native clock is missing. */
  elapsedSince(since: ClockReading | null): number | null {
    const now = this.read();
    if (!now || !since || now.bootId !== since.bootId || now.bootId.endsWith(":-1")) return null;
    const ms = now.monotonicMs - since.monotonicMs;
    return ms >= 0 ? ms : null;
  },
};
