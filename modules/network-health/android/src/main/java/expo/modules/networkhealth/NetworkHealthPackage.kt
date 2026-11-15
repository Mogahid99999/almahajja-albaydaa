package expo.modules.networkhealth

import android.app.Activity
import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import com.facebook.react.modules.network.NetworkingModule
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import okhttp3.ConnectionPool
import java.util.concurrent.TimeUnit

/**
 * React Native's HTTP client has no connect timeout and never checks a pooled
 * connection. After the app sits idle, a connection the network dropped
 * silently is reused and every request to that server fails or waits until
 * the app restarts (2026-11-10: registration «تعذّر إكمال العملية»;
 * 2026-11-15: after a long background or a locked screen, sign-in said
 * «تعذّر الاتصال بالخادم» and lectures would not open until the app was
 * closed and reopened).
 *
 * - A ping on HTTP/2 connections finds a dead connection within seconds.
 * - Every request uses ONE connection pool we own, and that pool is emptied
 *   when the app returns after [STALE_AFTER_MS] in the background and whenever
 *   the default network changes (Wi-Fi ↔ mobile data), so the next request
 *   always opens a fresh connection instead of reusing a dead one.
 */
class NetworkHealthPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          NetworkingModule.setCustomClientBuilder { builder ->
            builder
              .connectionPool(POOL)
              .pingInterval(PING_SECONDS, TimeUnit.SECONDS)
              .connectTimeout(CONNECT_SECONDS, TimeUnit.SECONDS)
          }
          watchForeground(application)
          watchNetwork(application)
          Log.i(TAG, "HTTP ping ${PING_SECONDS}s, connect timeout ${CONNECT_SECONDS}s, shared pool")
        }
      },
    )

  private fun watchForeground(app: Application) {
    app.registerActivityLifecycleCallbacks(
      object : Application.ActivityLifecycleCallbacks {
        private var resumed = 0
        private var backgroundSince = 0L

        override fun onActivityResumed(activity: Activity) {
          if (resumed++ == 0 && backgroundSince > 0 &&
            SystemClock.elapsedRealtime() - backgroundSince >= STALE_AFTER_MS
          ) {
            evict("foreground after ${(SystemClock.elapsedRealtime() - backgroundSince) / 1000}s")
          }
          backgroundSince = 0L
        }

        override fun onActivityPaused(activity: Activity) {
          if (--resumed <= 0) {
            resumed = 0
            backgroundSince = SystemClock.elapsedRealtime()
          }
        }

        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
        override fun onActivityStarted(activity: Activity) {}
        override fun onActivityStopped(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {}
      },
    )
  }

  private fun watchNetwork(context: Context) {
    try {
      val cm = context.getSystemService(ConnectivityManager::class.java) ?: return
      cm.registerDefaultNetworkCallback(
        object : ConnectivityManager.NetworkCallback() {
          private var current: Network? = null

          override fun onAvailable(network: Network) {
            // The first callback only reports the network we already have.
            if (current != null && current != network) evict("network changed")
            current = network
          }

          override fun onLost(network: Network) {
            if (current == network) {
              evict("network lost")
              current = null
            }
          }
        },
      )
    } catch (e: Exception) {
      Log.w(TAG, "network callback unavailable: ${e.message}")
    }
  }

  private fun evict(why: String) {
    try {
      // evictAll closes the idle connections (after a background, all of
      // them); a dead one still carrying a call is closed by the ping.
      POOL.evictAll()
      Log.i(TAG, "connection pool emptied ($why)")
    } catch (e: Exception) {
      Log.w(TAG, "evict failed: ${e.message}")
    }
  }

  private companion object {
    const val TAG = "NetworkHealth"
    const val PING_SECONDS = 8L
    const val CONNECT_SECONDS = 15L
    const val STALE_AFTER_MS = 30_000L
    val POOL = ConnectionPool()
  }
}
