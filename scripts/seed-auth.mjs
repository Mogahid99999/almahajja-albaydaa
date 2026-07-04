/**
 * Idempotent seed for the two demo accounts in Supabase Auth.
 *
 *   admin@gmail.com  → role "admin"
 *   user@gmail.com   → role "student"
 *
 * Roles are written to BOTH user_metadata (read client-side for routing) and the
 * public.profiles table (source of truth for RLS). Re-running is safe: existing
 * users are looked up by email and updated in place.
 *
 * Run:  SEED_PASSWORD=... node scripts/seed-auth.mjs
 * Needs (from .env or shell env):  EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SEED_PASSWORD
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency).
function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  return out;
}

const env = { ...loadEnv(), ...process.env };
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
const PASSWORD = env.SEED_PASSWORD;
if (!URL || !KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('Missing SEED_PASSWORD env var — set it before running this script.');
  process.exit(1);
}

const ACCOUNTS = [
  { email: 'admin@gmail.com', role: 'admin', display_name: 'مدير المنصة' },
  { email: 'user@gmail.com', role: 'student', display_name: 'طالب علم' },
];

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function findUserByEmail(email) {
  const res = await fetch(
    `${URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=200`,
    { headers },
  );
  if (!res.ok) throw new Error(`list users ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const list = body.users ?? body;
  return list.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function upsertUser({ email, role, display_name }) {
  const meta = { role, display_name };
  let user = await findUserByEmail(email);

  if (!user) {
    const res = await fetch(`${URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: meta,
        app_metadata: { role },
      }),
    });
    if (!res.ok) throw new Error(`create ${email} ${res.status}: ${await res.text()}`);
    user = await res.json();
    console.log(`✓ created ${email} (${role})  id=${user.id}`);
  } else {
    const res = await fetch(`${URL}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        password: PASSWORD,
        email_confirm: true,
        user_metadata: meta,
        app_metadata: { role },
      }),
    });
    if (!res.ok) throw new Error(`update ${email} ${res.status}: ${await res.text()}`);
    console.log(`✓ updated ${email} (${role})  id=${user.id}`);
  }

  // Mirror role into public.profiles (created by the on-signup trigger).
  const patch = await fetch(
    `${URL}/rest/v1/profiles?id=eq.${user.id}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ role, display_name }),
    },
  );
  if (!patch.ok && patch.status !== 404) {
    // 404/empty just means the profiles table/row isn't present yet — non-fatal.
    console.warn(`  (profiles patch ${patch.status}: ${await patch.text()})`);
  }
  return user.id;
}

for (const acct of ACCOUNTS) {
  try {
    await upsertUser(acct);
  } catch (e) {
    console.error(`✗ ${acct.email}: ${e.message}`);
    process.exitCode = 1;
  }
}
console.log('Done.');
