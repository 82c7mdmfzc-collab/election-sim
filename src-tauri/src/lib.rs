// `tauri::mobile_entry_point` replaces `main()` on iOS and Android.
// On desktop, `main.rs` calls `run()` directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Native OAuth: open the provider's authorize URL in the system browser
        // (opener) and catch the com.playelector.app://auth-callback return (deep-link).
        // The rest of the game logic lives in the web layer (TypeScript / Zustand).
        //
        // To add a native command later:
        //   .invoke_handler(tauri::generate_handler![my_command])
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_elector_siwa::init())
        .plugin(tauri_plugin_elector_admob::init())
        .plugin(tauri_plugin_iap::init())
        // Local notifications build on every platform (unlike haptics), so this
        // init() is unconditional and its capability lives in default.json.
        .plugin(tauri_plugin_notification::init());

    // Haptic feedback is a mobile-only crate (no desktop build), so register it
    // only on iOS/Android — matching the cfg gate on the dependency in Cargo.toml.
    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
