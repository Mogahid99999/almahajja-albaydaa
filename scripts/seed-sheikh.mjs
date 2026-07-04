/**
 * Idempotent seed for the demo SHEIKH (شيخ) account — V6 Q&A.
 *
 *   sheikh@gmail.com → role "sheikh"
 *
 * A sheikh login lands on /sheikh (the questions inbox) and can answer or
 * delete questions. Role is written to BOTH user_metadata (client routing) and
 * public.profiles (RLS source of truth), and a `sheikhs` metadata row is
 * linked via user_id. Re-running is safe.
 *
 * Run:  SEED_PASSWORD=... node scripts/seed-sheikh.mjs
 * Needs (from .env or shell env):  EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SEED_PASSWORD
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
const PASSWORD = env.SEED_PASSWORD;
if (!URL || !KEY) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}
if (!PASSWORD) {
  console.error('Missing SEED_PASSWORD env var — set it before running this script.');
  process.exit(1);
}

const ACCOUNT = {
  email: 'sheikh@gmail.com',
  password: PASSWORD,
  role: 'sheikh',
  display_name: 'الشيخ التجريبي',
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

/** Link a `sheikhs` metadata row (display chip in the app) to the login. */
async function linkSheikhRow(userId, name) {
  const existing = await fetch(
    `${URL}/rest/v1/sheikhs?user_id=eq.${userId}&select=id,name`,
    { headers },
  ).then((r) => r.json());
  if (Array.isArray(existing) && existing.length > 0) {
    console.log(`✓ sheikhs row already linked («${existing[0].name}»)`);
    return;
  }
  const res = await fetch(`${URL}/rest/v1/sheikhs?on_conflict=name`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ name, user_id: userId }),
  });
  if (!res.ok) throw new Error(`sheikhs upsert ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  console.log(`✓ sheikhs row «${rows[0]?.name}» linked to ${userId}`);
}

try {
  const id = await upsert(ACCOUNT);
  await linkSheikhRow(id, ACCOUNT.display_name);
  console.log('Done.');
} catch (e) {
  console.error(`✗ ${ACCOUNT.email}: ${e.message}`);
  process.exitCode = 1;
}
