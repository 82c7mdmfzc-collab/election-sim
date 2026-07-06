const COMMANDS: &[&str] = &["register_for_push"];

// iOS registers for remote notifications (UIKit) and captures the APNs token via a
// delegate swizzle; Android reads the FCM token (firebase-messaging AAR). Both are
// system/library provided, so there is no plugin config and no manifest injection
// here. Firebase's app-module wiring (google-services.json + gradle plugin) is done
// by scripts/android-prepare-gen.sh, and the iOS push entitlement by
// scripts/ios-prepare-gen.sh — both because gen/ is gitignored.
fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
