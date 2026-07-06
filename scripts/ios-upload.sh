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
CODE_SIGN_IDENTITY="Apple Distribution: DANIEL JOSEPH TOOLEY (${TEAM_ID})"
PROVISIONING_PROFILE_SPECIFIER="Elector App Store Distribution"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
gen_root="$repo_root/src-tauri/gen/apple"
tauri_conf="$repo_root/src-tauri/tauri.conf.json"
info_plist="$gen_root/election-sim_iOS/Info.plist"
archive_path="$gen_root/build/election-sim_iOS.xcarchive"
export_path="$gen_root/build/export"
export_options="$repo_root/scripts/ExportOptions-AppStore.plist"
project="$gen_root/election-sim.xcodeproj"
scheme="election-sim_iOS"
archive_log="$gen_root/build/archive.log"
export_log="$gen_root/build/export.log"

print_log_tail() {
  label="$1"
  log="$2"
  echo "[ios-upload] Last lines from $label:"
  grep -E 'error:|warning:.*error|Archive|CodeSign|Signing Identity|Provisioning Profile|EXPORT|Exported|success|Done|BUILD|FAILED|SUCCEEDED' "$log" \
    | tail -40 || tail -40 "$log"
}

extract_entitlements() {
  app="$1"
  output="$2"
  codesign -d --entitlements :- "$app" > "$output" 2>/dev/null
  plutil -lint "$output" >/dev/null
}

require_siwa_entitlement() {
  entitlements="$1"
  label="$2"
  /usr/libexec/PlistBuddy -c "Print :com.apple.developer.applesignin:0" "$entitlements" 2>/dev/null \
    | grep -qx "Default" || {
    echo "Error: $label missing the Sign in with Apple entitlement." >&2
    exit 1
  }
  echo "[ios-upload] $label includes Sign in with Apple entitlement."
}

require_get_task_allow_false() {
  entitlements="$1"
  label="$2"
  /usr/libexec/PlistBuddy -c "Print :get-task-allow" "$entitlements" 2>/dev/null \
    | grep -qx "false" || {
    echo "Error: $label has get-task-allow enabled; App Store IPA must be distribution-signed." >&2
    exit 1
  }
  echo "[ios-upload] $label has get-task-allow=false."
}

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

# App Store archive → production APNs entitlement (dev builds default to sandbox).
APS_ENVIRONMENT=production "$repo_root/scripts/ios-prepare-gen.sh"

# ── Sync to main ──────────────────────────────────────────────────────────────
if [ "${ELECTOR_NO_SYNC:-0}" != "1" ]; then
  if git -C "$repo_root" fetch origin --quiet 2>/dev/null \
     && git -C "$repo_root" merge --ff-only origin/main 2>/dev/null; then
    echo "[ios-upload] synced to origin/main ($(git -C "$repo_root" rev-parse --short HEAD))"
  else
    echo "[ios-upload] sync skipped — offline, diverged, or local edits"
  fi
fi

# ── Marketing version (semver) ─────────────────────────────────────────────────
# The remote forced-update gate (supabase/app_config.sql) compares THIS marketing
# semver against the server minimum — the build number below is not semantic. Set
# ELECTOR_APP_VERSION=X.Y.Z to bump it this release; otherwise it is left as-is and
# package.json is kept in sync so the frontend bundle bakes the same value.
pkg_json="$repo_root/package.json"
current_version=$(node -p "require('$tauri_conf').version")
if [ -n "${ELECTOR_APP_VERSION:-}" ] && [ "${ELECTOR_APP_VERSION}" != "$current_version" ]; then
  sed -i '' "s/\"version\": \"${current_version}\"/\"version\": \"${ELECTOR_APP_VERSION}\"/" "$tauri_conf"
  current_version="${ELECTOR_APP_VERSION}"
  echo "[ios-upload] Marketing version → $current_version"
else
  echo "[ios-upload] Marketing version: $current_version (set ELECTOR_APP_VERSION=X.Y.Z to bump; then set 'latest version' in the admin page)"
fi
# Keep package.json's version aligned with tauri.conf.json (the store-facing truth).
node -e "const f='$pkg_json',p=require(f);if(p.version!=='$current_version'){p.version='$current_version';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n');}"

# ── Bump build number ──────────────────────────────────────────────────────────
current_build=$(node -p "require('$tauri_conf').bundle.iOS.bundleVersion")
next_build=$((current_build + 1))
# Update tauri.conf.json (source of truth)
sed -i '' "s/\"bundleVersion\": \"${current_build}\"/\"bundleVersion\": \"${next_build}\"/" "$tauri_conf"
# Update the generated Info.plist that Xcode reads at archive time
plutil -replace CFBundleVersion -string "$next_build" "$info_plist"
echo "[ios-upload] Build number: $current_build → $next_build"

