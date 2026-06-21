const COMMANDS: &[&str] = &["show_rewarded_ad"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
