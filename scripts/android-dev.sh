#!/bin/sh
# Run the Android app against the Vite dev server (emulator or USB device).
#
# The wrapper exists because platform detection is BUILD-TIME: the app's custom
# userAgent ("Elector/1.0") defeats UA sniffing, so platform.ts relies on
# VITE_NATIVE_PLATFORM to resolve platformKind()==='android' — which gates Play
# Billing AND rewarded ads. Running `tauri android dev` bare silently disables
# both. (Mirror of the iOS pattern in tauri-ios-xcode-build.sh.)
#
# Override with ELECTOR_NO_NATIVE_ADS=1 to run without native rewarded ads.
set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -n1)}"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

if [ ! -d "$repo_root/src-tauri/gen/android" ]; then
  echo "No generated Android project — run: npm run tauri:android:init && scripts/android-prepare-gen.sh" >&2
  exit 1
fi

if [ "${ELECTOR_NO_NATIVE_ADS:-0}" != "1" ]; then
  export VITE_ENABLE_NATIVE_REWARDED_ADS=true
fi
export VITE_NATIVE_PLATFORM=android

echo "[android-dev] VITE_NATIVE_PLATFORM=android, native ads: ${VITE_ENABLE_NATIVE_REWARDED_ADS:-false}"
exec npx --prefix "$repo_root" tauri android dev "$@"
