plugins {
    // AGP 9 compiles Kotlin itself; no Kotlin plugin needed.
    alias(libs.plugins.android.application)
}

// Releases are built from tags like android-v1.2.3 (.github/workflows/android-release.yml), which pass
// -PreleaseVersion=1.2.3. The version code must grow with every release: 1.2.3 becomes 10203.
val releaseVersion = providers.gradleProperty("releaseVersion").orNull
val releaseVersionCode = releaseVersion?.let { version ->
    val parts = Regex("""(\d+)\.(\d{1,2})\.(\d{1,2})""").matchEntire(version)?.groupValues?.drop(1)?.map(String::toInt)
        ?: error("releaseVersion must look like 1.2.3, not $version")
    parts[0] * 10000 + parts[1] * 100 + parts[2]
}

// The release key, from the environment so it never enters the repo. See "Releasing the Android app"
// in the README.
val keystore = providers.environmentVariable("WEFALL_KEYSTORE").orNull

android {
    namespace = "app.wefall.companion"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.wefall.companion"
        // Only recent Android versions are supported.
        minSdk = 36
        targetSdk = 37
        versionCode = releaseVersionCode ?: 1
        versionName = releaseVersion ?: "0.0.0-dev"

        // The page the app opens; the site must be one of LocalServer's allowed origins.
        buildConfigField("String", "WEFALL_URL", "\"https://wefall.web.app\"")
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                // PKCS12 keystores (keytool's default) use one password for the store and the key.
                storePassword = providers.environmentVariable("WEFALL_KEYSTORE_PASSWORD").get()
                keyPassword = providers.environmentVariable("WEFALL_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("WEFALL_KEY_ALIAS").get()
            }
        }
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
            // Without the key, assembleRelease still works but leaves the APK unsigned.
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
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
