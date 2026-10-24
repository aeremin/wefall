plugins {
    // AGP 9 compiles Kotlin itself; no Kotlin plugin needed.
    alias(libs.plugins.android.application)
}

android {
    namespace = "app.wefall.companion"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.wefall.companion"
        // Only recent Android versions are supported.
        minSdk = 36
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"

        // The page the app opens; the site must be one of LocalServer's allowed origins.
        buildConfigField("String", "WEFALL_URL", "\"https://wefall.web.app\"")
    }

    buildTypes {
        debug {
            // Lets a debug build open the Vite dev server: `adb reverse tcp:5173 tcp:5173`, then
            // `-PwefallUrl=http://localhost:5173`.
            providers.gradleProperty("wefallUrl").orNull?.let {
                buildConfigField("String", "WEFALL_URL", "\"$it\"")
            }
        }
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    implementation(libs.androidx.browser)
}
