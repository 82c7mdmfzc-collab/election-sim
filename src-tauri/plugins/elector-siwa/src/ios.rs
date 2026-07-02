use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

tauri::ios_plugin_binding!(init_plugin_elector_siwa);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<ElectorSiwa<R>> {
    let handle = api.register_ios_plugin(init_plugin_elector_siwa)?;
    Ok(ElectorSiwa(handle))
}

/// Bridge to the native ASAuthorizationController implementation (Swift).
pub struct ElectorSiwa<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ElectorSiwa<R> {
    pub async fn sign_in_with_apple(&self) -> crate::Result<AppleSignInResponse> {
        self.0
            .run_mobile_plugin_async("signInWithApple", ())
            .await
            .map_err(Into::into)
    }
}
