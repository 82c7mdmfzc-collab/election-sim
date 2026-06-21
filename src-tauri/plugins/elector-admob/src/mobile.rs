use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_elector_admob);

#[cfg(target_os = "ios")]
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<ElectorAdmob<R>> {
    let handle = api.register_ios_plugin(init_plugin_elector_admob)?;
    Ok(ElectorAdmob::Ios(handle))
}

#[cfg(not(target_os = "ios"))]
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<ElectorAdmob<R>> {
    Ok(ElectorAdmob::Unsupported(std::marker::PhantomData))
}

pub enum ElectorAdmob<R: Runtime> {
    #[cfg(target_os = "ios")]
    Ios(PluginHandle<R>),
    #[cfg(not(target_os = "ios"))]
    Unsupported(std::marker::PhantomData<fn() -> R>),
}

impl<R: Runtime> ElectorAdmob<R> {
    pub async fn show_rewarded_ad(
        &self,
        payload: ShowRewardedAdRequest,
    ) -> crate::Result<ShowRewardedAdResponse> {
        #[cfg(target_os = "ios")]
        {
            match self {
                ElectorAdmob::Ios(handle) => handle
                    .run_mobile_plugin_async("showRewardedAd", payload)
                    .await
                    .map_err(Into::into),
            }
        }

        #[cfg(not(target_os = "ios"))]
        {
            let _ = payload;
            Ok(ShowRewardedAdResponse::unsupported(
                "Rewarded ads are only available in the iOS app.",
            ))
        }
    }
}
