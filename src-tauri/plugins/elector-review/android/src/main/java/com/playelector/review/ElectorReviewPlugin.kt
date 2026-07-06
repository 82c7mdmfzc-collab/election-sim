package com.playelector.review

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * Android mirror of ios/Sources/ElectorReviewPlugin.swift: a single
 * `requestReview` command that runs the Play In-App Review flow and resolves
 * `{ requested, error }`. It NEVER rejects — the JS side (src/utils/appReview.ts)
 * treats any failure as a soft no-op.
 *
 * Like iOS, Play decides whether a card is actually shown (quota + already-rated
 * suppression), so `requested: true` means the flow launched, not that the user
 * saw a prompt.
 */
@TauriPlugin
class ElectorReviewPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun requestReview(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        val manager = ReviewManagerFactory.create(activity)
        manager.requestReviewFlow().addOnCompleteListener { request ->
          if (request.isSuccessful) {
            manager.launchReviewFlow(activity, request.result).addOnCompleteListener {
              invoke.resolve(result(true, null))
            }
          } else {
            invoke.resolve(result(false, request.exception?.message ?: "Review flow unavailable."))
          }
        }
      } catch (e: Exception) {
        invoke.resolve(result(false, e.message))
      }
    }
  }

  private fun result(requested: Boolean, error: String?): JSObject {
    val data = JSObject()
    data.put("requested", requested)
    if (error != null) data.put("error", error)
    return data
  }
}
