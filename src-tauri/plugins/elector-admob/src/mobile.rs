use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.playelector.admob";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_elector_admob);

// This module only compiles under cfg(mobile) (see lib.rs), so android + ios
// cover every path here.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<ElectorAdmob<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ElectorAdmobPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_elector_admob)?;
    Ok(ElectorAdmob(handle))
}

/// Bridge to the native AdMob implementation (Swift on iOS, Kotlin on Android).
pub struct ElectorAdmob<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ElectorAdmob<R> {
    pub async fn show_rewarded_ad(
        &self,
        payload: ShowRewardedAdRequest,
    ) -> crate::Result<ShowRewardedAdResponse> {
        self.0
            .run_mobile_plugin_async("showRewardedAd", payload)
            .await
            .map_err(Into::into)
    }

    pub async fn show_privacy_options(&self) -> crate::Result<PrivacyOptionsResponse> {
        self.0
            .run_mobile_plugin_async("showPrivacyOptions", ())
            .await
            .map_err(Into::into)
    }
}
