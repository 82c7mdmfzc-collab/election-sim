#!/bin/sh
set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
tauri_dir="$repo_root/src-tauri"
xcode_root="${SRCROOT:-$tauri_dir/gen/apple}"
configuration="${CONFIGURATION:-release}"
platform_name="${PLATFORM_NAME:-iphoneos}"
sdk_root="${SDKROOT:-}"
archs="${ARCHS:-arm64}"

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

# ── Auto-sync to origin/main before every Xcode build ───────────────────────────
# Pushing to main does NOT update this local checkout, so a build can otherwise
# ship stale web assets. Fast-forward-only + best-effort: it never clobbers local
# commits or uncommitted edits (ff-only just aborts), and if it can't sync
# (offline / diverged) it logs and builds the current tree. Set ELECTOR_NO_SYNC=1
# in the Xcode scheme's env (or shell) to skip while iterating on local changes.
if [ "${ELECTOR_NO_SYNC:-0}" != "1" ]; then
  if git -C "$repo_root" fetch origin --quiet 2>/dev/null \
     && git -C "$repo_root" merge --ff-only origin/main 2>/dev/null; then
    echo "[tauri-ios] synced checkout to origin/main ($(git -C "$repo_root" rev-parse --short HEAD))"
  else
    echo "[tauri-ios] sync skipped (offline, diverged, or local changes) — building current tree"
  fi
fi

case "$configuration" in
  release|Release)
    cargo_profile="release"
    output_configuration="release"
    release_build=true
    ;;
  *)
    cargo_profile="debug"
    output_configuration="debug"
    release_build=false
    ;;
esac

# Always rebuild the frontend bundle so the app ships current web assets on every
# build (debug or release) — this is the "just build from Xcode, no fuss" guarantee.
# vite build is fast, so the cost is negligible.
#
# Native rewarded ads (AdMob via the elector-admob plugin) are gated behind this
# Vite flag in rewardedAds.ts, so they ship ONLY in the iOS app and never on web.
# This build only ever runs for iOS, so enabling it here is the correct scope.
# Override with ELECTOR_NO_NATIVE_ADS=1 to build the iOS app without ads.
if [ "${ELECTOR_NO_NATIVE_ADS:-0}" != "1" ]; then
  export VITE_ENABLE_NATIVE_REWARDED_ADS=true
fi
# Authoritative platform signal baked into the iOS bundle. The app's custom
# userAgent ("Elector/1.0") defeats UA sniffing, so platform.ts relies on this
# to resolve platformKind()==='ios' / isIOS() — gates StoreKit billing AND ads.
export VITE_NATIVE_PLATFORM=ios
echo "Building frontend bundle for iOS ($configuration, native ads: ${VITE_ENABLE_NATIVE_REWARDED_ADS:-false})"
npm --prefix "$repo_root" run build
if [ ! -f "$repo_root/dist/index.html" ]; then
  echo "Missing frontend bundle at $repo_root/dist/index.html" >&2
  exit 1
fi

# Sync app icons from source-of-truth (src-tauri/icons/ios/) into the Xcode asset
# catalog (gen/apple/Assets.xcassets/AppIcon.appiconset/). gen/ is gitignored so
# npx tauri icon alone never updates what Xcode actually packages.
icon_src="$tauri_dir/icons/ios"
icon_dst="$xcode_root/Assets.xcassets/AppIcon.appiconset"
if [ -d "$icon_src" ] && [ -d "$icon_dst" ]; then
  cp "$icon_src"/*.png "$icon_dst/"
  echo "[tauri-ios] synced app icons to Xcode asset catalog"
fi

case "$platform_name:$sdk_root" in
  *simulator*|*Simulator*)
    sdk_kind="simulator"
    ;;
  *)
    sdk_kind="device"
    ;;
esac

for arch in $archs; do
  case "$sdk_kind:$arch" in
    device:arm64)
      rust_target="aarch64-apple-ios"
      ;;
    simulator:arm64)
      rust_target="aarch64-apple-ios-sim"
      ;;
    simulator:x86_64)
      rust_target="x86_64-apple-ios"
      ;;
    *)
      echo "Unsupported iOS Rust target for platform '$platform_name' arch '$arch'" >&2
      exit 1
      ;;
  esac

  echo "Building Rust static library for $rust_target ($configuration)"
  set -- build --manifest-path "$tauri_dir/Cargo.toml" --target "$rust_target"
  if [ "$release_build" = true ]; then
    set -- "$@" --release --features custom-protocol
  fi
  cargo "$@"

  mkdir -p "$xcode_root/Externals/$arch/$output_configuration"
  cp "$tauri_dir/target/$rust_target/$cargo_profile/libelection_sim_lib.a" \
    "$xcode_root/Externals/$arch/$output_configuration/libapp.a"
done
