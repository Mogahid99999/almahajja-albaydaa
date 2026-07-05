import Constants from 'expo-constants';

/**
 * Installed app version (from app.json). Used as the persisted-query-cache buster
 * (V10 Feature D): bumping the app version discards any stale persisted cache so a
 * new build never rehydrates data shaped for an older one.
 */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

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
