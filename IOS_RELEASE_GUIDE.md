# Elector iOS TestFlight Release Guide

This is the copy-paste handoff for building the first iOS TestFlight release from this repo.

## Current State

- Bundle ID: `com.playelector.app`
- Display name: `Elector`
- Temporary native icon source: `public/assets/brand/icon-1024.png`
- Generated native icons: `src-tauri/icons/`
- iOS priority: TestFlight first; Android remains visually prepared by the same icon set.
- Native in-app purchases are enabled on iOS: the Shop shows consumable Campaign Funds bundles via Apple StoreKit (`tauri-plugin-iap`). There is no Stripe or web purchase link inside the native app. (Android Play Billing remains deferred.) Purchases credit only once the Apple App Store Server API secrets are configured — see `MONETIZATION_SETUP.md` / `APPLE_SETUP.md`.

Toolchain status (updated 2026-06-20):
- ✅ **Rust + iOS targets installed** (`aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`).
- ❌ **Full Xcode** — only Command Line Tools are present; iOS builds need full Xcode (Mac App Store), then `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -license accept`.
- ❌ **CocoaPods** — `brew install cocoapods` (or `sudo gem install cocoapods`); required by `tauri ios init`.
- ❌ **Apple signing** — add your Apple ID in Xcode → Settings → Accounts (auto-manage signing).

Once those three are in, run the Build Commands below. App Store metadata + review notes are drafted in `APP_STORE_LISTING.md`. Realistic timing: **TestFlight today; public App Store after Apple review (~1–3 days)**.

## One-Time Prereqs

```bash
# Install Rust if needed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Install/select full Xcode, then accept license
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept

# Optional: add common iOS Rust targets up front
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

## Build Commands

```bash
npm install
npm run test
npm run build

# Regenerate native icons from the temporary 1024 icon
npx tauri icon public/assets/brand/icon-1024.png

# Generate the Xcode project
npm run tauri:ios:init

# Run in simulator
npm run tauri:ios:dev

# Build archive for Xcode Organizer / Transporter
npm run tauri:ios:build
```

When final icon art arrives, swap it with:

```bash
npx tauri icon /path/to/final-1024.png
```

## Xcode Fields

Open `src-tauri/gen/apple` after `npm run tauri:ios:init`.

- Target display name: `Elector`
- Bundle Identifier: `com.playelector.app`
- Signing Team: your Apple Developer team
- Signing: automatically manage signing
- Deployment target: iOS `15.0` or newer
- Device orientation: handled in version control via `src-tauri/Info.ios.plist`
  (landscape-only on iPhone **and** iPad, plus `UIRequiresFullScreen = true`).
  Tauri merges that file into the generated Info.plist on every `ios build`, so
  do **not** set orientation manually in Xcode — and do **not** restrict iPad to
  landscape-only without `UIRequiresFullScreen = true`, or App Store validation
  rejects the bundle ("must include all four orientations for iPad multitasking").
- App icon:
  - Source icons are generated in `src-tauri/icons/ios/`
  - Xcode asset catalog is generated under `src-tauri/gen/apple` during init
- Version/build:
  - Marketing version should match `src-tauri/tauri.conf.json` (`1.0.0`)
  - Increment build number for each TestFlight upload

## App Store Connect

- Platform: iOS
- Name: `Elector`
- Bundle ID: `com.playelector.app`
- SKU: `elector-ios-1`
- Primary category: Games
- Secondary category: Strategy
- Support URL: `https://playelector.com/support`
- Privacy Policy URL: `https://playelector.com/privacy`
- Account deletion URL: `https://playelector.com/delete-account`
- Age rating: complete from gameplay content; no real-money gambling.
- App Privacy: declare account identifiers, gameplay/profile data, product analytics, optional rewarded ads/advertising identifiers, and **Purchase History** (native StoreKit IAP is enabled in this build).

Reviewer note:

```text
Elector can be played in Solo and pass-and-play without an account. Online play, roster sync, Campaign Funds, and the shop require a free account. This iOS build uses email-code account sign-in; Google/Apple OAuth is disabled in the native app until the app-return deep-link flow is wired and reviewed.

This iOS build includes native in-app purchases via Apple StoreKit: optional consumable Campaign Funds bundles in the Shop. There is no Stripe or external/web purchase link inside the native app. Players can also earn Campaign Funds through gameplay and use earned funds for unlocks.

This build includes optional rewarded ads in the Shop. Ads are user-initiated only, never automatic, and rewards are capped server-side.
```

## TestFlight Checklist

- First launch opens a game-first screen and allows Solo guest play.
- Portrait rotation shows the landscape orientation gate; landscape unlocks the game.
- Home, Solo setup, gameplay shell, account/progression, shop, and victory all fit phone landscape.
- Guest Solo game completes with no sign-in requirement.
- Sign-in/account panel opens, uses email-code auth, and shows progression, streak, achievements, support/privacy/delete-account links.
- Shop shows the native StoreKit Campaign Funds bundles on iOS; earned-fund unlocks also remain available. (Purchases credit only once the Apple App Store Server API secrets are set — see `MONETIZATION_SETUP.md`.)
- Support URL, privacy URL, and delete-account URL open from the live domain.
- Capture iPhone landscape screenshots for Home, Solo setup, gameplay, account/progression, shop, and victory.
