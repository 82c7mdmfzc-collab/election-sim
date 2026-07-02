use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<ElectorSiwa<R>> {
    Ok(ElectorSiwa(std::marker::PhantomData))
}

/// Non-iOS stub: resolves "unavailable" so callers fall back to browser OAuth.
pub struct ElectorSiwa<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> ElectorSiwa<R> {
    pub async fn sign_in_with_apple(&self) -> crate::Result<AppleSignInResponse> {
        Ok(AppleSignInResponse::unavailable(
            "Sign in with Apple is only available in the iOS app.",
        ))
    }
}
