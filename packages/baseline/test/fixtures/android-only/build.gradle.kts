// An Android-only Jetpack Compose module: needs the Android stack + an emulator.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.example.androidonly"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.example.androidonly"
        minSdk = 24
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.compose.ui:ui:1.7.0")
    implementation("androidx.compose.material3:material3:1.3.0")
    implementation("androidx.activity:activity-compose:1.9.0")
}
