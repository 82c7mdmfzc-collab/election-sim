use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{ElectorAdmobExt, Result};

#[command]
pub(crate) async fn show_rewarded_ad<R: Runtime>(
    app: AppHandle<R>,
    payload: ShowRewardedAdRequest,
) -> Result<ShowRewardedAdResponse> {
    app.elector_admob().show_rewarded_ad(payload).await
}

#[command]
pub(crate) async fn show_privacy_options<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PrivacyOptionsResponse> {
    app.elector_admob().show_privacy_options().await
}
