// Native in-app review for the Elector iOS app.
//
// Presents Apple's review prompt via AppStore.requestReview(in:) (iOS 16+) or
// SKStoreReviewController.requestReview(in:) (iOS 15). iOS itself decides whether
// to actually show the sheet — it caps prompts (~3/365 days) and never re-shows to
// a user who already rated — so the command resolves `requested: true` once the
// request is made, which is NOT a promise the sheet appeared.
//
// The command ALWAYS resolves (never rejects); a missing window scene resolves
// `requested: false` with a reason so the JS caller can treat it as a soft no-op.

import Foundation
import StoreKit
import SwiftRs
import Tauri
import UIKit
import WebKit

class ElectorReviewPlugin: Plugin {
  @objc public func requestReview(_ invoke: Invoke) {
    DispatchQueue.main.async {
      // The active foreground window scene — required by both review APIs.
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
      else {
        invoke.resolve(["requested": false, "error": "No active window scene."])
        return
      }

      if #available(iOS 16.0, *) {
        AppStore.requestReview(in: scene)
      } else {
        SKStoreReviewController.requestReview(in: scene)
      }
      invoke.resolve(["requested": true])
    }
  }
}

@_cdecl("init_plugin_elector_review")
func initPlugin() -> Plugin {
  return ElectorReviewPlugin()
}
