const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Signs local release builds (gradlew assembleRelease / bundleRelease) with the
 * real almahajjah-albaydaa upload keystore instead of the debug key, so
 * locally-built APKs share the Play Store app's signature and can later
 * receive an in-place update from Play without an uninstall.
 *
 * Reads store/key path+passwords from ~/.gradle/gradle.properties (RIWAQ_UPLOAD_*),
 * never from a file inside the repo. Falls back to debug signing if those
 * properties are absent, so the build still works on machines without the keystore.
 */
const SIGNING_CONFIG_BLOCK = `        release {
            if (project.hasProperty('RIWAQ_UPLOAD_STORE_FILE')) {
                storeFile file(RIWAQ_UPLOAD_STORE_FILE)
                storePassword RIWAQ_UPLOAD_STORE_PASSWORD
                keyAlias RIWAQ_UPLOAD_KEY_ALIAS
                keyPassword RIWAQ_UPLOAD_KEY_PASSWORD
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes("RIWAQ_UPLOAD_STORE_FILE")) {
      return config;
    }

    if (!contents.includes('signingConfigs {')) {
      throw new Error(
        'withReleaseSigning: could not find signingConfigs block in app/build.gradle',
      );
    }

    contents = contents.replace(
      /signingConfigs\s*\{\n(\s*debug\s*\{[^}]*\}\n)/,
      `signingConfigs {\n$1${SIGNING_CONFIG_BLOCK}`,
    );

    contents = contents.replace(
      /(release\s*\{\n\s*)\/\/ Caution![^\n]*\n(\s*\/\/ see[^\n]*\n)?\s*signingConfig signingConfigs\.debug\n/,
      `$1signingConfig signingConfigs.release\n`,
    );

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withReleaseSigning;
