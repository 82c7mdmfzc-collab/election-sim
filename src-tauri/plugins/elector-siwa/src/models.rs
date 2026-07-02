use serde::{Deserialize, Serialize};

/// Result of the native Sign in with Apple sheet.
///
/// `status` is one of:
///  • "authorized"  — identity_token + raw_nonce are set; redeem with Supabase.
///  • "cancelled"   — the user dismissed the sheet; callers should stay quiet.
///  • "error"       — the sheet failed; `error` carries the description.
///  • "unavailable" — not iOS; callers fall back to browser OAuth.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleSignInResponse {
    pub status: String,
    pub identity_token: Option<String>,
    /// The raw nonce whose SHA-256 was sent to Apple; Supabase verifies the
    /// token's nonce claim against it.
    pub raw_nonce: Option<String>,
    /// Name/email are only provided by Apple on the FIRST authorization.
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub email: Option<String>,
    pub error: Option<String>,
}

impl AppleSignInResponse {
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            status: "unavailable".into(),
            identity_token: None,
            raw_nonce: None,
            given_name: None,
            family_name: None,
            email: None,
            error: Some(message.into()),
        }
    }
}
