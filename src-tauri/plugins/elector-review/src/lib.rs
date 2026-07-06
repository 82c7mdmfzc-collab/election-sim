//! elector-review — the native "rate this app" in-app review prompt.
//!
//! iOS presents SKStoreReviewController / AppStore.requestReview; Android runs the
//! Play In-App Review flow. Everything non-mobile resolves an "unsupported"
//! response so desktop compiles and the JS caller simply no-ops. The OS owns the
//! display policy (frequency caps, already-rated suppression), so the app can ask
//! at each happy moment and let the platform decide whether to show anything.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::ElectorReview;
#[cfg(mobile)]
use mobile::ElectorReview;

pub trait ElectorReviewExt<R: Runtime> {
    fn elector_review(&self) -> &ElectorReview<R>;
}

impl<R: Runtime, T: Manager<R>> crate::ElectorReviewExt<R> for T {
    fn elector_review(&self) -> &ElectorReview<R> {
        self.state::<ElectorReview<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("elector-review")
        .invoke_handler(tauri::generate_handler![commands::request_review])
        .setup(|app, api| {
            #[cfg(mobile)]
            let elector_review = mobile::init(app, api)?;
            #[cfg(desktop)]
            let elector_review = desktop::init(app, api)?;
            app.manage(elector_review);
            Ok(())
        })
        .build()
}