# Commit and push the version bump so origin/main stays in sync
git -C "$repo_root" add "$tauri_conf" "$pkg_json"
git -C "$repo_root" commit -m "chore: bump iOS build number to $next_build (v$current_version)"
git -C "$repo_root" push origin main
echo "[ios-upload] Version bump pushed to main"

# ── Archive ───────────────────────────────────────────────────────────────────
echo "[ios-upload] Archiving (builds frontend + Rust + app — takes a few minutes)..."
rm -rf "$archive_path" "$export_path"
mkdir -p "$gen_root/build"
# ELECTOR_NO_SYNC=1 prevents the Xcode build-phase script from re-syncing (we
# already synced above, and a second pull could conflict with the bump commit).
# project.yml defines configs as lowercase "release"/"debug" — match exactly.
# Sign the archive with the App Store distribution profile so Xcode records the
# entitlement request and export preserves Sign in with Apple in the final IPA.
if ! env -u GIT_CONFIG_COUNT -u GIT_CONFIG_KEY_0 -u GIT_CONFIG_VALUE_0 \
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
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$CODE_SIGN_IDENTITY" \
  PROVISIONING_PROFILE_SPECIFIER="$PROVISIONING_PROFILE_SPECIFIER" \
  CODE_SIGNING_ALLOWED=YES \
  CODE_SIGNING_REQUIRED=YES \
  > "$archive_log" 2>&1; then
  echo "Error: archive failed." >&2
  print_log_tail "archive log" "$archive_log" >&2
  exit 1
fi
print_log_tail "archive log" "$archive_log"

if [ ! -d "$archive_path" ]; then
  echo "Error: archive failed — expected archive not found at $archive_path" >&2
  exit 1
fi
app_info="$archive_path/Products/Applications/Elector.app/Info.plist"
archive_app="$archive_path/Products/Applications/Elector.app"
if [ ! -f "$app_info" ]; then
  echo "Error: archived app Info.plist not found at $app_info" >&2
  exit 1
fi
plutil -extract CFBundleURLTypes.0.CFBundleURLSchemes.0 raw -o - "$app_info" | grep -qx "com.playelector.app" || {
  echo "Error: archive missing com.playelector.app OAuth URL scheme." >&2
  exit 1
}
plutil -extract UIRequiresFullScreen raw -o - "$app_info" | grep -qx "true" || {
  echo "Error: archive missing UIRequiresFullScreen=true." >&2
  exit 1
}
ipad_orientations="$(plutil -extract 'UISupportedInterfaceOrientations~ipad' raw -o - "$app_info" 2>/dev/null || true)"
if printf '%s' "$ipad_orientations" | grep -q "Portrait"; then
  echo "Error: archive iPad orientations include portrait; App Store landscape build should be fullscreen landscape-only." >&2
  exit 1
fi

archive_entitlements="$(mktemp "$gen_root/build/archive-entitlements.XXXXXX")"
extract_entitlements "$archive_app" "$archive_entitlements" || {
  echo "Error: archived app is not signed; check $archive_log." >&2
  exit 1
}
require_siwa_entitlement "$archive_entitlements" "archive"
require_get_task_allow_false "$archive_entitlements" "archive"
echo "[ios-upload] Archive complete: $archive_path"

# ── Export ────────────────────────────────────────────────────────────────────
# destination=export in ExportOptions creates an IPA locally; we then upload
# via altool. This avoids the "Cloud signing permission" error from xcodebuild's
# auto-upload path.
echo "[ios-upload] Exporting IPA..."
if ! env -u GIT_CONFIG_COUNT -u GIT_CONFIG_KEY_0 -u GIT_CONFIG_VALUE_0 \
  xcodebuild -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$export_options" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$APPLE_API_KEY_PATH" \
  -authenticationKeyID "$APPLE_API_KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER" \
  > "$export_log" 2>&1; then
  echo "Error: export failed." >&2
  print_log_tail "export log" "$export_log" >&2
  exit 1
fi
print_log_tail "export log" "$export_log"

ipa=$(find "$export_path" -name "*.ipa" 2>/dev/null | head -1)
if [ -z "$ipa" ]; then
  echo "Error: export failed — no IPA found in $export_path" >&2
  exit 1
fi

ipa_check_dir="$(mktemp -d "$gen_root/build/ipa-check.XXXXXX")"
trap 'rm -rf "$ipa_check_dir"' EXIT HUP INT TERM
unzip -q "$ipa" -d "$ipa_check_dir"
ipa_app="$ipa_check_dir/Payload/Elector.app"
if [ ! -d "$ipa_app" ]; then
  echo "Error: exported IPA missing Payload/Elector.app." >&2
  exit 1
fi
ipa_entitlements="$ipa_check_dir/ipa-entitlements.plist"
extract_entitlements "$ipa_app" "$ipa_entitlements" || {
  echo "Error: exported IPA app is not signed; check $export_log." >&2
  exit 1
}
require_siwa_entitlement "$ipa_entitlements" "exported IPA"
require_get_task_allow_false "$ipa_entitlements" "exported IPA"

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
