const COMMANDS: &[&str] = &["request_review"];

// iOS uses StoreKit (SKStoreReviewController / AppStore.requestReview) and Android
// uses the Play In-App Review library — both system/AAR provided, so there is no
// plugin config and no manifest injection. Keeping the plugin config type as the
// default `()` means tauri.conf.json must NOT carry a `plugins.elector-review`
// block (supplying one would fail deserialization and abort at launch).
fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
