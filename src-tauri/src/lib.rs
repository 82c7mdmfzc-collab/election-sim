// `tauri::mobile_entry_point` replaces `main()` on iOS and Android.
// On desktop, `main.rs` calls `run()` directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Native OAuth: open the provider's authorize URL in the system browser
        // (opener) and catch the com.playelector.app://auth-callback return (deep-link).
        // The rest of the game logic lives in the web layer (TypeScript / Zustand).
        //
        // To add a native command later:
        //   .invoke_handler(tauri::generate_handler![my_command])
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
