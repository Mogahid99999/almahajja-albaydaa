const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

/**
 * R8 keep rules for the live «الحلقة» stack (V23). WebRTC's JNI_OnLoad looks
 * its Java classes up BY NAME; @livekit/react-native-webrtc's consumer rules
 * keep `org.jni_zero.**` but the LiveKit build repackages it as
 * `livekit.org.jni_zero.**`, so a minified release crashed at launch with
 * ClassNotFoundException: livekit.org.jni_zero.JniInit → SIGTRAP in
 * liblkjingle_peerconnection_so JNI_OnLoad (found on R5CX10P3BPL, 2026-09-28).
 *
 * Appended to android/app/proguard-rules.pro on prebuild (android/ is
 * gitignored, EAS prebuilds it), idempotent via the marker line.
 */
const MARKER = '# withLiveKitProguard';
const RULES = `
${MARKER} — LiveKit / WebRTC classes resolved from JNI by name (V23)
-keep class livekit.org.webrtc.** { *; }
-keep class livekit.org.jni_zero.** { *; }
-keep class com.oney.WebRTCModule.** { *; }
-keep class com.livekit.reactnative.** { *; }
-keep class expo.modules.liveforeground.** { *; }
`;

function withLiveKitProguard(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const file = path.join(config.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!contents.includes(MARKER)) fs.writeFileSync(file, contents.trimEnd() + '\n' + RULES);
      return config;
    },
  ]);
}

module.exports = withLiveKitProguard;
