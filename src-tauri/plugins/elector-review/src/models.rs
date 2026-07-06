use serde::{Deserialize, Serialize};

/// Result of a native review request.
///
/// `requested` is true when the OS review API was invoked — NOT a guarantee the
/// sheet was shown (the platform may suppress it for a user who already rated or
/// is over the frequency cap; it never tells us which). `error` carries a reason
/// when the request could not be made at all.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestReviewResponse {
    pub requested: bool,
    pub error: Option<String>,
}

impl RequestReviewResponse {
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            requested: false,
            error: Some(message.into()),
        }
    }
}
