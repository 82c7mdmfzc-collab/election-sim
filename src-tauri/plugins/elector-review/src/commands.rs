use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{ElectorReviewExt, Result};

#[command]
pub(crate) async fn request_review<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RequestReviewResponse> {
    app.elector_review().request_review().await
}
