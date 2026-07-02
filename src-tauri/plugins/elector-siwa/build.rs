const COMMANDS: &[&str] = &["sign_in_with_apple"];

// No plugin config and no manifest injection: the native side is iOS-only
// (AuthenticationServices) and needs nothing at build time. Keeping the plugin
// config type as the default `()` means tauri.conf.json must NOT carry a
// `plugins.elector-siwa` block — supplying one would fail deserialization and
// abort the app at launch (see the AdmobConfig lesson in elector-admob).
fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
