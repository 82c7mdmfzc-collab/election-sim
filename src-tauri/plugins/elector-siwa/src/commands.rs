use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{ElectorSiwaExt, Result};

#[command]
pub(crate) async fn sign_in_with_apple<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AppleSignInResponse> {
    app.elector_siwa().sign_in_with_apple().await
}
