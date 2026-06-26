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
} as const;
