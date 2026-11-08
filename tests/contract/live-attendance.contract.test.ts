/**
 * Contract tests for migration 0167 — live attendance «حضور البث المباشر»,
 * against the STAGING project.
 *
 * Drives the real server path: live_room_event (what the media worker calls for
 * every LiveKit webhook) with connection sids + LiveKit timestamps, the end
 * trigger on live_sessions.ended_at, room_finished, the publish trigger on the
 * session's lecture, and save_activity for the recording path.
 *
 * One live of exactly 60 min, [T, T+60m] with T = now − 3 h (whole seconds):
 *   full          joins 5 min BEFORE the start, leaves 5 min AFTER the end → 100 %
 *   late          +20 → +65                                                 →  66.67 %
 *   early         +0 → +30 (its left webhook arrives BEFORE its join)       →  50 %
 *   back          +0 → +20, rejoins +30 → +62 (two connections)             →  83.33 %
 *   reco          conn A +0 (left lost), conn B +10 → +50, A's left arrives
 *                 late (+12) + B's join redelivered                         →  83.33 % (not doubled)
 *   exact70       +0 → +42:00                                               →  70.00 % ✓
 *   under70       +0 → +41:59                                               →  69.97 % ✗
 *   endConnected  +15, still connected when the live ends                   →  75 %
 *   preStart      −30 → −5 (green room only)                                →   0 %
 * Threshold 70 (live_completion_threshold_pct). On publish, the qualified get
 * the lecture completed with completion_source 'live'; a recording completion
 * that already exists is kept; the others can still complete via save_activity.
 *
 * Fixtures («تجربة», deleted in afterAll): a root section, one session, its
 * lecture (notify_on_publish off — no fan-out), nine throwaway students.
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
const T = Math.floor((ts - 3 * 3600_000) / 1000) * 1000; // live start, whole seconds
const at = (min: number, sec = 0) => new Date(T + min * 60_000 + sec * 1000).toISOString();
const END = at(60);

const NAMES = ['full', 'late', 'early', 'back', 'reco', 'exact70', 'under70', 'endConnected', 'preStart'] as const;
type Name = (typeof NAMES)[number];
const ids = {} as Record<Name, string>;
const identities = {} as Record<Name, string>;
const passwords = {} as Record<Name, string>;
const emails = {} as Record<Name, string>;

let sectionId = '';
let sessionId = '';
let roomName = '';
let lectureId = '';
let admin: SupabaseClient;
let anon: SupabaseClient;
const clients: SupabaseClient[] = [];

function hex(n: number): string {
  let s = '';
  while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
function shareCode(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  clients.push(c);
  return c;
}

/** What the media worker sends for one LiveKit webhook. */
async function ev(
  event: 'participant_joined' | 'participant_left' | 'room_finished',
  who: Name | null,
  sid: string | null,
  joinedAt: string | null,
  eventAt: string,
) {
  const { error } = await service.rpc('live_room_event', {
    p_room_name: roomName,
    p_event: event,
    p_identity: who ? identities[who] : null,
    p_num_participants: null,
    p_participant_sid: sid,
    p_joined_at: joinedAt,
    p_event_at: eventAt,
  });
  if (error) throw error;
}
const join = (who: Name, sid: string, min: number, sec = 0) =>
  ev('participant_joined', who, sid, at(min, sec), at(min, sec));
const leave = (who: Name, sid: string, joinedMin: number, min: number, sec = 0) =>
  ev('participant_left', who, sid, at(joinedMin), at(min, sec));

