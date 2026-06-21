import Foundation
import GoogleMobileAdsTarget
import ObjectiveC
import SwiftRs
import Tauri
import UIKit
import WebKit

private let productionRewardedAdUnitId = "ca-app-pub-5364561069734393/7845987969"

private typealias NoArgClassMethod = @convention(c) (AnyClass, Selector) -> AnyObject
private typealias StartMethod = @convention(c) (AnyObject, Selector, AnyObject?) -> Void
private typealias RewardedLoadCompletion = @convention(block) (AnyObject?, NSError?) -> Void
private typealias RewardedLoadMethod = @convention(c) (
  AnyClass,
  Selector,
  NSString,
  AnyObject?,
  RewardedLoadCompletion
) -> Void
private typealias SetDelegateMethod = @convention(c) (AnyObject, Selector, AnyObject?) -> Void
private typealias RewardHandler = @convention(block) () -> Void
private typealias PresentMethod = @convention(c) (
  AnyObject,
  Selector,
  UIViewController?,
  RewardHandler
) -> Void

private func objcClassMethod<T>(_ type: AnyClass, _ selectorName: String, as methodType: T.Type) -> T? {
  let selector = NSSelectorFromString(selectorName)
  guard let method = class_getClassMethod(type, selector) else { return nil }
  return unsafeBitCast(method_getImplementation(method), to: methodType)
}

private func objcInstanceMethod<T>(_ object: AnyObject, _ selectorName: String, as methodType: T.Type) -> T? {
  let selector = NSSelectorFromString(selectorName)
  guard let type = object_getClass(object),
        let method = class_getInstanceMethod(type, selector) else { return nil }
  return unsafeBitCast(method_getImplementation(method), to: methodType)
}

class AdMobConfig: Decodable {
  let iosRewardedAdUnitId: String?
}

class ShowRewardedAdArgs: Decodable {
  let placement: String
}

class ElectorAdmobPlugin: Plugin {
  private var started = false
  private var rewardedAd: AnyObject?
  private var pendingInvoke: Invoke?
  private var didEarnReward = false
  private var activeAdUnitId: String = productionRewardedAdUnitId

  override func load(webview: WKWebView) {
    loadConfig()
  }

  @objc public func showRewardedAd(_ invoke: Invoke) throws {
    _ = try invoke.parseArgs(ShowRewardedAdArgs.self)
    DispatchQueue.main.async {
      self.loadAndShow(invoke)
    }
  }

  private func loadAndShow(_ invoke: Invoke) {
    if pendingInvoke != nil {
      invoke.resolve([
        "completed": false,
        "provider": "admob",
        "adUnit": activeAdUnitId,
        "error": "An ad is already in progress."
      ])
      return
    }

    guard let viewController = manager.viewController else {
      invoke.resolve([
        "completed": false,
        "provider": "admob",
        "adUnit": activeAdUnitId,
        "error": "No iOS view controller is available."
      ])
      return
    }

    startAdsIfNeeded()
    pendingInvoke = invoke
    didEarnReward = false

    guard let rewardedAdType = NSClassFromString("GADRewardedAd"),
          let requestType = NSClassFromString("GADRequest"),
          let makeRequest = objcClassMethod(requestType, "request", as: NoArgClassMethod.self),
          let loadRewardedAd = objcClassMethod(
            rewardedAdType,
            "loadWithAdUnitID:request:completionHandler:",
            as: RewardedLoadMethod.self
          ) else {
      finish(completed: false, error: "Google Mobile Ads is not available in this build.")
      return
    }

    let request = makeRequest(requestType, NSSelectorFromString("request"))
    let completion: RewardedLoadCompletion = { [weak self] ad, error in
      DispatchQueue.main.async {
        guard let plugin = self else { return }
        if let error {
          plugin.finish(completed: false, error: error.localizedDescription)
          return
        }
        guard let ad else {
          plugin.finish(completed: false, error: "No rewarded ad was returned.")
          return
        }
        guard let present = objcInstanceMethod(
          ad,
          "presentFromRootViewController:userDidEarnRewardHandler:",
          as: PresentMethod.self
        ) else {
          plugin.finish(completed: false, error: "Rewarded ads cannot be presented in this build.")
          return
        }

        plugin.rewardedAd = ad
        if let setDelegate = objcInstanceMethod(ad, "setFullScreenContentDelegate:", as: SetDelegateMethod.self) {
          setDelegate(ad, NSSelectorFromString("setFullScreenContentDelegate:"), plugin)
        }
        let rewardHandler: RewardHandler = { [weak plugin] in
          plugin?.didEarnReward = true
        }
        present(
          ad,
          NSSelectorFromString("presentFromRootViewController:userDidEarnRewardHandler:"),
          viewController,
          rewardHandler
        )
      }
    }
    loadRewardedAd(
      rewardedAdType,
      NSSelectorFromString("loadWithAdUnitID:request:completionHandler:"),
      activeAdUnitId as NSString,
      request,
      completion
    )
  }

  private func startAdsIfNeeded() {
    guard !started else { return }
    started = true

    loadConfig()

    guard let mobileAdsType = NSClassFromString("GADMobileAds"),
          let sharedInstance = objcClassMethod(mobileAdsType, "sharedInstance", as: NoArgClassMethod.self) else {
      return
    }
    let mobileAds = sharedInstance(mobileAdsType, NSSelectorFromString("sharedInstance"))
    if let start = objcInstanceMethod(mobileAds, "startWithCompletionHandler:", as: StartMethod.self) {
      start(mobileAds, NSSelectorFromString("startWithCompletionHandler:"), nil as AnyObject?)
    }
  }

  private func loadConfig() {
    if let config = try? parseConfig(AdMobConfig.self),
       let adUnit = config.iosRewardedAdUnitId,
       !adUnit.isEmpty {
      activeAdUnitId = adUnit
    }
  }

  @objc(adDidDismissFullScreenContent:)
  public func adDidDismissFullScreenContent(_ ad: AnyObject) {
    finish(completed: didEarnReward, error: didEarnReward ? nil : "Ad closed before the reward.")
  }

  @objc(ad:didFailToPresentFullScreenContentWithError:)
  public func ad(_ ad: AnyObject, didFailToPresentFullScreenContentWithError error: NSError) {
    finish(completed: false, error: error.localizedDescription)
  }

  private func finish(completed: Bool, error: String?) {
    rewardedAd = nil
    didEarnReward = false
    let invoke = pendingInvoke
    pendingInvoke = nil

    invoke?.resolve([
      "completed": completed,
      "provider": "admob",
      "adUnit": activeAdUnitId,
      "error": error ?? NSNull()
    ])
  }
}

@_cdecl("init_plugin_elector_admob")
func initPlugin() -> Plugin {
  return ElectorAdmobPlugin()
}
