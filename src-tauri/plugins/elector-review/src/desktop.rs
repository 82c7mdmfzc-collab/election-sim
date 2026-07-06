use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<ElectorReview<R>> {
    Ok(ElectorReview(std::marker::PhantomData))
}

pub struct ElectorReview<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> ElectorReview<R> {
    pub async fn request_review(&self) -> crate::Result<RequestReviewResponse> {
        Ok(RequestReviewResponse::unsupported(
            "In-app review is only available in the mobile app.",
        ))
    }
}
