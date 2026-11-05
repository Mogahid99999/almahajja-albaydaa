package expo.modules.liveforeground

import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
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

  /**
   * Native timers for livekit-client's CriticalTimers (signal ping / ping timeout).
   *
   * React Native's JS timers run off the Choreographer frame clock, which stops while the app is
   * in the background — the live's WebRTC audio (native) keeps playing, but the SDK's ping and
   * ping timeout freeze, and the overdue timeout fires the instant the app returns («ping timeout
   * triggered», device log 2026-11-06) → reconnect / full re-join («جارٍ الدخول إلى الحلقة»,
   * ~35 s of silence on the 2026-11-05 prod live). A headless JS task does NOT help on the New
   * Architecture (verified on device). These timers run on the main Looper, which keeps running
   * in the background, and fire as JS events (events do reach JS in the background).
   */
  private val main = Handler(Looper.getMainLooper())
  private val timers = HashMap<Int, Runnable>() // main thread only

  private fun clearTimer(id: Int) {
    timers.remove(id)?.let { main.removeCallbacks(it) }
  }

  override fun definition() = ModuleDefinition {
    Name("LiveForeground")
    Events("onAction", "onTimer")

    OnCreate { instance = this@LiveForegroundModule }
    OnDestroy {
      main.post {
        for (r in timers.values) main.removeCallbacks(r)
        timers.clear()
      }
      if (instance === this@LiveForegroundModule) instance = null
    }

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

    /** One-shot (repeat=false) or repeating timer; fires `onTimer {id}` after `ms`. */
    Function("setTimer") { id: Int, ms: Double, repeat: Boolean ->
      val delay = ms.toLong().coerceAtLeast(0L)
      main.post {
        clearTimer(id)
        val r = object : Runnable {
          override fun run() {
            if (timers[id] !== this) return
            if (repeat) main.postDelayed(this, delay.coerceAtLeast(1L)) else timers.remove(id)
            sendEvent("onTimer", mapOf("id" to id))
          }
        }
        timers[id] = r
        main.postDelayed(r, delay)
      }
    }

    Function("clearTimer") { id: Int ->
      main.post { clearTimer(id) }
    }
  }
}
