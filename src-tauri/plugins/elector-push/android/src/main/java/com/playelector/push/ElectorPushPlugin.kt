package com.playelector.push

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Android mirror of ios/Sources/ElectorPushPlugin.swift: a single
 * `registerForPush` command that reads the device's FCM registration token and
 * resolves `{ token, platform, environment }` (or `{ error }`). It NEVER rejects —
 * the JS side (src/utils/pushRegistration.ts) treats a failure as a soft no-op.
 *
 * FirebaseApp auto-initializes from the app module's google-services.json; if that
 * wiring is missing, getInstance() throws and we resolve an error rather than
 * crash. `environment` is always "prod" on Android (FCM has no sandbox host).
 */
@TauriPlugin
class ElectorPushPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun registerForPush(invoke: Invoke) {
    try {
      FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
        val result = task.result
        if (task.isSuccessful && !result.isNullOrEmpty()) {
          val data = JSObject()
          data.put("token", result)
          data.put("platform", "android")
          data.put("environment", "prod")
          invoke.resolve(data)
        } else {
          invoke.resolve(error(task.exception?.message ?: "FCM token unavailable."))
        }
      }
    } catch (e: Exception) {
      invoke.resolve(error(e.message ?: "Firebase is not configured."))
    }
  }

  private fun error(message: String): JSObject {
    val data = JSObject()
    data.put("error", message)
    return data
  }
}
