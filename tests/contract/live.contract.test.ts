/**
 * Contract tests for migrations 0134–0139 (V23 P2 — «البث المباشر» backend),
 * against the live STAGING project.
 *
 * Pins what the live-token / live-control edge functions, the media worker and
 * the apps are coded against:
 *   - create_live_session / cancel_live_session: staff only; D3 one green|live.
 *   - read model: base table staff-only; live_sessions_public + get_live_now for
 *     students/guests; get_live_by_code for anon; participants/log/config closed.
 *   - service-role only: set_live_session_status, live_room_event,
 *     enqueue_live_recording, live_job_naming, create_live_lecture,
 *     live_raws_due_for_deletion, mark_live_raw_deleted, live_identity.
 *   - D2 (changed): real names always stored; get_live_participants shows them to
 *     staff only (hidden sisters included).
 *   - live_room_event keeps presence / spoke_seconds / peak and answers the D4
 *     host_present question; room_finished is the end safety net.
 *   - recording: deferred while live, queued on end, one job per session,
 *     create_live_lecture → needs_title draft; publish guard; finalize.
 *   - owner rule (amended 2026-09-28, 0139): the local raw is due for deletion
 *     as soon as the lecture exists and its R2 backup is recorded (publish state
 *     irrelevant); no backup ⇒ never due; a failed job keeps the raw and staff
 *     can retry.
 *   - V23 P4 (0141 + the live-control edge function — needs it DEPLOYED to
 *     staging): live_participants.hand_at exists (service role only); guests
 *     listen only (owner 2026-09-28) — a guest raising a hand is 403
 *     guest_cannot_speak; a student may not moderate (approve → 403 forbidden);
 *     a hand needs a joined participant (409 not_present).
 *
 * Fixtures (all «تجربة», all deleted in afterAll): one root section, the live
 * sessions in it, their lectures / jobs / participants, the staff notices those
 * create, a guest and two throwaway students (brother + sister). No lecture is
 * published with notify_on_publish on, so no fan-out ever runs.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const STAFF_PASSWORD = '12345678';
const PARKED = '2100-01-01T00:00:00Z';
const OLDEST = '2000-01-01T00:00:00Z';
const D3_MSG = 'يوجد بث مباشر قائم الآن';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const service: SupabaseClient = createClient(url, serviceKey, opts);

const ts = Date.now();
const userIds: string[] = [];
const sessionIds: string[] = [];
const jobIds: string[] = [];
let sectionId = '';
let scheduledSess = ''; // publisher, scheduled
let greenSess = ''; // admin, green → live → recording

let anon: SupabaseClient;
let guest: SupabaseClient;
let student: SupabaseClient;
let sister: SupabaseClient;
let admin: SupabaseClient;
let publisher: SupabaseClient;
let sheikh: SupabaseClient;
let studentId = '';
let sisterId = '';
let adminId = '';

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

/** Throwaway «تجربة» student (staging has no student login with a known password). */
async function throwaway(label: string, gender: 'male' | 'female'): Promise<[SupabaseClient, string]> {
  const email = `tajriba-live-${label}-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const name = `تجربة ${gender === 'female' ? 'أخت' : 'أخ'} البث ${ts}`;
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

async function sessionRow(id: string): Promise<Record<string, any>> {
  const { data, error } = await service.from('live_sessions').select('*').eq('id', id).single();
  if (error || !data) throw error ?? new Error('session not found');
  return data;
}

async function jobRow(id: string): Promise<Record<string, any>> {
  const { data, error } = await service.from('media_jobs').select('*').eq('id', id).single();
  if (error || !data) throw error ?? new Error('job not found');
  return data;
}

async function park(jobId: string) {
  const { error } = await service.from('media_jobs').update({ not_before: PARKED }).eq('id', jobId);
  if (error) throw error;
}

/** Never steal someone else's claimable job (a staging worker may be running). */
async function claimMine(jobId: string): Promise<Record<string, any>> {
  const stale = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: claimable, error } = await service
    .from('media_jobs')
    .select('id')
    .eq('kind', 'live_recording')
    .or(
      `and(status.eq.queued,not_before.lte."${new Date().toISOString()}"),` +
        `and(status.eq.running,heartbeat_at.lt."${stale}")`,
    );
  if (error) throw error;
  const foreign = (claimable ?? []).filter((r) => r.id !== jobId && !jobIds.includes(r.id));
  if (foreign.length) throw new Error(`${foreign.length} foreign claimable live_recording job(s) — rerun later`);
  // Un-park → claim back to back (smallest window for a polling staging worker).
  const up = await service
    .from('media_jobs')
    .update({ created_at: OLDEST, not_before: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', jobId);
  if (up.error) throw up.error;
  const res = await service.rpc('claim_media_job', { p_kinds: ['live_recording'] });
  expect(res.error).toBeNull();
  if ((res.data as any[])[0]?.id !== jobId) {
    throw new Error(
      "a staging media worker claimed this suite's job between un-park and claim (it polls claim_media_job) — stop the staging worker or rerun" + ` (job ${jobId} is now ${(await jobRow(jobId)).status})`,
    );
  }
  return (res.data as any[])[0];
}

/** POST a staging edge function as this client's user → HTTP status + JSON body. */
async function callFunction(
  c: SupabaseClient,
  fn: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, any> | null }> {
  const { data } = await c.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(`${fn}: the client has no session`);
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function addParticipant(sessionId: string, userId: string, gender: 'm' | 'f', role: string, hidden = false) {
  const { data: identity, error } = await service.rpc('live_identity', { p_session: sessionId, p_user: userId });
  if (error) throw error;
  const ins = await service.from('live_participants').upsert(
    {
      session_id: sessionId,
      user_id: userId,
      identity,
      gender,
      hidden_name: hidden,
      // What an edge function might send for a hidden sister — D2 must still
      // store her real name.
      display_name: hidden ? 'طالبة' : 'اسم ظاهر',
      role,
      left_at: null,
    },
    { onConflict: 'session_id,user_id' },
  );
  if (ins.error) throw ins.error;
  return identity as string;
}

beforeAll(async () => {
  if (!serviceKey) throw new Error('live contract tests need SUPABASE_SECRET_KEY in .env.staging.local');

  // D3: the suite needs the single green/live slot.
  const { data: active, error: aErr } = await service
    .from('live_sessions')
    .select('id')
    .in('status', ['green', 'live']);
  if (aErr) throw aErr;
  if (active!.length) throw new Error('a staging live session is green/live — rerun when it has ended');

  anon = newClient();
  guest = newClient();
  const g = await guest.auth.signInAnonymously();
  if (g.error) throw g.error;
  userIds.push(g.data.user!.id);
  [student, studentId] = await throwaway('brother', 'male');
  [sister, sisterId] = await throwaway('sister', 'female');
  admin = await signIn('admin@gmail.com', STAFF_PASSWORD);
  publisher = await signIn('publisher@gmail.com', STAFF_PASSWORD);
  sheikh = await signIn('sheikh@gmail.com', STAFF_PASSWORD);
  adminId = (await admin.auth.getUser()).data.user!.id;

  const { data: sec, error: sErr } = await service
    .from('sections')
    .insert({ title: `تجربة قسم البث ${ts}`, visibility: 'all' })
    .select('id')
    .single();
  if (sErr || !sec) throw sErr ?? new Error('fixture section not created');
  sectionId = sec.id;
});

afterAll(async () => {
  if (sessionIds.length) {
    const { data: jobs } = await service.from('media_jobs').select('id').in('live_session_id', sessionIds);
    for (const j of jobs ?? []) if (!jobIds.includes(j.id)) jobIds.push(j.id);
    for (const id of sessionIds) await service.from('notifications').delete().eq('data->>liveSessionId', id);
  }
  for (const id of jobIds) await service.from('notifications').delete().eq('data->>mediaJobId', id);
  if (jobIds.length) await service.from('media_jobs').delete().in('id', jobIds);
  if (sectionId) {
    await service.from('lectures').delete().eq('section_id', sectionId);
    if (sessionIds.length) await service.from('live_sessions').delete().in('id', sessionIds);
    await service.from('sections').delete().eq('id', sectionId);
  }
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await Promise.all(
    [guest, student, sister, admin, publisher, sheikh].filter(Boolean).map((c) => c.auth.signOut()),
  );
});

const future = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

// ---------------------------------------------------------------------------------
describe('create / cancel — staff only, D3', () => {
  test('students, guests and anon cannot create a session', async () => {
    for (const c of [student, guest, anon]) {
      const { data, error } = await c.rpc('create_live_session', {
        p_section: sectionId,
        p_title: 'تجربة مجلس ممنوع',
      });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
    const denied = await student.rpc('create_live_session', { p_section: sectionId, p_title: 'تجربة مجلس' });
    expect(denied.error!.message).toContain('غير مصرح');
  });

  test('a sheikh schedules and cancels his own session', async () => {
    const { data, error } = await sheikh.rpc('create_live_session', {
      p_section: sectionId,
      p_title: 'تجربة مجلس الشيخ',
      p_scheduled_at: future(120),
    });
    expect(error).toBeNull();
    sessionIds.push(data as string);
    expect((await sessionRow(data as string)).status).toBe('scheduled');
    const c = await sheikh.rpc('cancel_live_session', { p_session: data });
    expect(c.error).toBeNull();
    expect((await sessionRow(data as string)).status).toBe('cancelled');
  });

  test('a publisher schedules; a past time is refused', async () => {
    const past = await publisher.rpc('create_live_session', {
      p_section: sectionId,
      p_title: 'تجربة مجلس ماضٍ',
      p_scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.error!.message).toContain('في المستقبل');

    const { data, error } = await publisher.rpc('create_live_session', {
      p_section: sectionId,
      p_title: 'تجربة مجلس مجدول',
      p_scheduled_at: future(90),
    });
    expect(error).toBeNull();
    sessionIds.push(data as string);
    scheduledSess = data as string;
    const row = await sessionRow(data as string);
    expect(row.status).toBe('scheduled');
    expect(row.share_code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(row.room_name).toMatch(/^(stg|prd)_[0-9a-f]{12}$/);
  });

  test('an admin opens a green room; a second one is refused (D3)', async () => {
    const { data, error } = await admin.rpc('create_live_session', {
      p_section: sectionId,
      p_title: 'تجربة مجلس مباشر',
    });
    expect(error).toBeNull();
    sessionIds.push(data as string);
    greenSess = data as string;
    const row = await sessionRow(data as string);
    expect(row.status).toBe('green');
    expect(row.host_user_id).toBe(adminId);

    const second = await publisher.rpc('create_live_session', { p_section: sectionId, p_title: 'تجربة ثانية' });
    expect(second.error!.message).toContain(D3_MSG);
  });
});

// ---------------------------------------------------------------------------------
describe('read model + RLS', () => {
  test('the base table is staff-only; participants / log / config are closed', async () => {
    const own = await student.from('live_sessions').select('id').in('id', sessionIds);
    expect(own.error).toBeNull();
    expect(own.data).toEqual([]);

    const staff = await admin.from('live_sessions').select('id, raw_path').in('id', sessionIds);
    expect(staff.error).toBeNull();
    expect(staff.data!.length).toBe(sessionIds.length);

    for (const c of [student, guest, admin]) {
      for (const t of ['live_participants', 'live_moderation_log', 'live_config']) {
        const r = await c.from(t).select('*').limit(1);
        expect(r.error).not.toBeNull();
      }
    }
    const view = await anon.from('live_sessions_public').select('id').limit(1);
    expect(view.error).not.toBeNull();
  });

  test('students see public statuses only, with safe columns', async () => {
    const [scheduled, green] = [scheduledSess, greenSess];
    const { data, error } = await student.from('live_sessions_public').select('*').in('id', sessionIds);
    expect(error).toBeNull();
    const ids = data!.map((r) => r.id);
    expect(ids).toContain(scheduled);
    expect(ids).not.toContain(green); // green is staff-only
    expect(data![0]).not.toHaveProperty('raw_path');
    expect(data![0]).not.toHaveProperty('host_user_id');
    expect(data![0]).not.toHaveProperty('egress_id');
  });

  test('get_live_now: upcoming for a guest; the green room only for staff', async () => {
    const scheduled = scheduledSess;
    const g = await guest.rpc('get_live_now');
    expect(g.error).toBeNull();
    const now = g.data as any;
    expect(now.upcoming.map((u: any) => u.id)).toContain(scheduled);
    expect(now.upcoming.find((u: any) => u.id === scheduled).reminded).toBe(false);
    expect(now.green).toBeNull();

    const a = await admin.rpc('get_live_now');
    expect((a.data as any).green?.id).toBe(greenSess);

    const anonCall = await anon.rpc('get_live_now');
    expect(anonCall.error).not.toBeNull();
  });

  test('get_live_by_code works with the bare anon key', async () => {
    const row = await sessionRow(scheduledSess);
    const { data, error } = await anon.rpc('get_live_by_code', { p_code: row.share_code.toLowerCase() });
    expect(error).toBeNull();
    expect(data).toMatchObject({ restricted: false, status: 'scheduled', title: 'تجربة مجلس مجدول' });
    expect((await anon.rpc('get_live_by_code', { p_code: '0OIL11' })).data).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
describe('service-role only RPCs', () => {
  const dummy = '00000000-0000-0000-0000-000000000000';
  const calls: [string, Record<string, unknown>][] = [
    ['set_live_session_status', { p_session: dummy, p_status: 'live' }],
    ['live_room_event', { p_room_name: 'stg_x', p_event: 'room_started' }],
    ['enqueue_live_recording', { p_room_name: 'stg_x', p_egress_id: 'EG', p_raw_path: '/recordings/stg/x.ogg' }],
    ['live_job_naming', { p_job: dummy }],
    [
      'create_live_lecture',
      { p_job: dummy, p_output_key: 'x', p_duration_sec: 1, p_size_bytes: 1, p_raw_backup_key: null },
    ],
    ['live_raws_due_for_deletion', {}],
    ['mark_live_raw_deleted', { p_session: dummy }],
    ['live_identity', { p_session: dummy, p_user: dummy }],
  ];
  test.each(calls)('%s is refused for anon, student and admin', async (fn, args) => {
    for (const c of [anon, student, admin]) {
      const { data, error } = await c.rpc(fn, args);
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------
// V23 P4 — needs 0141 applied and the P4 live-control deployed to staging.
describe('P4 speaking & moderation: server-side refusals (live-control)', () => {
  const someIdentity = '0123456789abcdef';

  test('0141: live_participants.hand_at exists and stays service-role only', async () => {
    const svc = await service.from('live_participants').select('hand_at').limit(1);
    expect(svc.error).toBeNull();
    for (const c of [student, guest]) {
      const r = await c.from('live_participants').select('hand_at').limit(1);
      expect(r.error).not.toBeNull();
    }
  });

  test('guests listen only (owner 2026-09-28): a guest raising a hand → 403 guest_cannot_speak', async () => {
    const r = await callFunction(guest, 'live-control', { action: 'hand', sessionId: scheduledSess, up: true });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: 'guest_cannot_speak' });
  });

  test('a student cannot moderate: approve → 403 forbidden (guests too)', async () => {
    for (const c of [student, guest]) {
      const r = await callFunction(c, 'live-control', {
        action: 'approve',
        sessionId: scheduledSess,
        identity: someIdentity,
      });
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ error: 'forbidden' });
    }
  });

  test('a hand needs a joined participant; `up` is required', async () => {
    // The student never called live-token for this session → no live_participants row.
    const r = await callFunction(student, 'live-control', { action: 'hand', sessionId: scheduledSess, up: true });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'not_present' });

    const bad = await callFunction(student, 'live-control', { action: 'hand', sessionId: scheduledSess });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'bad_request' });
  });
});

// ---------------------------------------------------------------------------------
describe('live: room events, D4 answer, D2 names', () => {
  let sess = '';
  let room = '';
  let hostIdent = '';
  let sisterIdent = '';

  beforeAll(async () => {
    sess = greenSess;
    room = (await sessionRow(sess)).room_name;
  });

  test('green → live (service) records the egress', async () => {
    const { data, error } = await service.rpc('set_live_session_status', {
      p_session: sess,
      p_status: 'live',
      p_egress_id: 'EG_tajriba',
    });
    expect(error).toBeNull();
    expect((data as any).status).toBe('live');
    expect((data as any).egress_id).toBe('EG_tajriba');
    const bad = await service.rpc('set_live_session_status', { p_session: sess, p_status: 'green' });
    expect(bad.error!.message).toContain('invalid live transition');
  });

  test('participants: presence, host_present, spoke_seconds, peak', async () => {
    hostIdent = await addParticipant(sess, adminId, 'm', 'host');
    sisterIdent = await addParticipant(sess, sisterId, 'f', 'listener', true);
    await addParticipant(sess, studentId, 'm', 'listener');

    const j1 = await service.rpc('live_room_event', {
      p_room_name: room,
      p_event: 'participant_joined',
      p_identity: hostIdent,
      p_num_participants: 3,
    });
    expect(j1.error).toBeNull();
    expect(j1.data).toEqual({ session_id: sess, status: 'live', is_host: true, host_present: true });

    await service.rpc('live_room_event', { p_room_name: room, p_event: 'participant_joined', p_identity: sisterIdent });
    const pub = await service.rpc('live_room_event', { p_room_name: room, p_event: 'track_published', p_identity: sisterIdent });
    expect((pub.data as any).is_host).toBe(false);
    await new Promise((r) => setTimeout(r, 1600));
    await service.rpc('live_room_event', { p_room_name: room, p_event: 'track_unpublished', p_identity: sisterIdent });

    const left = await service.rpc('live_room_event', {
      p_room_name: room,
      p_event: 'participant_left',
      p_identity: hostIdent,
      p_num_participants: 2,
    });
    expect(left.data).toMatchObject({ is_host: true, host_present: false });

    const { data: rows } = await service
      .from('live_participants')
      .select('identity, present, left_at, spoke_seconds')
      .eq('session_id', sess);
    const host = rows!.find((r) => r.identity === hostIdent)!;
    const sis = rows!.find((r) => r.identity === sisterIdent)!;
    expect(host.present).toBe(false);
    expect(host.left_at).toBeTruthy();
    expect(sis.present).toBe(true);
    expect(sis.spoke_seconds).toBeGreaterThanOrEqual(1);
    expect((await sessionRow(sess)).peak_listeners).toBe(3);

    const unknownRoom = await service.rpc('live_room_event', { p_room_name: 'stg_000000000000', p_event: 'room_started' });
    expect(unknownRoom.error).toBeNull();
    expect(unknownRoom.data).toBeNull();
    const badEvent = await service.rpc('live_room_event', { p_room_name: room, p_event: 'track_muted' });
    expect(badEvent.error).not.toBeNull();
  });

  test('D2: staff see every real name (hidden sister included); others are refused', async () => {
    const realSister = `تجربة أخت البث ${ts}`;
    for (const c of [admin, sheikh, publisher]) {
      const { data, error } = await c.rpc('get_live_participants', { p_session: sess });
      expect(error).toBeNull();
      const sis = (data as any[]).find((r) => r.identity === sisterIdent);
      expect(sis).toMatchObject({ display_name: realSister, hidden_name: true, gender: 'f', role: 'listener' });
      expect(Object.keys(sis).sort()).toEqual(
        ['display_name', 'gender', 'hidden_name', 'identity', 'joined_at', 'left_at', 'role', 'spoke_seconds'].sort(),
      );
    }
    for (const c of [student, sister, guest, anon]) {
      const { data, error } = await c.rpc('get_live_participants', { p_session: sess });
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  test('live sessions show up for students while live', async () => {
    const now = await student.rpc('get_live_now');
    expect((now.data as any).live?.id).toBe(sess);
  });
});

// ---------------------------------------------------------------------------------
describe('recording → lecture (worker contract)', () => {
  let sess = '';
  let room = '';
  let rawPath = '';
  let job = '';
  let lecture = '';

  beforeAll(async () => {
    sess = greenSess;
    room = (await sessionRow(sess)).room_name;
    rawPath = `/recordings/${room.slice(0, 3)}/${room}-tajriba.ogg`;
  });

  test('egress file while live is deferred; a wrong-env path is refused', async () => {
    const wrong = await service.rpc('enqueue_live_recording', {
      p_room_name: room,
      p_egress_id: 'EG_tajriba',
      p_raw_path: `/recordings/xxx/${room}.ogg`,
    });
    expect(wrong.error!.message).toContain('invalid raw path');

    const r = await service.rpc('enqueue_live_recording', {
      p_room_name: room,
      p_egress_id: 'EG_tajriba',
      p_raw_path: rawPath,
    });
    expect(r.error).toBeNull();
    expect(r.data).toBeNull();
    const row = await sessionRow(sess);
    expect(row.status).toBe('live');
    expect(row.raw_path).toBe(rawPath);
  });

  test('room_finished (end safety net) → processing with one job on the raw path', async () => {
    const fin = await service.rpc('live_room_event', { p_room_name: room, p_event: 'room_finished' });
    expect(fin.error).toBeNull();
    expect((fin.data as any).status).toBe('processing');
    const { data: jobs } = await service.from('media_jobs').select('*').eq('live_session_id', sess);
    expect(jobs!.length).toBe(1);
    job = jobs![0].id;
    jobIds.push(job);
    await park(job);
    expect(jobs![0].kind).toBe('live_recording');
    expect(jobs![0].input_key).toBe(rawPath);

    const again = await service.rpc('enqueue_live_recording', {
      p_room_name: room,
      p_egress_id: 'EG_tajriba',
      p_raw_path: rawPath,
    });
    expect(again.data).toBe(job);

    const naming = await service.rpc('live_job_naming', { p_job: job });
    expect(naming.error).toBeNull();
    expect(naming.data).toEqual([{ section_title: `تجربة قسم البث ${ts}`, title: 'تجربة مجلس مباشر', room_name: room }]);
  });

  test('create_live_lecture → needs_title draft in the session section; session ready', async () => {
    await claimMine(job);
    const backup = `live-raw/${room}-tajriba.ogg`;
    const { data, error } = await service.rpc('create_live_lecture', {
      p_job: job,
      p_output_key: `lectures/tajriba-live-${ts}.mp3`,
      p_duration_sec: 3600,
      p_size_bytes: 123456,
      p_raw_backup_key: backup,
    });
    expect(error).toBeNull();
    lecture = data as string;

    const { data: lec } = await service
      .from('lectures')
      .select('status, review_state, source, section_id, live_session_id, order, title, audio_path')
      .eq('id', lecture)
      .single();
    expect(lec).toEqual({
      status: 'draft',
      review_state: 'needs_title',
      source: 'live',
      section_id: sectionId,
      live_session_id: sess,
      order: 1,
      title: 'تجربة مجلس مباشر',
      audio_path: `lectures/tajriba-live-${ts}.mp3`,
    });
    const row = await sessionRow(sess);
    expect(row).toMatchObject({ status: 'ready', lecture_id: lecture, raw_backup_key: backup, raw_path: rawPath });
    expect((await jobRow(job)).status).toBe('done');

    // The staff «ready for review» notice. Since 0142 the session's student
    // notifications (live_start / live_reminder) carry the same liveSessionId.
    const notes = await service
      .from('notifications')
      .select('type, title')
      .eq('data->>liveSessionId', sess)
      .eq('type', 'content_reported');
    expect(notes.data!.length).toBeGreaterThan(0);
    expect(notes.data!.every((n) => n.title === 'تسجيل المجلس جاهز للمراجعة')).toBe(true);

    const dup = await service.rpc('create_live_lecture', {
      p_job: job,
      p_output_key: `lectures/tajriba-live-${ts}.mp3`,
      p_duration_sec: 3600,
      p_size_bytes: 123456,
      p_raw_backup_key: backup,
    });
    expect(dup.data).toBe(lecture);
  });

  test('needs_title blocks publishing; finalize is content-manager only', async () => {
    // Never fan out to staging students from a test.
    await service.from('lectures').update({ notify_on_publish: false }).eq('id', lecture);

    const blocked = await admin.from('lectures').update({ status: 'published' }).eq('id', lecture);
    expect(blocked.error!.message).toContain('أكمِل العنوان النهائي والشيخ قبل النشر');

    const { data: sh } = await service.from('sheikhs').select('id').limit(1).single();
    const denied = await student.rpc('finalize_live_lecture', {
      p_lecture: lecture,
      p_title: 'تجربة العنوان النهائي',
      p_sheikh: sh!.id,
    });
    expect(denied.error).not.toBeNull();
    const ok = await publisher.rpc('finalize_live_lecture', {
      p_lecture: lecture,
      p_title: 'تجربة العنوان النهائي',
      p_sheikh: sh!.id,
    });
    expect(ok.error).toBeNull();
    const pub = await admin.from('lectures').update({ status: 'published' }).eq('id', lecture);
    expect(pub.error).toBeNull();
  });

  test('owner rule (0139): a ready session with an R2 backup is due at once; no backup ⇒ not due', async () => {
    const backup = `live-raw/${room}-tajriba.ogg`;
    const dueRow = async () =>
      ((await service.rpc('live_raws_due_for_deletion')).data as any[]).find((r) => r.session_id === sess);

    // Published right now (previous test) — due immediately, no 7-day wait.
    expect((await sessionRow(sess)).lecture_published_at).toBeTruthy();
    expect(await dueRow()).toEqual({ session_id: sess, raw_path: rawPath, raw_backup_key: backup });

    // Publish state is irrelevant: still due as a draft (the publish clock is
    // still tracked by 0137 and cleared on unpublish).
    await admin.from('lectures').update({ status: 'draft' }).eq('id', lecture);
    expect((await sessionRow(sess)).lecture_published_at).toBeNull();
    expect(await dueRow()).toBeTruthy();

    // No R2 backup ⇒ not due (and it may not be marked deleted).
    await service.from('live_sessions').update({ raw_backup_key: null }).eq('id', sess);
    expect(await dueRow()).toBeUndefined();
    const refused = await service.rpc('mark_live_raw_deleted', { p_session: sess });
    expect(refused.error).not.toBeNull();
    await service.from('live_sessions').update({ raw_backup_key: backup }).eq('id', sess);

    // The worker deleted the local raw → marked → no longer due; the R2 key stays.
    const mark = await service.rpc('mark_live_raw_deleted', { p_session: sess });
    expect(mark.error).toBeNull();
    const row = await sessionRow(sess);
    expect(row.raw_deleted_at).toBeTruthy();
    expect(row.raw_backup_key).toBe(backup);
    expect(await dueRow()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------
describe('failed recording: raw kept, staff retry', () => {
  let sess = '';
  let job = '';

  test('end → egress file → job; third failure marks the session failed', async () => {
    const { data, error } = await admin.rpc('create_live_session', {
      p_section: sectionId,
      p_title: 'تجربة مجلس يتعذّر',
      p_notify: false,
    });
    expect(error).toBeNull();
    sess = data as string;
    sessionIds.push(sess);
    await service.rpc('set_live_session_status', { p_session: sess, p_status: 'live', p_egress_id: 'EG2' });
    await service.rpc('set_live_session_status', { p_session: sess, p_status: 'ended' });
    const room = (await sessionRow(sess)).room_name as string;

    const { data: jid, error: jErr } = await service.rpc('enqueue_live_recording', {
      p_room_name: room,
      p_egress_id: 'EG2',
      p_raw_path: `/recordings/${room.slice(0, 3)}/${room}-tajriba.ogg`,
    });
    expect(jErr).toBeNull();
    job = jid as string;
    jobIds.push(job);
    await park(job);
    expect((await sessionRow(sess)).status).toBe('processing');

    await service.from('media_jobs').update({ attempts: 2 }).eq('id', job);
    await claimMine(job);
    const f = await service.rpc('fail_media_job', { p_job: job, p_error: 'تجربة: ffmpeg' });
    expect(f.data).toBe('failed');
    const row = await sessionRow(sess);
    expect(row.status).toBe('failed');
    expect(row.raw_path).toContain(room);
    expect(row.raw_deleted_at).toBeNull();

    // No lecture, no backup → never listed for deletion, and may not be marked.
    const due = (await service.rpc('live_raws_due_for_deletion')).data as any[];
    expect(due.some((r) => r.session_id === sess)).toBe(false);
    const mark = await service.rpc('mark_live_raw_deleted', { p_session: sess });
    expect(mark.error).not.toBeNull();
  });

  test('retry_live_recording: content managers only, once at a time', async () => {
    const denied = await student.rpc('retry_live_recording', { p_session: sess });
    expect(denied.error).not.toBeNull();
    const sheikhDenied = await sheikh.rpc('retry_live_recording', { p_session: sess });
    expect(sheikhDenied.error).not.toBeNull();

    const { data, error } = await publisher.rpc('retry_live_recording', { p_session: sess });
    expect(error).toBeNull();
    jobIds.push(data as string);
    await park(data as string);
    const newJob = await jobRow(data as string);
    expect(newJob).toMatchObject({ status: 'queued', kind: 'live_recording', live_session_id: sess });
    expect(newJob.input_key).toBe((await sessionRow(sess)).raw_path);
    expect((await sessionRow(sess)).status).toBe('processing');

    const again = await publisher.rpc('retry_live_recording', { p_session: sess });
    expect(again.error!.message).toContain('تجري معالجة التسجيل الآن');
  });
});
