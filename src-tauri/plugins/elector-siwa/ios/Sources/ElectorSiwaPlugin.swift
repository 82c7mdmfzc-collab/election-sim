// Native Sign in with Apple for the Elector iOS app.
//
// Presents ASAuthorizationController and returns the identity token together
// with the raw nonce. The nonce is generated HERE (SecRandomCopyBytes) and
// hashed HERE (CryptoKit SHA-256) — never in the webview, whose crypto.subtle
// availability under the tauri:// scheme is not guaranteed. Supabase receives
// the raw nonce with signInWithIdToken and verifies it against the token's
// hashed nonce claim.
//
// Contract with the Rust/JS side: the command ALWAYS resolves with a `status`
// ("authorized" | "cancelled" | "error") — rejection is reserved for a missing
// plugin/permission, which is what triggers the JS browser-OAuth fallback.

import AuthenticationServices
import CryptoKit
import Foundation
import SwiftRs
import Tauri
import UIKit
import WebKit

class ElectorSiwaPlugin: Plugin, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private var pendingInvoke: Invoke?
  private var currentRawNonce: String?
  // Kept alive for the duration of the flow — ASAuthorizationController does not
  // retain itself while the sheet is up.
  private var controller: ASAuthorizationController?

  @objc public func signInWithApple(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      self.begin(invoke)
    }
  }

  private func begin(_ invoke: Invoke) {
    if pendingInvoke != nil {
      invoke.resolve(["status": "error", "error": "Sign-in already in progress."])
      return
    }

    guard let rawNonce = Self.randomNonceHex() else {
      invoke.resolve(["status": "error", "error": "Could not generate a secure nonce."])
      return
    }

    pendingInvoke = invoke
    currentRawNonce = rawNonce

    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.fullName, .email]
    request.nonce = Self.sha256Hex(rawNonce)

    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    self.controller = controller
    controller.performRequests()
  }

  private static func randomNonceHex() -> String? {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      return nil
    }
    return bytes.map { String(format: "%02x", $0) }.joined()
  }

  private static func sha256Hex(_ input: String) -> String {
    SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  // MARK: ASAuthorizationControllerPresentationContextProviding

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    // The key window of the active scene — reliable on iPad, where an arbitrary
    // window can misplace or refuse the sheet.
    let sceneWindows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    if let key = sceneWindows.first(where: { $0.isKeyWindow }) {
      return key
    }
    if let window = manager.viewController?.view.window {
      return window
    }
    return ASPresentationAnchor()
  }

  // MARK: ASAuthorizationControllerDelegate

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    let invoke = pendingInvoke
    let rawNonce = currentRawNonce
    clear()

    guard
      let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
      let tokenData = credential.identityToken,
      let identityToken = String(data: tokenData, encoding: .utf8),
      let rawNonce = rawNonce
    else {
      invoke?.resolve(["status": "error", "error": "Apple returned no identity token."])
      return
    }

    var payload: [String: Any] = [
      "status": "authorized",
      "identityToken": identityToken,
      "rawNonce": rawNonce,
    ]
    // Name/email only arrive on the FIRST authorization for this Apple ID.
    if let givenName = credential.fullName?.givenName { payload["givenName"] = givenName }
    if let familyName = credential.fullName?.familyName { payload["familyName"] = familyName }
    if let email = credential.email { payload["email"] = email }
    invoke?.resolve(payload)
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithError error: Error
  ) {
    let invoke = pendingInvoke
    clear()

    if let authError = error as? ASAuthorizationError, authError.code == .canceled {
      // The user dismissed the sheet — an expected action, not an error.
      invoke?.resolve(["status": "cancelled"])
      return
    }
    invoke?.resolve(["status": "error", "error": error.localizedDescription])
  }

  private func clear() {
    pendingInvoke = nil
    currentRawNonce = nil
    controller = nil
  }
}

@_cdecl("init_plugin_elector_siwa")
func initPlugin() -> Plugin {
  return ElectorSiwaPlugin()
}
