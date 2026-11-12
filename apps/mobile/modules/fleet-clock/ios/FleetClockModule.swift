import ExpoModulesCore

public class FleetClockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FleetClock")

    // On Darwin CLOCK_MONOTONIC keeps counting while the device sleeps.
    Function("monotonicMs") { () -> Double in
      Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1_000_000
    }

    Function("bootId") { () -> String in
      var tv = timeval()
      var size = MemoryLayout<timeval>.size
      sysctlbyname("kern.boottime", &tv, &size, nil, 0)
      return "ios:\(tv.tv_sec)"
    }
  }
}
