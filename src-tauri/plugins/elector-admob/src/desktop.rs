use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<ElectorAdmob<R>> {
    Ok(ElectorAdmob(std::marker::PhantomData))
}

pub struct ElectorAdmob<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> ElectorAdmob<R> {
    pub async fn show_rewarded_ad(
        &self,
        _payload: ShowRewardedAdRequest,
    ) -> crate::Result<ShowRewardedAdResponse> {
        Ok(ShowRewardedAdResponse::unsupported(
            "Rewarded ads are only available in the mobile app.",
        ))
    }

    pub async fn show_privacy_options(&self) -> crate::Result<PrivacyOptionsResponse> {
        Ok(PrivacyOptionsResponse::unsupported(
            "Ad privacy options are only available in the mobile app.",
        ))
    }
}
