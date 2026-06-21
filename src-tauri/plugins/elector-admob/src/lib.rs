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
use desktop::ElectorAdmob;
#[cfg(mobile)]
use mobile::ElectorAdmob;

pub trait ElectorAdmobExt<R: Runtime> {
    fn elector_admob(&self) -> &ElectorAdmob<R>;
}

impl<R: Runtime, T: Manager<R>> crate::ElectorAdmobExt<R> for T {
    fn elector_admob(&self) -> &ElectorAdmob<R> {
        self.state::<ElectorAdmob<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R, AdmobConfig> {
    Builder::new("elector-admob")
        .invoke_handler(tauri::generate_handler![commands::show_rewarded_ad])
        .setup(|app, api| {
            #[cfg(mobile)]
            let elector_admob = mobile::init(app, api)?;
            #[cfg(desktop)]
            let elector_admob = desktop::init(app, api)?;
            app.manage(elector_admob);
            Ok(())
        })
        .build()
}
