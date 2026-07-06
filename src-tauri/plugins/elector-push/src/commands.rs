use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{ElectorPushExt, Result};

#[command]
pub(crate) async fn register_for_push<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RegisterPushResponse> {
    app.elector_push().register_for_push().await
}
