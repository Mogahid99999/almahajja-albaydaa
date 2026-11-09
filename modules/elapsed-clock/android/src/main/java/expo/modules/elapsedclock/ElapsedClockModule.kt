package expo.modules.elapsedclock

import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ElapsedClockModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ElapsedClock")
    // Keeps counting in deep sleep and across app restarts; resets only on reboot.
    Function("elapsedRealtime") { SystemClock.elapsedRealtime().toDouble() }
  }
}
