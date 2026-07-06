use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.playelector.review";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_elector_review);

// This module only compiles under cfg(mobile) (see lib.rs), so android + ios
// cover every path here.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<ElectorReview<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ElectorReviewPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_elector_review)?;
    Ok(ElectorReview(handle))
}

/// Bridge to the native review implementation (Swift on iOS, Kotlin on Android).
pub struct ElectorReview<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ElectorReview<R> {
    pub async fn request_review(&self) -> crate::Result<RequestReviewResponse> {
        self.0
            .run_mobile_plugin_async("requestReview", ())
            .await
            .map_err(Into::into)
    }
}
