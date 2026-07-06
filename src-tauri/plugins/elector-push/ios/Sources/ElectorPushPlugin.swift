// Native remote-push registration for the Elector iOS app.
//
// Tauri owns the UIApplicationDelegate, and the APNs device token only arrives via
// `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` on that
// delegate — there is no NotificationCenter event for it. So we swizzle the two
// remote-notification callbacks onto the live delegate class (the standard
// technique for push in a framework-owned app), then trigger
// registerForRemoteNotifications() from the `registerForPush` command and resolve
// the pending invoke(s) when the swizzled callback fires.
//
// The command ALWAYS resolves: success → { token, platform: "ios", environment },
// failure → { error }. `environment` picks the APNs host server-side: DEBUG
// (Xcode) builds use the sandbox gateway, release (TestFlight/App Store) use prod.

import Foundation
import ObjectiveC.runtime
import SwiftRs
import Tauri
import UIKit
import WebKit

class ElectorPushPlugin: Plugin {
  private static let lock = NSLock()
  private static var pending: [Invoke] = []
  private static var swizzled = false

  override func load(webview: WKWebView) {
    ElectorPushPlugin.swizzleAppDelegate()
  }

  @objc public func registerForPush(_ invoke: Invoke) {
    DispatchQueue.main.async {
      ElectorPushPlugin.enqueue(invoke)
      // Ensure the callbacks are wired even if load() ran before the delegate set.
      ElectorPushPlugin.swizzleAppDelegate()
      UIApplication.shared.registerForRemoteNotifications()
    }
  }

  private static func enqueue(_ invoke: Invoke) {
    lock.lock(); pending.append(invoke); lock.unlock()
  }

  private static func drain() -> [Invoke] {
    lock.lock(); let invokes = pending; pending = []; lock.unlock()
    return invokes
  }

  fileprivate static func deliverToken(_ deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    #if DEBUG
    let environment = "sandbox"
    #else
    let environment = "prod"
    #endif
    for invoke in drain() {
      invoke.resolve(["token": hex, "platform": "ios", "environment": environment])
    }
  }

  fileprivate static func deliverError(_ message: String) {
    for invoke in drain() {
      invoke.resolve(["error": message])
    }
  }

  // Add (or replace) the remote-notification delegate methods on the app delegate.
  // Tauri's generated AppDelegate implements neither, so class_addMethod is the
  // path taken; method type encoding is `v@:@@` (void; self, _cmd, UIApplication*,
  // NSData*/NSError*).
  private static func swizzleAppDelegate() {
    lock.lock(); defer { lock.unlock() }
    if swizzled { return }
    guard let delegate = UIApplication.shared.delegate else { return }
    let cls: AnyClass = type(of: delegate)

    let didRegister: @convention(block) (AnyObject, UIApplication, Data) -> Void = { _, _, token in
      ElectorPushPlugin.deliverToken(token)
    }
    install(cls, #selector(UIApplicationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:)), didRegister)

    let didFail: @convention(block) (AnyObject, UIApplication, Error) -> Void = { _, _, error in
      ElectorPushPlugin.deliverError(error.localizedDescription)
    }
    install(cls, #selector(UIApplicationDelegate.application(_:didFailToRegisterForRemoteNotificationsWithError:)), didFail)

    swizzled = true
  }

  private static func install(_ cls: AnyClass, _ selector: Selector, _ block: Any) {
    let imp = imp_implementationWithBlock(block)
    let typeEncoding = "v@:@@"
    if let method = class_getInstanceMethod(cls, selector) {
      method_setImplementation(method, imp)
    } else {
      class_addMethod(cls, selector, imp, typeEncoding)
    }
  }
}

@_cdecl("init_plugin_elector_push")
func initPlugin() -> Plugin {
  return ElectorPushPlugin()
}
