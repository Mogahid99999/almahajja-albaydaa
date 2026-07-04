/**
 * Idempotent seed for the demo PUBLISHER (ناشر) account.
 *
 *   publisher@gmail.com → role "publisher"  (password test55%%)
 *
 * A publisher is a content-only admin (sections/sheikhs/lectures/quizzes/
 * attachments + incoming queue), with NO access to users/analytics/settings.
 * Role is written to BOTH user_metadata (client routing) and public.profiles
 * (RLS source of truth). Re-running is safe.
 *
 * Run:  node scripts/seed-publisher.mjs
 * Needs (from .env):  EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
if (!URL || !KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

const ACCOUNT = {
  email: 'publisher@gmail.com',
  password: 'test55%%',
  role: 'publisher',
  display_name: 'ناشر تجريبي',
};

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

async function upsert({ email, password, role, display_name }) {
  const meta = { role, display_name };
  let user = await findUserByEmail(email);

  if (!user) {
    const res = await fetch(`${URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        password,
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
        password,
        email_confirm: true,
        user_metadata: meta,
        app_metadata: { role },
      }),
    });
    if (!res.ok) throw new Error(`update ${email} ${res.status}: ${await res.text()}`);
    console.log(`✓ updated ${email} (${role})  id=${user.id}`);
  }

  const patch = await fetch(`${URL}/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ role, display_name }),
  });
  if (!patch.ok && patch.status !== 404) {
    console.warn(`  (profiles patch ${patch.status}: ${await patch.text()})`);
  }
  return user.id;
}

try {
  await upsert(ACCOUNT);
  console.log('Done.');
} catch (e) {
  console.error(`✗ ${ACCOUNT.email}: ${e.message}`);
  process.exitCode = 1;
}
