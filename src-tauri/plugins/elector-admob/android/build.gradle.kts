plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.playelector.admob"
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
    // Pinned to the last GMA major compiled against Kotlin 1.9 metadata — the
    // Tauri Android template's kotlin-gradle-plugin is 1.9.25 and v24.x AARs
    // (Kotlin 2.1 metadata) fail compileDebugKotlin. The rewarded-ad API used
    // here is identical across 23/24.
    implementation("com.google.android.gms:play-services-ads:23.6.0")
    implementation(project(":tauri-android"))
}
