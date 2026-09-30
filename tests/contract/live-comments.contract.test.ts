/**
 * Contract tests for migration 0147 + the live-control comment actions
 * («التعليقات والأسئلة أثناء البث»), against the live STAGING project.
 *
 * Pins the owner's anonymity invariants end to end (SQL + the deployed edge
 * function):
 *   - «بدون اسم» is hidden from EVERYONE: a brother's nameless comment and a
 *     hidden sister's comment (forced nameless even when she asks for her name)
 *     never expose a name or a user id — not to another listener, not to the
 *     sheikh, not through admin_live_comments, not in the post response, not in
 *     the moderation log; the nameless row doesn't even store a name.
 *   - a sister who joined WITH her name may post named — others see her name.
 *   - guests read but can't write (403 guest_cannot_comment).
 *   - 1 comment / 10 s per user (429 rate_limited); blocked words (400); empty /
 *     too_long (400); green or ended → 409 not_live; not in the room → 409 not_present.
 *   - delete: the author, or a moderator (the host); another student → 403.
 *   - answered / block: host or content manager; block → the author's next
 *     comment is 403 blocked, and the block response names nobody.
 *   - reads: a participant while green/live; staff any time; a non-participant
 *     (or anon) is refused; after the end only staff read.
 *
 * Needs 0147 applied and the comment-aware live-control deployed to staging.
 * Does NOT touch app_config.live_enabled (comments don't depend on it).
 *
 * Fixtures (all «تجربة», deleted in afterAll): one root section, ONE live
 * session inserted with the service key (notify_all off — no fan-out; no
 * LiveKit room, so broadcasts are skipped/failed and must not fail requests),
 * its participants, comments and log rows (cascade), a guest and five
 * throwaway students. The session is ended before it is deleted.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const STAFF_PASSWORD = '12345678';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const service: SupabaseClient = createClient(url, serviceKey, opts);

const ts = Date.now();
const userIds: string[] = [];
let sectionId = '';
let sessionId = '';
let roomPrefix = 'stg_';

let anon: SupabaseClient;
let guest: SupabaseClient;
let brother: SupabaseClient; // named listener
let brother2: SupabaseClient; // posts nameless, gets blocked
let sisterHidden: SupabaseClient; // joined «بدون اسم»
let sisterNamed: SupabaseClient; // joined with her name
let outsider: SupabaseClient; // registered, never joined
let admin: SupabaseClient; // content manager, never joins
let sheikh: SupabaseClient; // the host

let brotherId = '';
let brother2Id = '';
let sisterHiddenId = '';
let sisterNamedId = '';
let sheikhId = '';

const names = {
  brother: `تجربة أخ التعليقات ${ts}`,
  brother2: `تجربة أخ ثانٍ التعليقات ${ts}`,
  sisterHidden: `تجربة أخت مخفية ${ts}`,
  sisterNamed: `تجربة أخت ظاهرة ${ts}`,
  outsider: `تجربة خارج المجلس ${ts}`,
};

// comment ids
let cBrother = '';
let cSisterHidden = '';
let cSisterNamed = '';
let cBrother2 = '';

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

async function throwaway(label: string, gender: 'male' | 'female', name: string): Promise<[SupabaseClient, string]> {
  const email = `tajriba-livecomments-${label}-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error || !data.user) throw error ?? new Error('throwaway user not created');
  userIds.push(data.user.id);
  const upd = await service.from('profiles').update({ gender, display_name: name }).eq('id', data.user.id);
  if (upd.error) throw upd.error;
  return [await signIn(email, password), data.user.id];
}

async function addParticipant(userId: string, gender: 'm' | 'f', role: string, hidden = false) {
  const { data: identity, error } = await service.rpc('live_identity', { p_session: sessionId, p_user: userId });
  if (error) throw error;
  const ins = await service.from('live_participants').upsert(
    { session_id: sessionId, user_id: userId, identity, gender, hidden_name: hidden, role, left_at: null },
    { onConflict: 'session_id,user_id' },
  );
  if (ins.error) throw ins.error;
}

async function setStatus(status: 'green' | 'live' | 'ended') {
  const { error } = await service
    .from('live_sessions')
    .update({ status, ...(status === 'live' ? { started_at: new Date().toISOString() } : {}), ...(status === 'ended' ? { ended_at: new Date().toISOString() } : {}) })
    .eq('id', sessionId);
  if (error) throw error;
}

/** POST live-control as this client's user → HTTP status + JSON body (+ the raw text). */
async function control(
  c: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, any> | null; raw: string }> {
  const { data } = await c.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('live-control: the client has no session');
  const res = await fetch(`${url}/functions/v1/live-control`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: Record<string, any> | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, raw };
}

