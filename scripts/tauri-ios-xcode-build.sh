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

if [ "$release_build" = true ]; then
  echo "Building frontend bundle for iOS release"
  npm --prefix "$repo_root" run build

  if [ ! -f "$repo_root/dist/index.html" ]; then
    echo "Missing frontend bundle at $repo_root/dist/index.html" >&2
    exit 1
  fi
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
