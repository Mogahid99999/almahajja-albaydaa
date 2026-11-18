import ExpoModulesCore

public class ElapsedClockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ElapsedClock")
    // On Apple platforms CLOCK_MONOTONIC keeps counting while the device sleeps.
    Function("elapsedRealtime") { () -> Double in
      Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1_000_000
    }
  }
}