const post = (c: SupabaseClient, text: string, anonymous: boolean, kind: 'comment' | 'question' = 'comment') =>
  control(c, { action: 'comment', sessionId, kind, text, anonymous });

/** Nothing identifying a nameless author may appear anywhere in `x`. */
function expectNoTraceOf(x: unknown, who: { id: string; name: string }[]) {
  const s = JSON.stringify(x);
  for (const w of who) {
    expect(s).not.toContain(w.id);
    expect(s).not.toContain(w.name);
  }
  expect(s).not.toContain('user_id');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (!serviceKey) throw new Error('live comments contract tests need SUPABASE_SECRET_KEY in .env.staging.local');

  // D3: the suite needs the single green/live slot.
  const { data: active, error: aErr } = await service
    .from('live_sessions')
    .select('id')
    .in('status', ['green', 'live']);
  if (aErr) throw aErr;
  if (active!.length) throw new Error('a staging live session is green/live — rerun when it has ended');

  const cfg = await service.from('live_config').select('room_prefix').single();
  if (cfg.data?.room_prefix) roomPrefix = cfg.data.room_prefix;

  anon = newClient();
  guest = newClient();
  const g = await guest.auth.signInAnonymously();
  if (g.error) throw g.error;
  userIds.push(g.data.user!.id);
  [brother, brotherId] = await throwaway('brother', 'male', names.brother);
  [brother2, brother2Id] = await throwaway('brother2', 'male', names.brother2);
  [sisterHidden, sisterHiddenId] = await throwaway('sister-hidden', 'female', names.sisterHidden);
  [sisterNamed, sisterNamedId] = await throwaway('sister-named', 'female', names.sisterNamed);
  [outsider] = await throwaway('outsider', 'male', names.outsider);
  admin = await signIn('admin@gmail.com', STAFF_PASSWORD);
  sheikh = await signIn('sheikh@gmail.com', STAFF_PASSWORD);
  sheikhId = (await sheikh.auth.getUser()).data.user!.id;

  const { data: sec, error: sErr } = await service
    .from('sections')
    .insert({ title: `تجربة قسم تعليقات البث ${ts}`, visibility: 'all' })
    .select('id')
    .single();
  if (sErr || !sec) throw sErr ?? new Error('fixture section not created');
  sectionId = sec.id;

  // Green first (the host's green room): nobody may comment yet.
  const hex12 = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  const { data: s, error: insErr } = await service
    .from('live_sessions')
    .insert({
      section_id: sectionId,
      title: `تجربة مجلس التعليقات ${ts}`,
      status: 'green',
      host_user_id: sheikhId,
      notify_all: false,
      room_name: roomPrefix + hex12,
      share_code: code,
    })
    .select('id')
    .single();
  if (insErr || !s) throw insErr ?? new Error('fixture session not created');
  sessionId = s.id;

  await addParticipant(sheikhId, 'm', 'host');
  await addParticipant(brotherId, 'm', 'listener');
  await addParticipant(brother2Id, 'm', 'listener');
  await addParticipant(sisterHiddenId, 'f', 'listener', true);
  await addParticipant(sisterNamedId, 'f', 'listener', false);
  await addParticipant(g.data.user!.id, 'm', 'listener');
}, 60_000);

