package expo.modules.liveforeground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder

/**
 * Foreground service for a live «الحلقة» session (V23 P3). WebRTC keeps playing only while the
 * process is foreground-important, so joining a room starts this service with a quiet, ongoing
 * «مباشر الآن» notification. Listener = mediaPlayback; a speaker (P4) adds microphone.
 */
class LiveForegroundService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.liveforeground.START"
    const val ACTION_LEAVE = "expo.modules.liveforeground.LEAVE"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_MIC = "withMic"
    const val EXTRA_URL = "url"
    private const val CHANNEL_ID = "live_session"
    private const val NOTIFICATION_ID = 4711
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_LEAVE) {
      // The JS side leaves the room and then stops this service. No JS left
      // (runtime gone) → nothing would ever stop us: clear the notification here.
      if (!LiveForegroundModule.emitAction("leave")) stopNow()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "مباشر الآن"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val withMic = intent?.getBooleanExtra(EXTRA_MIC, false) ?: false
    val url = intent?.getStringExtra(EXTRA_URL)
    val notification = buildNotification(title, text, url)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      if (withMic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      }
      startForeground(NOTIFICATION_ID, notification, type)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // App swiped away from Recents. The process (and the JS room) survive while
    // this service runs, so ask JS to leave the room properly (live-control
    // `leave`, audio released) — then drop the service either way.
    LiveForegroundModule.emitAction("leave")
    stopNow()
    super.onTaskRemoved(rootIntent)
  }

  private fun stopNow() {
    stopForeground(STOP_FOREGROUND_REMOVE) // minSdk 24
    stopSelf()
  }

  private fun buildNotification(title: String, text: String, url: String?): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(CHANNEL_ID, "البث المباشر", NotificationManager.IMPORTANCE_LOW)
      channel.setShowBadge(false)
      channel.setSound(null, null)
      manager.createNotificationChannel(channel)
    }
    val immutable = PendingIntent.FLAG_IMMUTABLE
    val openIntent = (if (url != null) Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(packageName) else null)
      ?: packageManager.getLaunchIntentForPackage(packageName)
      ?: Intent()
    openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val contentIntent = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
    val leaveIntent = PendingIntent.getService(
      this, 1, Intent(this, LiveForegroundService::class.java).setAction(ACTION_LEAVE),
      PendingIntent.FLAG_UPDATE_CURRENT or immutable,
    )
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 } ?: applicationInfo.icon
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
    }
    return builder
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .setContentIntent(contentIntent)
      .addAction(Notification.Action.Builder(null, "مغادرة", leaveIntent).build())
      .build()
  }
}
