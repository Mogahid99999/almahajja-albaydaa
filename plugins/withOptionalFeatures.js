const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Google Play (2026-11-18, build 1.1.7/22) warned that the app is limited to
 * devices with `android.hardware.screen.portrait` and `android.hardware.wifi`.
 * Neither is declared: Play infers them, the first from the portrait-locked
 * activity, the second from ACCESS_WIFI_STATE (added by the live «الحلقة»
 * WebRTC library). The app works without both, so declare them optional and
 * Play stops filtering devices on them.
 */
const OPTIONAL = ['android.hardware.screen.portrait', 'android.hardware.wifi'];

function withOptionalFeatures(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const features = (manifest['uses-feature'] ??= []);
    for (const name of OPTIONAL) {
      const existing = features.find((f) => f.$?.['android:name'] === name);
      if (existing) existing.$['android:required'] = 'false';
      else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    return config;
  });
}

module.exports = withOptionalFeatures;