async function attendance(): Promise<Record<string, Record<string, any>>> {
  const { data, error } = await service.from('live_attendance').select('*').eq('session_id', sessionId);
  if (error) throw error;
  const byUser: Record<string, Record<string, any>> = {};
  for (const r of data ?? []) byUser[r.user_id] = r;
  return byUser;
}
async function progress(who: Name): Promise<Record<string, any> | null> {
  const { data, error } = await service
    .from('user_lecture_progress')
    .select('*')
    .eq('user_id', ids[who])
    .eq('lecture_id', lectureId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const EXPECTED: Record<Name, { sec: number; pct: number; qualified: boolean }> = {
  full: { sec: 3600, pct: 100, qualified: true },
  late: { sec: 2400, pct: 66.67, qualified: false },
  early: { sec: 1800, pct: 50, qualified: false },
  back: { sec: 3000, pct: 83.33, qualified: true },
  reco: { sec: 3000, pct: 83.33, qualified: true },
  exact70: { sec: 2520, pct: 70, qualified: true },
  under70: { sec: 2519, pct: 69.97, qualified: false },
  endConnected: { sec: 2700, pct: 75, qualified: true },
  preStart: { sec: 0, pct: 0, qualified: false },
};

beforeAll(async () => {
  if (!serviceKey) throw new Error('contract tests need SUPABASE_SECRET_KEY in .env.staging.local');
  anon = newClient();
  admin = await signIn('admin@gmail.com', STAFF_PASSWORD);

  const { data: sec, error: sErr } = await service
    .from('sections')
    .insert({ title: `تجربة قسم حضور البث ${ts}`, visibility: 'all' })
    .select('id')
    .single();
  if (sErr || !sec) throw sErr ?? new Error('fixture section not created');
  sectionId = sec.id;

  // An already-'ended' row without ended_at: no D3 slot needed; setting
  // ended_at later fires the end trigger exactly like set_live_session_status.
  roomName = `stg_${hex(12)}`;
  const { data: s, error: lErr } = await service
    .from('live_sessions')
    .insert({
      section_id: sectionId,
      title: `تجربة حضور البث ${ts}`,
      status: 'ended',
      started_at: at(0),
      room_name: roomName,
      share_code: shareCode(),
    })
    .select('id')
    .single();
  if (lErr || !s) throw lErr ?? new Error('fixture session not created');
  sessionId = s.id;

  const { data: lec, error: lecErr } = await service
    .from('lectures')
    .insert({
      title: `تجربة تسجيل حضور البث ${ts}`,
      audio_path: `lectures/تجربة/attendance-${ts}.mp3`,
      duration_sec: 3600,
      order: 1,
      status: 'draft',
      section_id: sectionId,
      source: 'live',
      live_session_id: sessionId,
      review_state: 'needs_title',
      notify_on_publish: false,
    })
    .select('id')
    .single();
  if (lecErr || !lec) throw lecErr ?? new Error('fixture lecture not created');
  lectureId = lec.id;
  // what create_live_lecture does: the session points at its lecture
  const link = await service.from('live_sessions').update({ lecture_id: lectureId }).eq('id', sessionId);
  if (link.error) throw link.error;

  for (const name of NAMES) {
    emails[name] = `tajriba-attend-${name.toLowerCase()}-${ts}@example.com`;
    passwords[name] = `Tajriba-${ts}-pw`;
    const { data, error } = await service.auth.admin.createUser({
      email: emails[name],
      password: passwords[name],
      email_confirm: true,
      user_metadata: { display_name: `تجربة حضور ${name}` },
    });
    if (error || !data.user) throw error ?? new Error('throwaway user not created');
    ids[name] = data.user.id;
    const { data: identity, error: iErr } = await service.rpc('live_identity', {
      p_session: sessionId,
      p_user: ids[name],
    });
    if (iErr) throw iErr;
    identities[name] = identity as string;
    const ins = await service.from('live_participants').insert({
      session_id: sessionId,
      user_id: ids[name],
      identity,
      gender: 'm',
      role: 'listener',
    });
    if (ins.error) throw ins.error;
  }
}, 120_000);

afterAll(async () => {
  if (sectionId) {
    await service.from('lectures').delete().eq('section_id', sectionId);
    if (sessionId) await service.from('live_sessions').delete().eq('id', sessionId);
    await service.from('sections').delete().eq('id', sectionId);
  }
  for (const id of Object.values(ids)) await service.auth.admin.deleteUser(id);
  await Promise.all(clients.map((c) => c.auth.signOut()));
});

describe('threshold', () => {
  test('one configurable place, default 70; out-of-range overrides are ignored', async () => {
    const read = async () => Number((await service.rpc('live_completion_threshold_pct')).data);
    const { data: prev } = await service
      .from('app_config')
      .select('value')
      .eq('key', 'live_attendance_threshold_pct')
      .maybeSingle();
    expect(prev).toBeNull(); // the suite expects the default
    expect(await read()).toBe(70);
    try {
      await service.from('app_config').upsert({ key: 'live_attendance_threshold_pct', value: '80' });
      expect(await read()).toBe(80);
      await service.from('app_config').upsert({ key: 'live_attendance_threshold_pct', value: '0' });
      expect(await read()).toBe(70);
      await service.from('app_config').upsert({ key: 'live_attendance_threshold_pct', value: 'abc' });
      expect(await read()).toBe(70);
    } finally {
      await service.from('app_config').delete().eq('key', 'live_attendance_threshold_pct');
    }
  });
});

describe('attendance from LiveKit connection events', () => {
  test('connections during the live (incl. reconnects and out-of-order webhooks) are recorded', async () => {
    await join('full', 'PA_full1', -5);
    await leave('full', 'PA_full1', -5, 65);

    await join('late', 'PA_late1', 20);
    await leave('late', 'PA_late1', 20, 65);

    // out of order: the left webhook lands before the join
    await leave('early', 'PA_early1', 0, 30);
    await join('early', 'PA_early1', 0);

    await join('back', 'PA_back1', 0);
    await leave('back', 'PA_back1', 0, 20);
    await join('back', 'PA_back2', 30);
    await leave('back', 'PA_back2', 30, 62);

    // reconnect: A's left is lost at first; B's join closes A (one connection per identity)
    await join('reco', 'PA_recoA', 0);
    await join('reco', 'PA_recoB', 10);
    await join('reco', 'PA_recoB', 10); // redelivered webhook
    await leave('reco', 'PA_recoA', 0, 12); // A's late left — must not extend A past B's join
    await leave('reco', 'PA_recoB', 10, 50);

    await join('exact70', 'PA_ex70', 0);
    await leave('exact70', 'PA_ex70', 0, 42);

    await join('under70', 'PA_un70', 0);
    await leave('under70', 'PA_un70', 0, 41, 59);

    await join('endConnected', 'PA_endc', 15);

    await join('preStart', 'PA_pre1', -30);
    await leave('preStart', 'PA_pre1', -30, -5);

    const { data, error } = await service
      .from('live_attendance_intervals')
      .select('conn_sid, user_id, joined_at, left_at')
      .eq('session_id', sessionId);
    expect(error).toBeNull();
    expect(data).toHaveLength(11);
    const recoA = data!.find((r) => r.conn_sid === 'PA_recoA')!;
    expect(new Date(recoA.left_at).toISOString()).toBe(at(10));
    expect(data!.find((r) => r.conn_sid === 'PA_endc')!.left_at).toBeNull();
    // no final share while the session has no ended_at
    expect(Object.keys(await attendance())).toHaveLength(0);
  });

  test('ending the live computes every student: clipped to the live, intervals unioned, 70 % inclusive', async () => {
    const { error } = await service.from('live_sessions').update({ ended_at: END }).eq('id', sessionId);
    expect(error).toBeNull();
    const rows = await attendance();
    for (const name of NAMES) {
      const r = rows[ids[name]];
      expect({ name, sec: r?.attended_sec, pct: Number(r?.attendance_pct), q: r?.qualified }).toEqual({
        name,
        sec: EXPECTED[name].sec,
        pct: EXPECTED[name].pct,
        q: EXPECTED[name].qualified,
      });
      expect(r.live_sec).toBe(3600);
      expect(Number(r.threshold_pct)).toBe(70);
    }
  });

  test('room_finished closes connections still open; the result does not change', async () => {
    await ev('room_finished', null, null, null, at(61));
    const { data } = await service
      .from('live_attendance_intervals')
      .select('left_at')
      .eq('session_id', sessionId)
      .eq('conn_sid', 'PA_endc')
      .single();
    expect(new Date(data!.left_at).toISOString()).toBe(at(61));
    const rows = await attendance();
    expect(rows[ids.endConnected].attended_sec).toBe(2700);
  });

  test('a connection webhook after the end refines only that student', async () => {
    await join('preStart', 'PA_pre2', 55);
    await leave('preStart', 'PA_pre2', 55, 65);
    const rows = await attendance();
    expect(rows[ids.preStart].attended_sec).toBe(300);
    expect(Number(rows[ids.preStart].attendance_pct)).toBe(8.33);
    expect(rows[ids.preStart].qualified).toBe(false);
    expect(rows[ids.full].attended_sec).toBe(3600);
  });
});

describe('live completion ↔ the published recording', () => {
  test('nothing is completed while the lecture is a draft', async () => {
    // prior state: 'full' listened 5 min of the recording (not completed);
    // 'back' already completed it from the recording.
    const pre = await service.from('user_lecture_progress').insert([
      { user_id: ids.full, lecture_id: lectureId, position_sec: 300, completed: false },
      {
        user_id: ids.back,
        lecture_id: lectureId,
        position_sec: 3500,
        completed: true,
        completed_at: at(-60),
      },
    ]);
    expect(pre.error).toBeNull();
    await service.rpc('recompute_live_attendance', { p_session: sessionId });
    expect((await progress('full'))!.completed).toBe(false);
    expect(await progress('exact70')).toBeNull();
  });

  test('publishing the lecture completes it for the qualified students (source live)', async () => {
    const { error } = await service
      .from('lectures')
      .update({ review_state: null, status: 'published' })
      .eq('id', lectureId);
    expect(error).toBeNull();

    for (const name of ['full', 'reco', 'exact70', 'endConnected'] as const) {
      const p = await progress(name);
      expect({ name, completed: p?.completed, source: p?.completion_source }).toEqual({
        name,
        completed: true,
        source: 'live',
      });
      expect(new Date(p!.completed_at).toISOString()).toBe(END);
    }
    expect((await progress('full'))!.position_sec).toBe(300); // resume position untouched

    // already completed from the recording: kept as it was
    const back = await progress('back');
    expect(back!.completion_source).toBeNull();
    expect(new Date(back!.completed_at).toISOString()).toBe(at(-60));

    for (const name of ['late', 'early', 'under70', 'preStart'] as const) {
      expect(await progress(name)).toBeNull();
    }
  });

  test('republishing is idempotent', async () => {
    await service.from('lectures').update({ status: 'draft' }).eq('id', lectureId);
    await service.from('lectures').update({ status: 'published' }).eq('id', lectureId);
    const { count } = await service
      .from('user_lecture_progress')
      .select('*', { count: 'exact', head: true })
      .eq('lecture_id', lectureId)
      .eq('completed', true);
    expect(count).toBe(5); // full, reco, exact70, endConnected (live) + back (recording)
  });

  test('a student below the threshold still completes it from the recording (save_activity)', async () => {
    const early = await signIn(emails.early, passwords.early);
    const { error } = await early.rpc('save_activity', {
      p_lecture_id: lectureId,
      p_position_sec: 3500,
      p_duration_sec: 3600,
      p_delta_sec: 5,
      p_completed: true,
    });
    expect(error).toBeNull();
    const p = await progress('early');
    expect(p!.completed).toBe(true);
    expect(p!.completion_source).toBeNull();
    // and a live-completed student's row is never un-completed by a later save
    const full = await signIn(emails.full, passwords.full);
    await full.rpc('save_activity', {
      p_lecture_id: lectureId,
      p_position_sec: 10,
      p_duration_sec: 3600,
      p_delta_sec: 5,
      p_completed: false,
    });
    const f = await progress('full');
    expect(f!.completed).toBe(true);
    expect(f!.completion_source).toBe('live');
  });
});

describe('access', () => {
  test('students and anon cannot read attendance or run the service functions', async () => {
    const student = await signIn(emails.late, passwords.late);
    for (const c of [student, anon]) {
      const t1 = await c.from('live_attendance').select('*').eq('session_id', sessionId);
      expect(t1.data ?? []).toHaveLength(0);
      const t2 = await c.from('live_attendance_intervals').select('*').eq('session_id', sessionId);
      expect(t2.data ?? []).toHaveLength(0);
      for (const [fn, args] of [
        ['get_live_attendance', { p_session: sessionId }],
        ['recompute_live_attendance', { p_session: sessionId }],
        ['apply_live_completions', { p_session: sessionId }],
        ['live_completion_threshold_pct', {}],
      ] as const) {
        const { error } = await c.rpc(fn, args);
        expect({ fn, denied: error !== null }).toEqual({ fn, denied: true });
      }
    }
  });

  test('staff read every student with share, threshold and connection count', async () => {
    const { data, error } = await admin.rpc('get_live_attendance', { p_session: sessionId });
    expect(error).toBeNull();
    expect(data).toHaveLength(9);
    const reco = (data as any[]).find((r) => r.user_id === ids.reco);
    expect(reco).toMatchObject({ attended_sec: 3000, qualified: true, connections: 2 });
    expect(reco.display_name).toBe('تجربة حضور reco');
  });
});
