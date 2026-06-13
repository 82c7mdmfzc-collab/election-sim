// `tauri::mobile_entry_point` replaces `main()` on iOS and Android.
// On desktop, `main.rs` calls `run()` directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // All game logic lives in the web layer (TypeScript / Zustand).
        // No Rust commands or plugins are registered here because the game
        // engine is fully self-contained in the frontend bundle.
        //
        // To add a native command later:
        //   .invoke_handler(tauri::generate_handler![my_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