afterAll(async () => {
  if (sessionId) {
    // End it (never leave the D3 slot taken), then remove it with its comments,
    // blocks, participants and log rows (cascade).
    await service.from('live_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', sessionId).in('status', ['green', 'live']);
    await service.from('live_sessions').delete().eq('id', sessionId);
  }
  if (sectionId) await service.from('sections').delete().eq('id', sectionId);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await Promise.all(
    [guest, brother, brother2, sisterHidden, sisterNamed, outsider, admin, sheikh]
      .filter(Boolean)
      .map((c) => c.auth.signOut()),
  );
}, 60_000);

// ---------------------------------------------------------------------------------
describe('before the broadcast starts (green)', () => {
  test('writing needs a live session: 409 not_live', async () => {
    const r = await post(brother, 'تجربة تعليق قبل البدء', false);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'not_live' });
  });

  test('participants and staff can already read (empty)', async () => {
    for (const c of [brother, guest, sheikh, admin]) {
      const { data, error } = await c.rpc('get_live_comments', { p_session: sessionId });
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------
describe('live: posting and the anonymity invariants', () => {
  beforeAll(async () => {
    await setStatus('live');
  });

  test('guests read but never write: 403 guest_cannot_comment', async () => {
    const r = await post(guest, 'تجربة تعليق ضيف', false);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'guest_cannot_comment' });
    const { data } = await service.from('live_comments').select('id').eq('session_id', sessionId);
    expect(data).toEqual([]);
  });

  test('a registered user who never joined: 409 not_present', async () => {
    const r = await post(outsider, 'تجربة تعليق من خارج المجلس', false);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'not_present' });
  });

  test('a brother posts with his name → 200, the public shape + mine', async () => {
    const r = await post(brother, '  تجربة: جزاكم الله خيراً  ', false);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: 'live' });
    const c = r.body!.comment;
    expect(Object.keys(c).sort()).toEqual(['answered', 'at', 'gender', 'id', 'kind', 'mine', 'name', 'text']);
    expect(c).toMatchObject({
      kind: 'comment',
      text: 'تجربة: جزاكم الله خيراً', // trimmed
      name: names.brother,
      gender: 'm',
      answered: false,
      mine: true,
    });
    expect(c.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(r.raw).not.toContain(brotherId);
    cBrother = c.id;
  });

  test('rate limit: a second comment within 10 s → 429 rate_limited', async () => {
    const r = await post(brother, 'تجربة تعليق ثانٍ سريع', false);
    expect(r.status).toBe(429);
    expect(r.body).toEqual({ error: 'rate_limited' });
  });

  test('a sister who joined «بدون اسم» is ALWAYS nameless — even when she asks for her name', async () => {
    const r = await post(sisterHidden, 'تجربة: ما حكم صلاة الوتر بعد الفجر؟', false, 'question');
    expect(r.status).toBe(200);
    expect(r.body!.comment).toMatchObject({ kind: 'question', name: null, gender: 'f', mine: true });
    expectNoTraceOf(r.body, [{ id: sisterHiddenId, name: names.sisterHidden }]);
    cSisterHidden = r.body!.comment.id;
  });

  test('a sister who joined with her name may post named', async () => {
    const r = await post(sisterNamed, 'تجربة: بارك الله فيكم', false, 'question');
    expect(r.status).toBe(200);
    expect(r.body!.comment).toMatchObject({ name: names.sisterNamed, gender: 'f' });
    cSisterNamed = r.body!.comment.id;
  });

  test('a brother chooses «بدون اسم» → nameless', async () => {
    const r = await post(brother2, 'تجربة: سؤال بدون اسم', true);
    expect(r.status).toBe(200);
    expect(r.body!.comment).toMatchObject({ name: null, gender: 'm' });
    expectNoTraceOf(r.body, [{ id: brother2Id, name: names.brother2 }]);
    cBrother2 = r.body!.comment.id;
  });

  test('nothing to leak: a nameless row does not even store a name', async () => {
    const { data, error } = await service
      .from('live_comments')
      .select('id, show_name, display_name')
      .in('id', [cSisterHidden, cBrother2, cBrother, cSisterNamed]);
    expect(error).toBeNull();
    const byId = Object.fromEntries(data!.map((r) => [r.id, r]));
    expect(byId[cSisterHidden]).toMatchObject({ show_name: false, display_name: null });
    expect(byId[cBrother2]).toMatchObject({ show_name: false, display_name: null });
    expect(byId[cBrother]).toMatchObject({ show_name: true, display_name: names.brother });
    expect(byId[cSisterNamed]).toMatchObject({ show_name: true, display_name: names.sisterNamed });
  });

  test('blocked words → 400 blocked_words (checked before the rate limit)', async () => {
    const r = await post(sisterNamed, 'تجربة يا حقير', false);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'blocked_words' });
  });

  test('empty / too_long / bad body', async () => {
    const e = await post(sisterNamed, '   \n  ', false);
    expect(e.status).toBe(400);
    expect(e.body).toEqual({ error: 'empty' });
    const t = await post(sisterNamed, 'ب'.repeat(301), false);
    expect(t.status).toBe(400);
    expect(t.body).toEqual({ error: 'too_long' });
    const b = await control(sisterNamed, { action: 'comment', sessionId, kind: 'comment', text: 'x' });
    expect(b.status).toBe(400);
    expect(b.body).toMatchObject({ error: 'bad_request' });
  });

  test('another listener sees names only where chosen — nameless authors leave no trace', async () => {
    const { data, error } = await brother.rpc('get_live_comments', { p_session: sessionId });
    expect(error).toBeNull();
    const list = data as any[];
    expect(list.map((c) => c.id)).toEqual([cBrother, cSisterHidden, cSisterNamed, cBrother2]); // oldest first
    const byId = Object.fromEntries(list.map((c) => [c.id, c]));
    expect(byId[cBrother]).toMatchObject({ name: names.brother, mine: true });
    expect(byId[cSisterHidden]).toMatchObject({ name: null, gender: 'f', kind: 'question', mine: false });
    expect(byId[cSisterNamed]).toMatchObject({ name: names.sisterNamed, mine: false });
    expect(byId[cBrother2]).toMatchObject({ name: null, mine: false });
    for (const c of list) {
      expect(Object.keys(c).sort()).toEqual(['answered', 'at', 'gender', 'id', 'kind', 'mine', 'name', 'text']);
    }
    expectNoTraceOf(list, [
      { id: sisterHiddenId, name: names.sisterHidden },
      { id: brother2Id, name: names.brother2 },
    ]);
    expect(JSON.stringify(list)).not.toContain(brotherId);
    expect(JSON.stringify(list)).not.toContain(sisterNamedId);
  });

  test('the sheikh (host) and an admin see no more than that', async () => {
    for (const c of [sheikh, admin]) {
      const { data, error } = await c.rpc('get_live_comments', { p_session: sessionId });
      expect(error).toBeNull();
      const byId = Object.fromEntries((data as any[]).map((x) => [x.id, x]));
      expect(byId[cSisterHidden].name).toBeNull();
      expect(byId[cBrother2].name).toBeNull();
      expectNoTraceOf(data, [
        { id: sisterHiddenId, name: names.sisterHidden },
        { id: brother2Id, name: names.brother2 },
      ]);
    }
    const { data, error } = await admin.rpc('admin_live_comments', { p_session: sessionId });
    expect(error).toBeNull();
    const byId = Object.fromEntries((data as any[]).map((x) => [x.id, x]));
    expect(byId[cSisterHidden]).toMatchObject({ name: null, deleted: false });
    expect(byId[cBrother2]).toMatchObject({ name: null, deleted: false });
    expectNoTraceOf(data, [
      { id: sisterHiddenId, name: names.sisterHidden },
      { id: brother2Id, name: names.brother2 },
    ]);
  });

  test('the hidden sister herself sees her comment as mine', async () => {
    const { data } = await sisterHidden.rpc('get_live_comments', { p_session: sessionId });
    const mine = (data as any[]).filter((c) => c.mine).map((c) => c.id);
    expect(mine).toEqual([cSisterHidden]);
  });

  test('guests read; a non-participant, anon and a student on admin_live_comments are refused', async () => {
    const g = await guest.rpc('get_live_comments', { p_session: sessionId });
    expect(g.error).toBeNull();
    expect((g.data as any[]).length).toBe(4);
    const o = await outsider.rpc('get_live_comments', { p_session: sessionId });
    expect(o.error).not.toBeNull();
    expect(o.error!.message).toContain('غير مصرح');
    expect(o.data).toBeNull();
    const a = await anon.rpc('get_live_comments', { p_session: sessionId });
    expect(a.error).not.toBeNull();
    for (const c of [brother, guest]) {
      const r = await c.rpc('admin_live_comments', { p_session: sessionId });
      expect(r.error).not.toBeNull();
      expect(r.data).toBeNull();
    }
    // The tables themselves are closed to every client role.
    for (const c of [brother, admin, sheikh]) {
      for (const t of ['live_comments', 'live_comment_blocks']) {
        const r = await c.from(t).select('*').limit(1);
        expect(r.error).not.toBeNull();
      }
    }
    // …and the service-role functions too.
    for (const c of [brother, admin]) {
      const r = await c.rpc('live_post_comment', {
        p_session: sessionId,
        p_user: brotherId,
        p_kind: 'comment',
        p_body: 'تجربة',
        p_anonymous: false,
      });
      expect(r.error).not.toBeNull();
    }
  });

  test('the rate limit window: 10 s later the brother may post again', async () => {
    await sleep(10_500);
    const r = await post(brother, 'تجربة: تعليق بعد عشر ثوانٍ', false);
    expect(r.status).toBe(200);
    // his own delete of this one
    const d = await control(brother, { action: 'comment_delete', sessionId, commentId: r.body!.comment.id });
    expect(d.status).toBe(200);
  }, 30_000);
});

