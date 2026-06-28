# Elector iOS TestFlight Release Guide

Current as of 2026-06-28.

## Current State

- Bundle ID: `com.playelector.app`
- Display name: `Elector`
- Marketing version: `1.0.0`
- Latest uploaded build: `25`
- Latest upload delivery UUID: `e8aabaf6-9dea-4b02-a7db-e998854d690a`
- Generated Xcode project: `src-tauri/gen/apple`
- App Store Connect API key path expected by scripts: `~/.appstoreconnect/private_keys/AuthKey_K7JZWQB6L4.p8`
- Team ID used by upload script: `NSUP6D9BX5`
- iOS is the public native v1 target. Android is a fast-follow.

## Toolchain Status

This machine currently has the required iOS build/upload tools:

- Full Xcode available via `xcodebuild`.
- `xcrun altool` available.
- CocoaPods available via `pod`.
- Cargo and iOS Rust targets available.
- Generated iOS project present under `src-tauri/gen/apple`.

## Standard Upload Flow

Use the repo script unless you need to debug Xcode manually:

```bash
npm run test
npm run lint
npm run build
npm run test:mobile-native
npm run build:edge
ELECTOR_NO_SYNC=1 scripts/ios-upload.sh
```

What `scripts/ios-upload.sh` does:

- Patches the generated Xcode project via `scripts/ios-prepare-gen.sh`.
- Bumps `bundle.iOS.bundleVersion` in `src-tauri/tauri.conf.json`.
- Commits and pushes the build-number bump to `main`.
- Archives the app with automatic signing.
- Verifies critical plist values: OAuth URL scheme, fullscreen landscape iPad policy.
- Exports `src-tauri/gen/apple/build/export/Elector.ipa`.
- Uploads the IPA to App Store Connect with `altool`.

Use `ELECTOR_NO_SYNC=1` when local `main` already contains the intended release commits. Without it, the scripts attempt a best-effort fast-forward from `origin/main`.

## Manual Xcode Notes

Open `src-tauri/gen/apple/election-sim.xcodeproj` only when debugging.

- Target display name: `Elector`
- Bundle Identifier: `com.playelector.app`
- Signing Team: `NSUP6D9BX5`
- Signing: automatic
- Deployment target: iOS `15.0` or newer
- Orientations: landscape left/right only, with `UIRequiresFullScreen = true`
- URL scheme: `com.playelector.app`
- Privacy manifest: `PrivacyInfo.xcprivacy` copied into the app target by `ios-prepare-gen.sh`

Do not hand-edit generated Xcode settings without reflecting the change in `scripts/ios-prepare-gen.sh`; `src-tauri/gen/apple` can be regenerated.

## App Store Connect Fields

- Platform: iOS
- Name: `Elector`
- SKU: `elector-ios-1`
- Bundle ID: `com.playelector.app`
- Primary category: Games
- Secondary category: Strategy or Board
- Support URL: `https://playelector.com/support`
- Privacy Policy URL: `https://playelector.com/privacy`
- Account deletion URL: `https://playelector.com/delete-account`
- Price: Free with In-App Purchases
- Age rating: political satire, no gambling, no violence.

## Reviewer Note

```text
Elector can be played in Solo and pass-and-play without an account. Online play, roster sync, Campaign Funds, and the shop require a free account. This iOS build supports Apple, Google, and email-code account sign-in; OAuth returns through the app's registered com.playelector.app://auth-callback URL scheme.

This iOS build includes native in-app purchases via Apple StoreKit: optional consumable Campaign Funds bundles in the Shop. There is no Stripe or external/web purchase link inside the native app. Players can also earn Campaign Funds through gameplay and use earned funds for candidate and cosmetic unlocks.

This build includes optional rewarded ads in the Shop. Ads are user-initiated only, never automatic, and rewards are capped server-side.

Elector is a satirical strategy game and is not affiliated with, authorized, or endorsed by any person, party, or government depicted.
```

## TestFlight Checklist

- Build appears in App Store Connect after processing.
- First launch opens a game-first screen and allows guest Solo play.
- Portrait rotation shows the landscape orientation gate; landscape unlocks the game.
- Home, Solo setup, gameplay, account/progression, shop, and victory fit phone landscape.
- Guest Solo game completes with no sign-in requirement.
- Email, Google, and Apple sign-in work and return to the app.
- Shop shows StoreKit Campaign Funds bundles on iOS.
- Sandbox purchase credits server balance exactly once.
- Rewarded ad button only appears when the native ad bridge is available and respects server quota.
- Support, privacy, and delete-account URLs open from the live domain.
- Online multiplayer works against the web client.

## Final Icon Swap

The current master icon is `public/assets/brand/icon-1024.png`. When final art changes:

```bash
npx tauri icon /path/to/final-1024.png
```

Then run a full build/upload cycle.
