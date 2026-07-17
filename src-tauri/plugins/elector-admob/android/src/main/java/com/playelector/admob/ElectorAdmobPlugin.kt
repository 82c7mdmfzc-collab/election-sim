package com.playelector.admob

import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.ads.mediation.admob.AdMobAdapter
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform

// Google's public TEST rewarded unit — the fallback when tauri.conf.json carries
// no androidRewardedAdUnitId. Dev safety net only; never ship a build without the
// real unit configured (scripts/android-upload.sh asserts this).
private const val TEST_REWARDED_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917"

@InvokeArg
class ShowRewardedAdArgs {
  var placement: String = ""
  var claimToken: String? = null
}

// Read from `plugins.elector-admob` in tauri.conf.json. The config JSON also
// carries iOS keys; Tauri's shared Jackson mapper has FAIL_ON_UNKNOWN_PROPERTIES
// disabled, so declaring only the Android fields is safe.
class AdmobConfig {
  var androidRewardedAdUnitId: String? = null
}

/**
 * Android mirror of ios/Sources/ElectorAdmobPlugin.swift: a single
 * `showRewardedAd` command that loads then presents a rewarded ad and resolves
 * `{ completed, provider, adUnit, error }`. It NEVER rejects — the JS side
 * (src/utils/rewardedAds.ts) treats resolve-with-error as a soft failure.
 *
 * Consent is refreshed through Google's UMP SDK before an ad request. Requests
 * remain explicitly non-personalized as a conservative default.
 */
@TauriPlugin
class ElectorAdmobPlugin(private val activity: Activity) : Plugin(activity) {
  private var started = false
  private var pendingInvoke: Invoke? = null
  private var didEarnReward = false
  private var activeAdUnitId = TEST_REWARDED_AD_UNIT_ID

  override fun load(webView: WebView) {
    val configured = try {
      getConfig(AdmobConfig::class.java).androidRewardedAdUnitId
    } catch (_: Exception) {
      null // missing/odd config block — keep the test-unit fallback
    }
    if (!configured.isNullOrEmpty()) {
      activeAdUnitId = configured
    }
  }

  @Command
  fun showRewardedAd(invoke: Invoke) {
    val args = invoke.parseArgs(ShowRewardedAdArgs::class.java)
    activity.runOnUiThread { loadAndShow(invoke, args.claimToken) }
  }

  @Command
  fun showPrivacyOptions(invoke: Invoke) {
    activity.runOnUiThread {
      val consent = UserMessagingPlatform.getConsentInformation(activity)
      val parameters = ConsentRequestParameters.Builder().build()
      consent.requestConsentInfoUpdate(
        activity,
        parameters,
        {
          UserMessagingPlatform.showPrivacyOptionsForm(activity) { formError ->
            invoke.resolve(privacyResult(formError == null, formError?.message))
          }
        },
        { requestError -> invoke.resolve(privacyResult(false, requestError.message)) },
      )
    }
  }

  private fun loadAndShow(invoke: Invoke, claimToken: String?) {
    if (pendingInvoke != null) {
      invoke.resolve(result(false, "An ad is already in progress."))
      return
    }
    pendingInvoke = invoke
    didEarnReward = false

    val consent = UserMessagingPlatform.getConsentInformation(activity)
    val parameters = ConsentRequestParameters.Builder().build()
    consent.requestConsentInfoUpdate(
      activity,
      parameters,
      {
        UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { formError ->
          if (formError != null && !consent.canRequestAds()) {
            finish(false, "Ad privacy choices could not be completed: ${formError.message}")
          } else if (consent.canRequestAds()) {
            loadRewardedAd(claimToken)
          } else {
            finish(false, "Ads are unavailable until privacy choices are completed.")
          }
        }
      },
      { requestError ->
        // UMP allows requests with the previous session's consent state when a
        // refresh fails (for example, a temporary network outage).
        if (consent.canRequestAds()) loadRewardedAd(claimToken)
        else finish(false, "Ad privacy status is unavailable: ${requestError.message}")
      },
    )
  }

  private fun loadRewardedAd(claimToken: String?) {
    if (!started) {
      started = true
      MobileAds.initialize(activity) {}
    }

    val extras = Bundle().apply { putString("npa", "1") }
    val request = AdRequest.Builder()
      .addNetworkExtrasBundle(AdMobAdapter::class.java, extras)
      .build()

    RewardedAd.load(activity, activeAdUnitId, request, object : RewardedAdLoadCallback() {
      override fun onAdFailedToLoad(error: LoadAdError) {
        finish(false, error.message)
      }

      override fun onAdLoaded(ad: RewardedAd) {
        if (!claimToken.isNullOrBlank()) {
          ad.setServerSideVerificationOptions(
            ServerSideVerificationOptions.Builder().setCustomData(claimToken).build(),
          )
        }
        ad.fullScreenContentCallback = object : FullScreenContentCallback() {
          override fun onAdDismissedFullScreenContent() {
            finish(didEarnReward, if (didEarnReward) null else "Ad closed before the reward.")
          }

          override fun onAdFailedToShowFullScreenContent(error: AdError) {
            finish(false, error.message)
          }
        }
        ad.show(activity) { didEarnReward = true }
      }
    })
  }

  private fun result(completed: Boolean, error: String?): JSObject {
    val data = JSObject()
    data.put("completed", completed)
    data.put("provider", "admob")
    data.put("adUnit", activeAdUnitId)
    if (error != null) data.put("error", error)
    return data
  }

  private fun privacyResult(completed: Boolean, error: String?): JSObject {
    val data = JSObject()
    data.put("completed", completed)
    if (error != null) data.put("error", error)
    return data
  }

  private fun finish(completed: Boolean, error: String?) {
    didEarnReward = false
    val invoke = pendingInvoke
    pendingInvoke = null
    invoke?.resolve(result(completed, error))
  }
}
