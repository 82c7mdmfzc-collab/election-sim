import Foundation
import GoogleMobileAdsTarget
import ObjectiveC
import SwiftRs
import Tauri
import UIKit
import UserMessagingPlatformTarget
import WebKit

private let productionRewardedAdUnitId = "ca-app-pub-5364561069734393/7845987969"

private typealias NoArgClassMethod = @convention(c) (AnyClass, Selector) -> AnyObject
private typealias NoArgInstanceMethod = @convention(c) (AnyObject, Selector) -> AnyObject
private typealias StartMethod = @convention(c) (AnyObject, Selector, AnyObject?) -> Void
private typealias BoolInstanceMethod = @convention(c) (AnyObject, Selector) -> Bool
private typealias ErrorHandler = @convention(block) (NSError?) -> Void
private typealias ConsentUpdateMethod = @convention(c) (
  AnyObject,
  Selector,
  AnyObject,
  ErrorHandler
) -> Void
private typealias ConsentFormMethod = @convention(c) (
  AnyClass,
  Selector,
  UIViewController?,
  ErrorHandler
) -> Void
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
  let claimToken: String?
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
    let args = try invoke.parseArgs(ShowRewardedAdArgs.self)
    DispatchQueue.main.async {
      self.loadAndShow(invoke, claimToken: args.claimToken)
    }
  }

  @objc public func showPrivacyOptions(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.refreshAndShowPrivacyOptions(invoke)
    }
  }

  private func refreshAndShowPrivacyOptions(_ invoke: Invoke) {
    guard let viewController = manager.viewController,
          let consentType = NSClassFromString("UMPConsentInformation"),
          let requestType = NSClassFromString("UMPRequestParameters"),
          let formType = NSClassFromString("UMPConsentForm"),
          let sharedInstance = objcClassMethod(consentType, "sharedInstance", as: NoArgClassMethod.self),
          let allocate = objcClassMethod(requestType, "alloc", as: NoArgClassMethod.self) else {
      resolvePrivacy(invoke, completed: false, error: "Google ad privacy controls are unavailable.")
      return
    }
    let consent = sharedInstance(consentType, NSSelectorFromString("sharedInstance"))
    let allocated = allocate(requestType, NSSelectorFromString("alloc"))
    let parameters = objcInstanceMethod(allocated, "init", as: NoArgInstanceMethod.self)?(
      allocated,
      NSSelectorFromString("init")
    ) ?? allocated
    guard let update = objcInstanceMethod(
      consent,
      "requestConsentInfoUpdateWithParameters:completionHandler:",
      as: ConsentUpdateMethod.self
    ) else {
      resolvePrivacy(invoke, completed: false, error: "Google ad privacy controls cannot be refreshed.")
      return
    }
    let updateHandler: ErrorHandler = { [weak self] requestError in
      DispatchQueue.main.async {
        guard let plugin = self else { return }
        if let requestError {
          plugin.resolvePrivacy(invoke, completed: false, error: requestError.localizedDescription)
          return
        }
        guard let present = objcClassMethod(
          formType,
          "presentPrivacyOptionsFormFromViewController:completionHandler:",
          as: ConsentFormMethod.self
        ) else {
          plugin.resolvePrivacy(invoke, completed: false, error: "Ad privacy choices cannot be presented.")
          return
        }
        let formHandler: ErrorHandler = { [weak plugin] formError in
          DispatchQueue.main.async {
            plugin?.resolvePrivacy(
              invoke,
              completed: formError == nil,
              error: formError?.localizedDescription
            )
          }
        }
        present(
          formType,
          NSSelectorFromString("presentPrivacyOptionsFormFromViewController:completionHandler:"),
          viewController,
          formHandler
        )
      }
    }
    update(
      consent,
      NSSelectorFromString("requestConsentInfoUpdateWithParameters:completionHandler:"),
      parameters,
      updateHandler
    )
  }

  private func resolvePrivacy(_ invoke: Invoke, completed: Bool, error: String?) {
    invoke.resolve([
      "completed": completed,
      "error": error ?? NSNull()
    ])
  }

  private func loadAndShow(_ invoke: Invoke, claimToken: String?) {
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

    pendingInvoke = invoke
    didEarnReward = false

    gatherConsentAndLoad(from: viewController, claimToken: claimToken)
  }

  private func gatherConsentAndLoad(from viewController: UIViewController, claimToken: String?) {
    guard let consentType = NSClassFromString("UMPConsentInformation"),
          let requestType = NSClassFromString("UMPRequestParameters"),
          let formType = NSClassFromString("UMPConsentForm"),
          let sharedInstance = objcClassMethod(consentType, "sharedInstance", as: NoArgClassMethod.self),
          let allocate = objcClassMethod(requestType, "alloc", as: NoArgClassMethod.self) else {
      finish(completed: false, error: "Google ad privacy controls are unavailable in this build.")
      return
    }
    let consent = sharedInstance(consentType, NSSelectorFromString("sharedInstance"))
    let allocated = allocate(requestType, NSSelectorFromString("alloc"))
    let parameters = objcInstanceMethod(allocated, "init", as: NoArgInstanceMethod.self)?(
      allocated,
      NSSelectorFromString("init")
    ) ?? allocated
    guard let update = objcInstanceMethod(
      consent,
      "requestConsentInfoUpdateWithParameters:completionHandler:",
      as: ConsentUpdateMethod.self
    ) else {
      finish(completed: false, error: "Google ad privacy controls cannot be refreshed.")
      return
    }

    let updateHandler: ErrorHandler = { [weak self] requestError in
      DispatchQueue.main.async {
        guard let plugin = self else { return }
        if let requestError {
          // A refresh failure can still use valid consent from an earlier app
          // session, matching Google's recommended UMP fallback behavior.
          if plugin.canRequestAds(consent) {
            plugin.loadRewardedAd(from: viewController, claimToken: claimToken)
          } else {
            plugin.finish(
              completed: false,
              error: "Ad privacy status is unavailable: \(requestError.localizedDescription)"
            )
          }
          return
        }
        guard let loadForm = objcClassMethod(
          formType,
          "loadAndPresentIfRequiredFromViewController:completionHandler:",
          as: ConsentFormMethod.self
        ) else {
          plugin.finish(completed: false, error: "Google ad privacy choices cannot be presented.")
          return
        }
        let formHandler: ErrorHandler = { [weak plugin] formError in
          DispatchQueue.main.async {
            guard let plugin else { return }
            if let formError, !plugin.canRequestAds(consent) {
              plugin.finish(
                completed: false,
                error: "Ad privacy choices could not be completed: \(formError.localizedDescription)"
              )
            } else if plugin.canRequestAds(consent) {
              plugin.loadRewardedAd(from: viewController, claimToken: claimToken)
            } else {
              plugin.finish(
                completed: false,
                error: "Ads are unavailable until privacy choices are completed."
              )
            }
          }
        }
        loadForm(
          formType,
          NSSelectorFromString("loadAndPresentIfRequiredFromViewController:completionHandler:"),
          viewController,
          formHandler
        )
      }
    }
    update(
      consent,
      NSSelectorFromString("requestConsentInfoUpdateWithParameters:completionHandler:"),
      parameters,
      updateHandler
    )
  }

  private func canRequestAds(_ consent: AnyObject) -> Bool {
    guard let method = objcInstanceMethod(consent, "canRequestAds", as: BoolInstanceMethod.self) else {
      return false
    }
    return method(consent, NSSelectorFromString("canRequestAds"))
  }

  private func loadRewardedAd(from viewController: UIViewController, claimToken: String?) {
    startAdsIfNeeded()

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
        plugin.configureServerVerification(ad, claimToken: claimToken)
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

  private func configureServerVerification(_ ad: AnyObject, claimToken: String?) {
    guard let claimToken, !claimToken.isEmpty,
          let optionsType = NSClassFromString("GADServerSideVerificationOptions"),
          let allocate = objcClassMethod(optionsType, "alloc", as: NoArgClassMethod.self) else { return }
    let allocated = allocate(optionsType, NSSelectorFromString("alloc"))
    let options: AnyObject
    if let initialize = objcInstanceMethod(allocated, "init", as: NoArgInstanceMethod.self) {
      options = initialize(allocated, NSSelectorFromString("init"))
    } else {
      options = allocated
    }
    if let setCustom = objcInstanceMethod(options, "setCustomRewardString:", as: SetDelegateMethod.self) {
      setCustom(options, NSSelectorFromString("setCustomRewardString:"), claimToken as NSString)
    }
    if let setOptions = objcInstanceMethod(ad, "setServerSideVerificationOptions:", as: SetDelegateMethod.self) {
      setOptions(ad, NSSelectorFromString("setServerSideVerificationOptions:"), options)
    }
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
