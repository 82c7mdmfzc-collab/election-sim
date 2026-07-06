//! elector-push — register this device for remote push and return its token.
//!
//! iOS calls registerForRemoteNotifications() and captures the APNs device token
//! via an AppDelegate swizzle (Tauri owns the delegate); Android returns the FCM
//! registration token. The JS side (src/utils/pushRegistration.ts) upserts the
//! token into public.device_tokens, where the edge functions read it to send
//! pushes. Everything non-mobile resolves an "unsupported" response so desktop
//! compiles and the caller no-ops.

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
use desktop::ElectorPush;
#[cfg(mobile)]
use mobile::ElectorPush;

pub trait ElectorPushExt<R: Runtime> {
    fn elector_push(&self) -> &ElectorPush<R>;
}

impl<R: Runtime, T: Manager<R>> crate::ElectorPushExt<R> for T {
    fn elector_push(&self) -> &ElectorPush<R> {
        self.state::<ElectorPush<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("elector-push")
        .invoke_handler(tauri::generate_handler![commands::register_for_push])
        .setup(|app, api| {
            #[cfg(mobile)]
            let elector_push = mobile::init(app, api)?;
            #[cfg(desktop)]
            let elector_push = desktop::init(app, api)?;
            app.manage(elector_push);
            Ok(())
        })
        .build()
}
