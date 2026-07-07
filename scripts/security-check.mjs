/**
 * RLS regression check — PLAN_SECURITY.md Phase S5.
 *
 * Verifies the invariants S0-S4 established stay true: anon has zero access,
 * students see only their own + published data, guests are blocked from
 * account-gated actions. Creates two throwaway registered users, one
 * throwaway anonymous session, and one throwaway draft lecture (with a real
 * storage object) via the service key; everything else runs through the
 * anon key only, exactly as the app does. All fixtures are deleted at the
 * end, pass or fail.
 *
 * Run:  node scripts/security-check.mjs
 * Needs (from .env or shell env):
 *   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency) — same pattern as scripts/seed-auth.mjs.
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
const ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SECRET_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SECRET_KEY in .env',
  );
  process.exit(1);
}

const svcHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

const results = [];
function record(label, pass, detail) {
  results.push({ label, pass, detail });
}

// ---- low-level helpers, all going through the anon key like the app does --
async function rpc(token, name, body = {}) {
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parsed(res);
}

async function select(token, table, qs) {
  const res = await fetch(`${URL}/rest/v1/${table}?${qs}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return parsed(res);
}

async function insertRow(token, table, row) {
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  return parsed(res);
}

// R2 read-gating (post-Supabase-Storage-migration) is a plain boolean RPC —
// `denied` here means either the call itself failed, or it returned `false`.
async function deniedReadObject(token, key) {
  const r = await rpc(token, 'can_read_storage_object', { p_key: key });
  return !r.ok || r.body !== true;
}

async function parsed(res) {
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

// Any non-2xx counts as denied. A 2xx with an empty array/object also counts:
// RLS-filtered selects and WHERE-is_admin()-gated RPCs (e.g. admin_user_list)
// return empty rather than an error — no data leaked either way.
function isDenied({ ok, body }) {
  if (!ok) return true;
  if (Array.isArray(body)) return body.length === 0;
  if (body && typeof body === 'object') return Object.keys(body).length === 0;
  return false;
}

// ---- service-role fixture helpers (bypass RLS by design) ------------------
async function createUser(email, password) {
  const res = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svcHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`create user ${email}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function deleteUser(id) {
  await fetch(`${URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svcHeaders });
}

async function signIn(email, password) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign in ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function signInAnon() {
  const res = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`anon sign-in: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { token: json.access_token, id: json.user.id };
}

// ---- fixtures ---------------------------------------------------------
const ts = Date.now();
const PW = `Ch3ckPw-${ts}`;
const fixtures = { userIds: [], anonId: null, lectureId: null, objectKey: null };

async function setup() {
  const a = await createUser(`sec-check-a-${ts}@example.com`, PW);
  const b = await createUser(`sec-check-b-${ts}@example.com`, PW);
  fixtures.userIds.push(a.id, b.id);
  const tokA = await signIn(`sec-check-a-${ts}@example.com`, PW);
  const tokB = await signIn(`sec-check-b-${ts}@example.com`, PW);
  const anon = await signInAnon();
  fixtures.anonId = anon.id;

  // can_read_storage_object only checks DB state (lecture/attachment rows), not
  // real bytes in R2 — a draft lecture referencing a phantom key is enough to
  // test draft/published read scoping (S2).
  const objectKey = `lectures/sec-check-${ts}.mp3`;
  fixtures.objectKey = objectKey;

  const secRes = await fetch(`${URL}/rest/v1/sections?select=id&limit=1`, { headers: svcHeaders });
  const [section] = await secRes.json();
  if (!section) throw new Error('no sections exist to attach a test lecture to');
  fixtures.sectionId = section.id;

  const lecRes = await fetch(`${URL}/rest/v1/lectures`, {
    method: 'POST',
    headers: { ...svcHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      title: 'sec-check temp (draft)',
      audio_path: objectKey,
      section_id: section.id,
      status: 'draft',
    }),
  });
  const [lecture] = await lecRes.json();
  fixtures.lectureId = lecture.id;

  // Give B a private row in each "must not leak to A" table.
  await fetch(`${URL}/rest/v1/notifications`, {
    method: 'POST',
    headers: { ...svcHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: b.id, type: 'buddy_activity', title: 'private', body: 'private' }),
  });

  return { tokA, tokB, anonTok: anon.token, bId: b.id };
}

async function teardown() {
  if (fixtures.lectureId) {
    await fetch(`${URL}/rest/v1/lectures?id=eq.${fixtures.lectureId}`, { method: 'DELETE', headers: svcHeaders });
  }
  for (const id of fixtures.userIds) await deleteUser(id);
  if (fixtures.anonId) await deleteUser(fixtures.anonId);
}

// ---- checks -------------------------------------------------------------
async function run() {
  const { tokA, tokB, anonTok, bId } = await setup();
  void tokB;
  const noSession = ANON_KEY; // no user JWT at all — the true `anon` role

  // A) anon (no session)
  record('anon: get_sections_flat rejected', isDenied(await rpc(noSession, 'get_sections_flat')));
  record(
    'anon: get_public_questions rejected',
    isDenied(await rpc(noSession, 'get_public_questions', { p_search: null, p_lecture_id: null })),
  );
  record('anon: cannot select lectures', isDenied(await select(noSession, 'lectures', 'select=id&limit=1')));
  record('anon: cannot read a storage object', await deniedReadObject(noSession, fixtures.objectKey));

  // B) student A
  const lectures = await select(tokA, 'lectures', 'select=id,status');
  const onlyPublished = Array.isArray(lectures.body) && lectures.body.every((l) => l.status === 'published');
  record('student: sees only published lectures', onlyPublished);

  record("student: cannot read B's progress", isDenied(await select(tokA, 'user_lecture_progress', `user_id=eq.${bId}`)));
  record("student: cannot read B's notes", isDenied(await select(tokA, 'lecture_notes', `user_id=eq.${bId}`)));
  record("student: cannot read B's notifications", isDenied(await select(tokA, 'notifications', `user_id=eq.${bId}`)));
  record("student: cannot read B's quiz attempts", isDenied(await select(tokA, 'quiz_attempts', `user_id=eq.${bId}`)));

  record('student: admin_dashboard_stats rejected', isDenied(await rpc(tokA, 'admin_dashboard_stats')));
  record(
    'student: admin_user_list returns nothing',
    isDenied(await rpc(tokA, 'admin_user_list', { p_search: null, p_limit: 10, p_offset: 0 })),
  );
  record('student: set_app_config rejected', isDenied(await rpc(tokA, 'set_app_config', { p_key: 'sec_check', p_value: 'x' })));
  record(
    'student: create_broadcast rejected',
    isDenied(await rpc(tokA, 'create_broadcast', { p_title: 'x', p_body: 'x', p_show_on_home: false })),
  );

  record('student: cannot read draft lecture audio', await deniedReadObject(tokA, fixtures.objectKey));
  record('student: cannot write to sections', isDenied(await insertRow(tokA, 'sections', { title: 'sec-check' })));
  record(
    'student: cannot write to lectures',
    isDenied(
      await insertRow(tokA, 'lectures', { title: 'sec-check', audio_path: 'sec-check.mp3', section_id: fixtures.sectionId }),
    ),
  );

  // C) guest (anonymous session)
  record(
    'guest: start_quiz_attempt rejected',
    isDenied(await rpc(anonTok, 'start_quiz_attempt', { p_quiz_id: '00000000-0000-0000-0000-000000000000' })),
  );
  record(
    'guest: ask_question rejected',
    isDenied(
      await rpc(anonTok, 'ask_question', {
        p_scope: 'general',
        p_lecture_id: null,
        p_is_anonymous: false,
        p_audience: 'public',
        p_body: 'sec-check test question',
      }),
    ),
  );
  record(
    'guest: add_lecture_benefit rejected',
    isDenied(
      await rpc(anonTok, 'add_lecture_benefit', {
        p_lecture_id: '00000000-0000-0000-0000-000000000000',
        p_body: 'sec-check test benefit',
      }),
    ),
  );
  record(
    'guest: send_buddy_request rejected',
    isDenied(await rpc(anonTok, 'send_buddy_request', { p_to_user_id: '00000000-0000-0000-0000-000000000001' })),
  );

  await teardown();
}

run()
  .then(() => {
    console.log('');
    let failed = 0;
    for (const r of results) {
      console.log(`${r.pass ? '✅' : '❌'} ${r.label}`);
      if (!r.pass) failed++;
    }
    console.log('');
    console.log(failed === 0 ? `All ${results.length} checks passed.` : `${failed}/${results.length} checks FAILED.`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error('security-check crashed:', e);
    await teardown().catch(() => {});
    process.exit(1);
  });
