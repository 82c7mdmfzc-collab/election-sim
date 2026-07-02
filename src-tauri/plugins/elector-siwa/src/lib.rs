//! elector-siwa — native Sign in with Apple for the iOS app.
//!
//! Presents Apple's ASAuthorizationController sheet and returns the identity
//! token plus the raw nonce (generated on the Swift side) so the webview can
//! finish sign-in with supabase.auth.signInWithIdToken — no browser round-trip,
//! which is what makes the flow reliable on both iPhone and iPad. Everything
//! that isn't iOS resolves `status: "unavailable"` so callers fall back to the
//! browser OAuth flow.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(target_os = "ios")]
mod ios;

#[cfg(not(target_os = "ios"))]
mod fallback;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(target_os = "ios")]
use ios::ElectorSiwa;

#[cfg(not(target_os = "ios"))]
use fallback::ElectorSiwa;

pub trait ElectorSiwaExt<R: Runtime> {
    fn elector_siwa(&self) -> &ElectorSiwa<R>;
}

impl<R: Runtime, T: Manager<R>> crate::ElectorSiwaExt<R> for T {
    fn elector_siwa(&self) -> &ElectorSiwa<R> {
        self.state::<ElectorSiwa<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("elector-siwa")
        .invoke_handler(tauri::generate_handler![commands::sign_in_with_apple])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            let elector_siwa = ios::init(app, api)?;
            #[cfg(not(target_os = "ios"))]
            let elector_siwa = fallback::init(app, api)?;
            app.manage(elector_siwa);
            Ok(())
        })
        .build()
}
