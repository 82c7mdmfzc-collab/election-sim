use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowRewardedAdRequest {
    pub placement: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowRewardedAdResponse {
    pub completed: bool,
    pub provider: Option<String>,
    pub ad_unit: Option<String>,
    pub error: Option<String>,
}

impl ShowRewardedAdResponse {
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            completed: false,
            provider: Some("admob".into()),
            ad_unit: None,
            error: Some(message.into()),
        }
    }
}

/// Plugin config read from `plugins.elector-admob` in tauri.conf.json.
///
/// This type MUST exist and match the JSON shape. Tauri deserializes the
/// plugin's config object into the plugin's config type at launch; if the type
/// is the default `()` (as it was) while tauri.conf.json supplies an object,
/// deserialization fails, plugin init returns Err, and `.run().expect()` aborts
/// the whole app on startup. `#[serde(default)]` + Option keep it tolerant of a
/// missing block or extra fields.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AdmobConfig {
    pub ios_rewarded_ad_unit_id: Option<String>,
}
