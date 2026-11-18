package expo.modules.storeupdate

import android.util.Log
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Store update prompt (2026-11-18): the app learns by itself that Google Play
 * has a newer build, with nothing typed in the admin panel.
 *
 * - `check()` asks Play. Anything that goes wrong (no Play Store, the app was
 *   not installed from Play, no network) answers «no update»: the prompt is a
 *   courtesy and must never get in the way.
 * - `start()` opens Play's own full-screen update (download, install, restart).
 *   It answers false when Play can't run it, and the app then opens the Play
 *   page instead.
 */
class StoreUpdateModule : Module() {
  private val manager by lazy {
    AppUpdateManagerFactory.create(requireNotNull(appContext.reactContext).applicationContext)
  }

  override fun definition() = ModuleDefinition {
    Name("StoreUpdate")

    AsyncFunction("check") { promise: Promise ->
      Log.i(TAG, "check: asking Google Play")
      try {
        manager.appUpdateInfo
          .addOnSuccessListener { info ->
            Log.i(TAG, "check: availability=${info.updateAvailability()} versionCode=${info.availableVersionCode()}")
            promise.resolve(
              mapOf(
                "available" to isPending(info),
                "availableVersionCode" to info.availableVersionCode(),
              ),
            )
          }
          .addOnFailureListener { e ->
            Log.i(TAG, "check failed: ${e.message}")
            promise.resolve(mapOf("available" to false))
          }
      } catch (e: Exception) {
        Log.i(TAG, "check failed: ${e.message}")
        promise.resolve(mapOf("available" to false))
      }
    }

    AsyncFunction("start") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      try {
        // A fresh info: Play accepts each one for a single update flow.
        manager.appUpdateInfo
          .addOnSuccessListener { info ->
            val started = try {
              isPending(info) &&
                info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE) &&
                manager.startUpdateFlowForResult(
                  info,
                  activity,
                  AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
                  REQUEST_CODE,
                )
            } catch (e: Exception) {
              Log.i(TAG, "start failed: ${e.message}")
              false
            }
            promise.resolve(started)
          }
          .addOnFailureListener { e ->
            Log.i(TAG, "start failed: ${e.message}")
            promise.resolve(false)
          }
      } catch (e: Exception) {
        Log.i(TAG, "start failed: ${e.message}")
        promise.resolve(false)
      }
    }
  }

  // An update Play began and the person interrupted still counts: start()
  // resumes it.
  private fun isPending(info: AppUpdateInfo) =
    info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
      info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS

  private companion object {
    const val TAG = "StoreUpdate"
    const val REQUEST_CODE = 4817
  }
}
