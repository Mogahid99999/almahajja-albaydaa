package expo.modules.liveforeground

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LiveForegroundModule : Module() {
  companion object {
    @Volatile private var instance: LiveForegroundModule? = null

    /** Called by the service when the notification's «مغادرة» action is tapped. */
    /** Returns false when no JS runtime is listening (the service must clean up alone). */
    fun emitAction(action: String): Boolean {
      val module = instance ?: return false
      module.sendEvent("onAction", mapOf("action" to action))
      return true
    }
  }

  override fun definition() = ModuleDefinition {
    Name("LiveForeground")
    Events("onAction")

    OnCreate { instance = this@LiveForegroundModule }
    OnDestroy { if (instance === this@LiveForegroundModule) instance = null }

    /** Starts (or refreshes) the foreground service. Call while the app is in the foreground. */
    Function("start") { title: String, text: String, withMic: Boolean, url: String? ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, LiveForegroundService::class.java)
        .setAction(LiveForegroundService.ACTION_START)
        .putExtra(LiveForegroundService.EXTRA_TITLE, title)
        .putExtra(LiveForegroundService.EXTRA_TEXT, text)
        .putExtra(LiveForegroundService.EXTRA_MIC, withMic)
        .putExtra(LiveForegroundService.EXTRA_URL, url)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      true
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function false
      context.stopService(Intent(context, LiveForegroundService::class.java))
    }
  }
}
