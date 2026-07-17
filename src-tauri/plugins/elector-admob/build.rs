use serde::Deserialize;

const COMMANDS: &[&str] = &["show_rewarded_ad", "show_privacy_options"];

// Google's public TEST app id — dev fallback so the Mobile Ads SDK doesn't crash
// at app launch before the real AdMob Android app id is configured.
// scripts/android-upload.sh refuses to ship a release still carrying it.
const TEST_ADMOB_APP_ID: &str = "ca-app-pub-3940256099942544~3347511713";

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct AdmobBuildConfig {
    android_app_id: Option<String>,
}

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();

    // The Google Mobile Ads SDK aborts the whole app at launch (via its init
    // ContentProvider) if the manifest lacks com.google.android.gms.ads
    // .APPLICATION_ID. Inject it into the generated Android project from the
    // typed plugin config — the same mechanism the deep-link plugin uses for
    // the OAuth scheme — so it survives `tauri android init` regenerating gen/.
    // update_android_manifest is a no-op unless TAURI_ANDROID_PROJECT_PATH is
    // set (i.e. iOS/desktop builds are untouched) and is marker-idempotent.
    let app_id = tauri_plugin::plugin_config::<AdmobBuildConfig>("elector-admob")
        .and_then(|c| c.android_app_id.filter(|s| !s.is_empty()))
        .unwrap_or_else(|| TEST_ADMOB_APP_ID.to_string());
    tauri_plugin::mobile::update_android_manifest(
        "ELECTOR ADMOB PLUGIN",
        "application",
        format!(
            r#"<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="{app_id}" />"#
        ),
    )
    .expect("failed to inject the AdMob APPLICATION_ID into AndroidManifest.xml");
}
