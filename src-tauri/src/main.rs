// Hides the Windows console window in release builds (no-op on macOS/Linux).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    election_sim_lib::run()
}
