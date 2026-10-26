/**
 * Runtime environment configuration.
 *
 * Only `EXPO_PUBLIC_*` variables are inlined into the client bundle by Expo,
 * so both values below are safe to ship (the Supabase anon key is a public,
 * RLS-gated key — never put the service-role key here).
 *
 * Copy `.env.example` to `.env` and fill these in.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing environment variable: ${name}. ` +
        `Copy .env.example to .env and set the Supabase project values.`,
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required(
    'EXPO_PUBLIC_SUPABASE_URL',
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
  /**
   * Base URL of the Madinah mushaf pack on our own server (static files, see
   * scripts/mushaf/README.md). Optional: without it the simplified mushaf
   * still works and print mode is simply not offered. Release builds accept
   * HTTPS only; plain http is for a local dev pack server.
   */
  mushafPackUrl: packUrl(process.env.EXPO_PUBLIC_MUSHAF_PACK_URL),
} as const;

function packUrl(value: string | undefined): string | null {
  const v = value?.trim().replace(/\/+$/, '');
  if (!v) return null;
  if (v.startsWith('https://')) return v;
  // Plain http: dev bundles, or a loopback test server (adb reverse) in any
  // bundle — Android release builds refuse cleartext anyway.
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  return v.startsWith('http://') && (dev || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(v)) ? v : null;
}
