import { requireOptionalNativeModule } from "expo";

/**
 * Monotonic time for the Offline Grant (Architecture §8.2): it keeps counting while the app is
 * closed and the phone sleeps, and the driver cannot change it from the phone settings.
 * It resets on reboot, so bootId() tells the app when an earlier reading no longer applies.
 */
export interface FleetClockNative {
  /** Milliseconds since boot, including deep sleep (Android elapsedRealtime / iOS CLOCK_MONOTONIC). */
  monotonicMs(): number;
  /** Changes on every reboot (Android BOOT_COUNT / iOS kern.boottime). */
  bootId(): string;
}

/** null in Expo Go and on web: the native module is only in a dev/production build. */
export default requireOptionalNativeModule<FleetClockNative>("FleetClock");
