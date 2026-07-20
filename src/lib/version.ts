import Constants from 'expo-constants';

/**
 * Installed app version (from app.json). Used as the persisted-query-cache buster
 * (V10 Feature D): bumping the app version discards any stale persisted cache so a
 * new build never rehydrates data shaped for an older one.
 */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

/**
 * Build number — iOS buildNumber or Android versionCode from app.json, whichever
 * this platform carries. Shown beside APP_VERSION in About/Profile (Feature B) so
 * a bug report can be pinned to an exact build.
 */
export const BUILD_NUMBER: string = String(
  Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode ??
    '—',
);

/**
 * «الإصدار ١٫١٫٠» — the human version, Arabic-Indic digits, for the muted footer
 * line. The build number is intentionally NOT shown (owner preference 2026-07-20);
 * BUILD_NUMBER stays exported for bug reports (src/api/feedback.ts). Single-sourced
 * from Constants.expoConfig (app.json), so the version bump is the only place that
 * has to change.
 */
export function appVersionLabel(): string {
  const toAr = (s: string) => s.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  return `الإصدار ${toAr(APP_VERSION)}`;
}

/**
 * Compare two dotted numeric version strings (e.g. "1.2.0" vs "1.10.0").
 * Returns -1 if a < b, 0 if equal, 1 if a > b. Non-numeric / missing parts
 * count as 0, so "1.0" and "1.0.0" compare equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
