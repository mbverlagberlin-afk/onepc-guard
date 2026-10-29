plugins {
    id("com.android.application")
}

android {
    namespace = "de.onemultimedia.onepc"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.onemultimedia.onepc"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        // Adresse der OnePC-App im Shop (Lizenz-Plugin ab 1.1.0).
        buildConfigField("String", "START_URL", "\"https://onemultimedia.de/onepc-app/\"")
        buildConfigField("String", "APP_HOST", "\"onemultimedia.de\"")
    }

    // Fester TEST-Schlüssel, damit neue Testversionen über alte installiert werden können.
    // Nicht für den Play Store verwenden – dafür einen eigenen, geheimen Schlüssel anlegen.
    signingConfigs {
        create("test") {
            storeFile = file("test-signing.jks")
            storePassword = "onepc-test"
            keyAlias = "onepc-test"
            keyPassword = "onepc-test"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("test")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("test")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
