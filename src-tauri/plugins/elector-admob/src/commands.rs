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
