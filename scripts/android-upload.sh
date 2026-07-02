#!/bin/sh
# Build a signed Android release .aab for Google Play (mirror of ios-upload.sh).
#
#   1. Preflight: SDK/NDK/keystore/gen present; real AdMob ids (not Google's
#      test ids) in tauri.conf.json — test ad units in a store build violate
#      AdMob policy.
#   2. Re-assert the gen/ patches (android-prepare-gen.sh is idempotent).
#   3. ff-sync the checkout to origin/main (ELECTOR_NO_SYNC=1 skips).
#   4. Bump bundle.android.versionCode, commit + push (like the iOS bundleVersion).
#   5. Build the .aab with VITE_NATIVE_PLATFORM=android (+ rewarded ads unless
#      ELECTOR_NO_NATIVE_ADS=1), verify the signature, and open the folder.
#
# Uploading the .aab to the Play Console is manual for v1 (no Play CLI).
set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
tauri_conf="$repo_root/src-tauri/tauri.conf.json"
gen="$repo_root/src-tauri/gen/android"
aab="$gen/app/build/outputs/bundle/universalRelease/app-universal-release.aab"
keys_props="$HOME/.android-keys/elector-upload.properties"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -n1)}"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

# ── Preflight ─────────────────────────────────────────────────────────────────
[ -d "$ANDROID_HOME" ] || { echo "Error: ANDROID_HOME not found at $ANDROID_HOME" >&2; exit 1; }
[ -d "$gen/app" ] || {
  echo "Error: no generated Android project." >&2
  echo "  Run: npm run tauri:android:init && scripts/android-prepare-gen.sh" >&2
  exit 1
}
[ -f "$keys_props" ] || {
  echo "Error: $keys_props not found — a Play release must be signed with the upload key." >&2
  exit 1
}
if grep -q '"androidAppId": "ca-app-pub-3940256099942544' "$tauri_conf" \
   || grep -q '"androidRewardedAdUnitId": "ca-app-pub-3940256099942544' "$tauri_conf"; then
  echo "Error: tauri.conf.json still carries Google's TEST AdMob ids." >&2
  echo "  Create the Android app + rewarded unit in the AdMob console and put the real ids" >&2
  echo "  under plugins.elector-admob before shipping (test units in production violate policy)." >&2
  exit 1
fi

"$repo_root/scripts/android-prepare-gen.sh"

# ── Sync to main ──────────────────────────────────────────────────────────────
if [ "${ELECTOR_NO_SYNC:-0}" != "1" ]; then
  if git -C "$repo_root" fetch origin --quiet 2>/dev/null \
     && git -C "$repo_root" merge --ff-only origin/main 2>/dev/null; then
    echo "[android-upload] synced to origin/main ($(git -C "$repo_root" rev-parse --short HEAD))"
  else
    echo "[android-upload] sync skipped — offline, diverged, or local edits"
  fi
fi

# ── Bump versionCode ──────────────────────────────────────────────────────────
current_code=$(node -p "require('$tauri_conf').bundle.android.versionCode")
next_code=$((current_code + 1))
sed -i '' "s/\"versionCode\": ${current_code}/\"versionCode\": ${next_code}/" "$tauri_conf"
echo "[android-upload] versionCode: $current_code → $next_code"

git -C "$repo_root" add "$tauri_conf"
git -C "$repo_root" commit -m "chore: bump Android versionCode to $next_code"
git -C "$repo_root" push origin main || echo "[android-upload] WARNING: push failed — push the bump commit manually"

# ── Build ─────────────────────────────────────────────────────────────────────
if [ "${ELECTOR_NO_NATIVE_ADS:-0}" != "1" ]; then
  export VITE_ENABLE_NATIVE_REWARDED_ADS=true
fi
export VITE_NATIVE_PLATFORM=android
echo "[android-upload] Building release .aab (frontend + Rust + Gradle — takes a few minutes)…"
npx --prefix "$repo_root" tauri android build --aab --target aarch64 --target armv7

[ -f "$aab" ] || { echo "Error: expected bundle not found at $aab" >&2; exit 1; }

# ── Verify signing ────────────────────────────────────────────────────────────
if "$JAVA_HOME/bin/jarsigner" -verify "$aab" >/dev/null 2>&1; then
  echo "[android-upload] Signature verified."
else
  echo "Error: $aab is not signed — check keystore.properties wiring in gen/android." >&2
  exit 1
fi

echo ""
echo "[android-upload] Done: $aab"
echo "  Upload it at: https://play.google.com/console → Elector → Testing/Production → Create release"
open -R "$aab" 2>/dev/null || true