// ---------------------------------------------------------------------------------
describe('live: delete, answered, block', () => {
  test('another student cannot delete someone else\'s comment (403); the author can (200)', async () => {
    const x = await control(sisterNamed, { action: 'comment_delete', sessionId, commentId: cBrother });
    expect(x.status).toBe(403);
    expect(x.body).toEqual({ error: 'forbidden' });

    const d = await control(brother, { action: 'comment_delete', sessionId, commentId: cBrother });
    expect(d.status).toBe(200);
    expect(d.body).toEqual({ ok: true, status: 'live', id: cBrother });
    const again = await control(brother, { action: 'comment_delete', sessionId, commentId: cBrother });
    expect(again.status).toBe(200); // idempotent

    const { data } = await sisterNamed.rpc('get_live_comments', { p_session: sessionId });
    expect((data as any[]).map((c) => c.id)).not.toContain(cBrother);
  });

  test('the host deletes a comment as moderator; logged without the author', async () => {
    const d = await control(sheikh, { action: 'comment_delete', sessionId, commentId: cSisterNamed });
    expect(d.status).toBe(200);
    const { data: log } = await service
      .from('live_moderation_log')
      .select('action, actor_user_id, target_identity, detail')
      .eq('session_id', sessionId)
      .eq('action', 'comment_delete');
    expect(log).toEqual([
      { action: 'comment_delete', actor_user_id: sheikhId, target_identity: null, detail: { comment_id: cSisterNamed } },
    ]); // the author's own deletes are not logged
  });

  test('answered: host or content manager only', async () => {
    const s = await control(brother, { action: 'comment_answered', sessionId, commentId: cSisterHidden, answered: true });
    expect(s.status).toBe(403);
    expect(s.body).toEqual({ error: 'forbidden' });

    const h = await control(sheikh, { action: 'comment_answered', sessionId, commentId: cSisterHidden, answered: true });
    expect(h.status).toBe(200);
    expect(h.body).toEqual({ ok: true, status: 'live', id: cSisterHidden, answered: true });
    const { data } = await brother.rpc('get_live_comments', { p_session: sessionId });
    expect((data as any[]).find((c) => c.id === cSisterHidden)).toMatchObject({ answered: true, name: null });

    // an admin who never joined the room moderates too
    const a = await control(admin, { action: 'comment_answered', sessionId, commentId: cSisterHidden, answered: false });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ answered: false });
    const bad = await control(sheikh, { action: 'comment_answered', sessionId, commentId: cSisterHidden });
    expect(bad.status).toBe(400);
  });

  test('block a nameless author: the response names nobody, the comment is gone, his next comment → 403 blocked', async () => {
    const s = await control(brother, { action: 'comment_block', sessionId, commentId: cBrother2 });
    expect(s.status).toBe(403);

    const b = await control(sheikh, { action: 'comment_block', sessionId, commentId: cBrother2 });
    expect(b.status).toBe(200);
    expect(b.body).toEqual({ ok: true, status: 'live', id: cBrother2 });
    expectNoTraceOf(b.raw, [{ id: brother2Id, name: names.brother2 }]);

    const { data } = await brother.rpc('get_live_comments', { p_session: sessionId });
    expect((data as any[]).map((c) => c.id)).not.toContain(cBrother2);

    const r = await post(brother2, 'تجربة: تعليق بعد المنع', true);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'blocked' });

    // the log keeps the act, never the author
    const { data: log } = await service
      .from('live_moderation_log')
      .select('action, target_identity, detail')
      .eq('session_id', sessionId)
      .in('action', ['comment_block', 'comment_answered']);
    expect(log!.length).toBe(3);
    for (const row of log!) {
      expect(row.target_identity).toBeNull();
      expectNoTraceOf(row.detail, [{ id: brother2Id, name: names.brother2 }, { id: sisterHiddenId, name: names.sisterHidden }]);
    }
  });

  test('a moderator cannot block himself (409 invalid_target); unknown comment → 404', async () => {
    // the sheikh posts one of his own
    const p = await post(sheikh, 'تجربة: تعليق الشيخ', false);
    expect(p.status).toBe(200);
    const self = await control(sheikh, { action: 'comment_block', sessionId, commentId: p.body!.comment.id });
    expect(self.status).toBe(409);
    expect(self.body).toEqual({ error: 'invalid_target' });
    const nf = await control(admin, {
      action: 'comment_delete',
      sessionId,
      commentId: '00000000-0000-4000-8000-000000000000',
    });
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ error: 'not_found' });
  });

  test('admin_live_comments keeps the deleted ones (deleted: true), nameless still nameless', async () => {
    const { data, error } = await sheikh.rpc('admin_live_comments', { p_session: sessionId });
    expect(error).toBeNull();
    const byId = Object.fromEntries((data as any[]).map((x) => [x.id, x]));
    expect(byId[cBrother]).toMatchObject({ deleted: true, name: names.brother });
    expect(byId[cSisterNamed]).toMatchObject({ deleted: true });
    expect(byId[cBrother2]).toMatchObject({ deleted: true, name: null });
    expect(byId[cSisterHidden]).toMatchObject({ deleted: false, name: null });
    expectNoTraceOf(data, [
      { id: sisterHiddenId, name: names.sisterHidden },
      { id: brother2Id, name: names.brother2 },
    ]);
  });
});

// ---------------------------------------------------------------------------------
describe('after the majlis', () => {
  beforeAll(async () => {
    await setStatus('ended');
  });

  test('writing → 409 not_live; listeners no longer read; staff still do', async () => {
    const r = await post(sisterNamed, 'تجربة: بعد الانتهاء', false);
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'not_live' });

    const l = await brother.rpc('get_live_comments', { p_session: sessionId });
    expect(l.error).not.toBeNull();

    const s = await admin.rpc('get_live_comments', { p_session: sessionId });
    expect(s.error).toBeNull();
    expect((s.data as any[]).map((c) => c.id)).toContain(cSisterHidden);
    const a = await admin.rpc('admin_live_comments', { p_session: sessionId });
    expect(a.error).toBeNull();
    expect((a.data as any[]).length).toBeGreaterThanOrEqual(5);
  });

  test('staff may still clean up after the end', async () => {
    const d = await control(admin, { action: 'comment_delete', sessionId, commentId: cSisterHidden });
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({ ok: true, status: 'ended', id: cSisterHidden });
  });
});
