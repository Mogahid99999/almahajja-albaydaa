/**
 * The app's text sizes are fixed: they do not follow the phone's font-size
 * setting, so every screen looks the same on every phone (owner, 2026-11-18 —
 * «اريده متسق»). With the setting raised (common among our students) text grew
 * past fixed-height fields and pills and was cut. One switch for the whole app:
 * Txt and the shared TextInput read it; a caller may still pass its own
 * `allowFontScaling`.
 */
export const APP_FONT_SCALING = false;
