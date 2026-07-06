use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<ElectorPush<R>> {
    Ok(ElectorPush(std::marker::PhantomData))
}

pub struct ElectorPush<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> ElectorPush<R> {
    pub async fn register_for_push(&self) -> crate::Result<RegisterPushResponse> {
        Ok(RegisterPushResponse::unsupported(
            "Push registration is only available in the mobile app.",
        ))
    }
}
