use serde::{Deserialize, Serialize};

/// Result of a device push registration.
///
/// On success `token` is set (the APNs hex token on iOS, the FCM token on
/// Android) along with `platform` and `environment` ('prod' | 'sandbox', which
/// selects the APNs host). On failure `error` carries the reason and the other
/// fields are None.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPushResponse {
    pub token: Option<String>,
    pub platform: Option<String>,
    pub environment: Option<String>,
    pub error: Option<String>,
}

impl RegisterPushResponse {
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            token: None,
            platform: None,
            environment: None,
            error: Some(message.into()),
        }
    }
}
