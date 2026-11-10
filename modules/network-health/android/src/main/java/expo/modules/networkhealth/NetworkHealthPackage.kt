package expo.modules.networkhealth

import android.app.Application
import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.NetworkingModule
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import java.util.concurrent.TimeUnit

/**
 * React Native's HTTP client has no connect timeout and never checks a pooled
 * connection. After the app sits idle, a connection the network dropped
 * silently is reused and every request to that server waits on it until the
 * app restarts (seen 2026-11-10: registration «تعذّر إكمال العملية» twice,
 * fine after a restart). A ping on HTTP/2 connections finds such a connection
 * within seconds, so the request is retried on a new one.
 */
class NetworkHealthPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          NetworkingModule.setCustomClientBuilder { builder ->
            builder
              .pingInterval(PING_SECONDS, TimeUnit.SECONDS)
              .connectTimeout(CONNECT_SECONDS, TimeUnit.SECONDS)
          }
          Log.i("NetworkHealth", "HTTP ping ${PING_SECONDS}s, connect timeout ${CONNECT_SECONDS}s")
        }
      },
    )

  private companion object {
    const val PING_SECONDS = 8L
    const val CONNECT_SECONDS = 15L
  }
}
