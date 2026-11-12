package expo.modules.fleetclock

import android.os.SystemClock
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FleetClockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FleetClock")

    // Counts through deep sleep; not affected by the wall clock or the time zone.
    Function("monotonicMs") {
      SystemClock.elapsedRealtime().toDouble()
    }

    // Settings.Global.BOOT_COUNT goes up by one on every boot (API 24+).
    Function("bootId") {
      val resolver = appContext.reactContext?.contentResolver
      val count = if (resolver != null) Settings.Global.getInt(resolver, Settings.Global.BOOT_COUNT, -1) else -1
      "android:$count"
    }
  }
}
