package com.riwaqalilm.bubble

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * FloatingBubble — a resume nudge drawn over other apps (PLAN_V3 Phase 9).
 *
 * The JS policy layer (src/lib/bubble.ts) owns quiet hours / cap / gap; this
 * module owns the window + the unlock (ACTION_USER_PRESENT) trigger. It emits
 * `onUserPresent` so JS can decide to `show(...)`, and `onBubbleTap` (with the
 * carried lessonId + positionSec) when the bubble is tapped, so JS can deep-link
 * the player to the exact second.
 *
 * Reference implementation — see ../README.md for activation. Deliberately
 * minimal (a single text chip); brand styling (IBM Plex Arabic / Amiri, logo,
 * brass border) is added once the layout is finalized.
 */
class FloatingBubbleModule : Module() {
  private var overlay: View? = null
  private var userPresentReceiver: BroadcastReceiver? = null
  private var lastLessonId: String? = null
  private var lastPositionSec: Int = 0
  private val mainHandler = Handler(Looper.getMainLooper())
  /** App font (IBM Plex Arabic) bundled in this module's assets — cached, since
   *  createFromAsset is costly. Falls back to the system font if it can't load. */
  private var appTypeface: Typeface? = null
  private fun appFont(): Typeface? {
    appTypeface?.let { return it }
    return runCatching {
      Typeface.createFromAsset(context.assets, "fonts/IBMPlexSansArabic-Medium.ttf")
    }.getOrNull()?.also { appTypeface = it }
  }

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  private fun canDrawOverlays(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

  override fun definition() = ModuleDefinition {
    Name("FloatingBubble")

    Events("onUserPresent", "onBubbleTap")

    OnCreate {
      val filter = IntentFilter(Intent.ACTION_USER_PRESENT)
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
          // Unlock = a real usage moment; let JS decide whether to surface.
          sendEvent("onUserPresent", emptyMap<String, Any?>())
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        context.registerReceiver(receiver, filter)
      }
      userPresentReceiver = receiver
    }

    OnDestroy {
      userPresentReceiver?.let { runCatching { context.unregisterReceiver(it) } }
      userPresentReceiver = null
      hideOverlay()
    }

    AsyncFunction("hasPermission") { canDrawOverlays() }

    AsyncFunction("requestPermission") {
      if (!canDrawOverlays() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
    }

    AsyncFunction("show") { payload: Map<String, Any?> ->
      val lessonId = payload["lessonId"] as? String ?: return@AsyncFunction
      val positionSec = (payload["positionSec"] as? Number)?.toInt() ?: 0
      // The chip now shows a calm resume phrase (picked JS-side), not the title.
      val text = payload["text"] as? String ?: ""
      lastLessonId = lessonId
      lastPositionSec = positionSec
      runOnUi { showOverlay(text) }
    }

    AsyncFunction("hide") { runOnUi { hideOverlay() } }
  }

  // WindowManager.addView/removeView must run on a thread with a Looper; the
  // module callbacks may arrive off the main thread (esp. while backgrounded),
  // so always post to the main looper rather than the (possibly null) activity.
  private fun runOnUi(block: () -> Unit) {
    mainHandler.post(block)
  }

  private fun showOverlay(message: String) {
    if (!canDrawOverlays() || overlay != null) return
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    val density = context.resources.displayMetrics.density
    val chip = TextView(context).apply {
      text = if (message.isBlank()) "تابع درسك" else message
      setTextColor(Color.WHITE)
      textSize = 15f
      // Use the app's font (IBM Plex Arabic) so the chip matches the in-app type.
      appFont()?.let { typeface = it }
      gravity = Gravity.CENTER
      // Rounded calm-teal pill instead of a flat rectangle.
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#1f4a42"))
        cornerRadius = 22f * density // ~22dp radius
      }
      // Wider with more breathing room; long resume phrases wrap inside maxWidth.
      val padH = (20f * density).toInt()
      val padV = (13f * density).toInt()
      setPadding(padH, padV, padH, padV)
      minWidth = (200f * density).toInt()
      maxWidth = (300f * density).toInt()
      setLineSpacing(0f, 1.15f)
      setOnClickListener {
        // Bring the app to the foreground so the JS deep-link lands on the player.
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        runCatching { if (launch != null) context.startActivity(launch) }
        sendEvent(
          "onBubbleTap",
          mapOf("lessonId" to lastLessonId, "positionSec" to lastPositionSec),
        )
        hideOverlay()
      }
    }

    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else
        @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = 24
      y = 160
    }

    runCatching {
      wm.addView(chip, params)
      overlay = chip
      // Auto-dismiss so the bubble never sits on screen indefinitely.
      mainHandler.postDelayed({ hideOverlay() }, AUTO_DISMISS_MS)
    }
  }

  private companion object {
    const val AUTO_DISMISS_MS = 8000L
  }

  private fun hideOverlay() {
    val view = overlay ?: return
    val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    runCatching { wm.removeView(view) }
    overlay = null
  }
}
