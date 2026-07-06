plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.playelector.push"
    compileSdk = 36

    defaultConfig {
        minSdk = 24

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Firebase Cloud Messaging — reads the device FCM token. Pinned to the last
    // 23.x (Kotlin 1.9 metadata) so it compiles against the Tauri Android
    // template's kotlin-gradle-plugin (1.9.25); 24.x ships Kotlin 2.1 metadata and
    // fails compileDebugKotlin (same constraint as elector-admob's ads pin).
    // FirebaseApp auto-initializes from the app module's google-services.json,
    // wired by scripts/android-prepare-gen.sh.
    implementation("com.google.firebase:firebase-messaging:23.4.1")
    implementation(project(":tauri-android"))
}
