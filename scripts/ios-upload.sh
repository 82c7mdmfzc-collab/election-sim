#!/bin/sh
# scripts/ios-upload.sh
# One command: bump build number, archive, and upload to TestFlight.
#
# Prerequisites (one-time setup):
#   • Set APPLE_API_ISSUER env var (or paste your Issuer ID in the ISSUER line below).
#     App Store Connect → Users & Access → Integrations → App Store Connect API → Issuer ID
#   • Distribution certificate in Keychain (automatic signing picks it up).
#   • Xcode project generated: npx tauri ios init && scripts/ios-prepare-gen.sh
#
# Usage:
#   APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx scripts/ios-upload.sh
#   ELECTOR_NO_SYNC=1 scripts/ios-upload.sh   # skip git pull (local iteration)
set -eu

# ── Fill in your Issuer ID here (once) to avoid needing the env var ──────────
ISSUER="${APPLE_API_ISSUER:-}"
ISSUER="cb582172-4f30-4747-a979-fbd27dc2fc7c"

# ── Constants (do not change) ─────────────────────────────────────────────────
APPLE_API_KEY_ID="K7JZWQB6L4"
APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY_ID}.p8"
TEAM_ID="NSUP6D9BX5"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
gen_root="$repo_root/src-tauri/gen/apple"
tauri_conf="$repo_root/src-tauri/tauri.conf.json"
info_plist="$gen_root/election-sim_iOS/Info.plist"
archive_path="$gen_root/build/election-sim_iOS.xcarchive"
export_path="$gen_root/build/export"
export_options="$repo_root/scripts/ExportOptions-AppStore.plist"
project="$gen_root/election-sim.xcodeproj"
scheme="election-sim_iOS"

# ── Pre-flight checks ──────────────────────────────────────────────────────────
if [ -z "$ISSUER" ]; then
  echo "Error: APPLE_API_ISSUER not set." >&2
  echo "  Get it: App Store Connect → Users & Access → Keys → Issuer ID (top of page)" >&2
  echo "  Or paste it into the ISSUER line in this script." >&2
  exit 1
fi
if [ ! -f "$APPLE_API_KEY_PATH" ]; then
  echo "Error: API key not found at $APPLE_API_KEY_PATH" >&2
  exit 1
fi
if [ ! -f "$project/project.pbxproj" ]; then
  echo "Error: Xcode project not found." >&2
  echo "  Run: npx tauri ios init && scripts/ios-prepare-gen.sh" >&2
  exit 1
fi

# ── Sync to main ──────────────────────────────────────────────────────────────
if [ "${ELECTOR_NO_SYNC:-0}" != "1" ]; then
  if git -C "$repo_root" fetch origin --quiet 2>/dev/null \
     && git -C "$repo_root" merge --ff-only origin/main 2>/dev/null; then
    echo "[ios-upload] synced to origin/main ($(git -C "$repo_root" rev-parse --short HEAD))"
  else
    echo "[ios-upload] sync skipped — offline, diverged, or local edits"
  fi
fi

# ── Bump build number ──────────────────────────────────────────────────────────
current_build=$(node -p "require('$tauri_conf').bundle.iOS.bundleVersion")
next_build=$((current_build + 1))
# Update tauri.conf.json (source of truth)
sed -i '' "s/\"bundleVersion\": \"${current_build}\"/\"bundleVersion\": \"${next_build}\"/" "$tauri_conf"
# Update the generated Info.plist that Xcode reads at archive time
plutil -replace CFBundleVersion -string "$next_build" "$info_plist"
echo "[ios-upload] Build number: $current_build → $next_build"

# Commit and push the version bump so origin/main stays in sync
git -C "$repo_root" add "$tauri_conf"
git -C "$repo_root" commit -m "chore: bump iOS build number to $next_build"
git -C "$repo_root" push origin main
echo "[ios-upload] Version bump pushed to main"

# ── Archive ───────────────────────────────────────────────────────────────────
echo "[ios-upload] Archiving (builds frontend + Rust + app — takes a few minutes)..."
rm -rf "$archive_path" "$export_path"
# ELECTOR_NO_SYNC=1 prevents the Xcode build-phase script from re-syncing (we
# already synced above, and a second pull could conflict with the bump commit).
# project.yml defines configs as lowercase "release"/"debug" — match exactly.
# CODE_SIGN_IDENTITY forces distribution signing so the archive is App Store-ready.
ELECTOR_NO_SYNC=1 xcodebuild archive \
  -project "$project" \
  -scheme "$scheme" \
  -configuration release \
  -destination "generic/platform=iOS" \
  -archivePath "$archive_path" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$APPLE_API_KEY_PATH" \
  -authenticationKeyID "$APPLE_API_KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  CODE_SIGN_IDENTITY="Apple Distribution" \
  2>&1 | grep -E 'error:|warning:.*error|Archive|Compiling|Linking|BUILD' | tail -20 || true

if [ ! -d "$archive_path" ]; then
  echo "Error: archive failed — rerun with verbose output to diagnose:" >&2
  echo "  ELECTOR_NO_SYNC=1 xcodebuild archive -project $project -scheme $scheme -configuration release -destination 'generic/platform=iOS' -archivePath $archive_path -allowProvisioningUpdates CODE_SIGN_IDENTITY='Apple Distribution' DEVELOPMENT_TEAM=$TEAM_ID" >&2
  exit 1
fi
echo "[ios-upload] Archive complete: $archive_path"

# ── Export ────────────────────────────────────────────────────────────────────
# destination=export in ExportOptions creates an IPA locally; we then upload
# via altool. This avoids the "Cloud signing permission" error from xcodebuild's
# auto-upload path.
echo "[ios-upload] Exporting IPA..."
xcodebuild -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$export_options" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$APPLE_API_KEY_PATH" \
  -authenticationKeyID "$APPLE_API_KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER" \
  2>&1 | grep -E 'error:|EXPORT|success|Done' | tail -20 || true

ipa=$(find "$export_path" -name "*.ipa" 2>/dev/null | head -1)
if [ -z "$ipa" ]; then
  echo "Error: export failed — no IPA found in $export_path" >&2
  exit 1
fi

# ── Upload ────────────────────────────────────────────────────────────────────
echo "[ios-upload] Uploading $(basename "$ipa") (build $next_build)..."
xcrun altool \
  --upload-app \
  -f "$ipa" \
  --type ios \
  --apiKey "$APPLE_API_KEY_ID" \
  --apiIssuer "$ISSUER" \
  --apiPrivateKeyPath "$APPLE_API_KEY_PATH"

echo ""
echo "Build $next_build submitted to App Store Connect."
echo "It will appear in TestFlight within a few minutes:"
echo "  https://appstoreconnect.apple.com/apps"
