use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.playelector.push";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_elector_push);

// This module only compiles under cfg(mobile) (see lib.rs), so android + ios
// cover every path here.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<ElectorPush<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ElectorPushPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_elector_push)?;
    Ok(ElectorPush(handle))
}

/// Bridge to the native token registration (Swift on iOS, Kotlin on Android).
pub struct ElectorPush<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ElectorPush<R> {
    pub async fn register_for_push(&self) -> crate::Result<RegisterPushResponse> {
        self.0
            .run_mobile_plugin_async("registerForPush", ())
            .await
            .map_err(Into::into)
    }
}
