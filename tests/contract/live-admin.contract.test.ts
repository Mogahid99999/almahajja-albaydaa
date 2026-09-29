/**
 * Contract tests for migration 0143 (V23 P6 — the staff «البث المباشر» screen and
 * the live items of «المحاضرات الواردة»), against the live STAGING project.
 *
 * Pins what app/admin/live.tsx, app/admin/unclassified.tsx and src/api/liveAdmin.ts
 * are coded against:
 *   - admin_live_overview: content managers + sheikhs; a sheikh sees only his own
 *     scheduled / ended sessions; no raw paths / room names / egress ids leak;
 *     the recording job (status, progress) rides along.
 *   - admin_live_inbox: content managers only; needs_title drafts with a sheikh
 *     suggestion; recordings still being compressed as `pending`.
 *   - get_live_interventions: staff only; real names (D2) incl. a hidden sister;
 *     stints from live_moderation_log approve → demote/step_down as offsets from
 *     started_at; the host is not an «intervention».
 *   - admin_save_live_lecture: content managers only; the two required fields;
 *     «حفظ دون نشر» keeps a draft; «نشر بدون إشعار» publishes quietly; «تغيير»
 *     the section re-orders to the end of the new one; only live lectures.
 *
 * Fixtures (all «تجربة», all deleted in afterAll): two root sections, sessions
 * inserted with the service key (no green/live — the D3 slot is never taken),
 * their draft lectures / jobs / participants / log rows, two throwaway students.
 * Nothing is published with notify_on_publish on, so no fan-out ever runs.
 *
 * Needs 0143 applied to staging. Run: npm run test:contract (not part of CI).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const STAFF_PASSWORD = '12345678';
const DENIED = 'غير مصرح';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const service: SupabaseClient = createClient(url, serviceKey, opts);

const ts = Date.now();
const userIds: string[] = [];
const sessionIds: string[] = [];
const jobIds: string[] = [];
const sectionIds: string[] = [];
let sectionA = '';
let sectionB = '';
let sheikhRowId = '';
let roomPrefix = 'stg_';

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

// fixture ids
let readySess = ''; // ready, lecture needs_title (draft A)
let readySess2 = ''; // ready, lecture needs_title (draft B)
let processingSess = '';
let lectureA = '';
let lectureB = '';
let sheikhScheduled = '';
let publisherScheduled = '';

const STARTED = '2026-09-29T17:00:00Z';
const at = (sec: number) => new Date(Date.parse(STARTED) + sec * 1000).toISOString();

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

async function throwaway(label: string, gender: 'male' | 'female'): Promise<[SupabaseClient, string]> {
  const email = `tajriba-liveadmin-${label}-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const name = `تجربة ${gender === 'female' ? 'أخت' : 'أخ'} المداخلات ${ts}`;
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

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const shareCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const hex12 = () => Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** A live_sessions row straight from the service key (bypasses the lifecycle RPCs). */
async function insertSession(row: Record<string, unknown>): Promise<string> {
  const { data, error } = await service
    .from('live_sessions')
    .insert({
      room_name: roomPrefix + hex12(),
      share_code: shareCode(),
      ...row,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('session not inserted');
  sessionIds.push(data.id);
  return data.id;
}

/** The draft a finished live_recording job leaves behind (create_live_lecture, 0138). */
async function insertLiveDraft(sessionId: string, section: string, title: string, order: number): Promise<string> {
  const { data, error } = await service
    .from('lectures')
    .insert({
      title,
      audio_path: `lectures/تجربة/${title}.mp3`,
      duration_sec: 3252,
      order,
      status: 'draft',
      section_id: section,
      sheikh_id: null,
      source: 'live',
      live_session_id: sessionId,
      review_state: 'needs_title',
      notify_on_publish: false,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('lecture not inserted');
  const upd = await service.from('live_sessions').update({ lecture_id: data.id }).eq('id', sessionId);
  if (upd.error) throw upd.error;
  return data.id;
}

async function addParticipant(sessionId: string, userId: string, gender: 'm' | 'f', role: string, extra: Record<string, unknown> = {}) {
  const { data: identity, error } = await service.rpc('live_identity', { p_session: sessionId, p_user: userId });
  if (error) throw error;
  const ins = await service.from('live_participants').upsert(
    { session_id: sessionId, user_id: userId, identity, gender, role, display_name: 'اسم ظاهر', ...extra },
    { onConflict: 'session_id,user_id' },
  );
  if (ins.error) throw ins.error;
  return identity as string;
}

async function lectureRow(id: string): Promise<Record<string, any>> {
  const { data, error } = await service.from('lectures').select('*').eq('id', id).single();
  if (error || !data) throw error ?? new Error('lecture not found');
  return data;
}

beforeAll(async () => {
  if (!serviceKey) throw new Error('live-admin contract tests need SUPABASE_SECRET_KEY in .env.staging.local');

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

  const cfg = await service.from('live_config').select('room_prefix').single();
  if (cfg.data?.room_prefix) roomPrefix = cfg.data.room_prefix;

  for (const t of ['أ', 'ب']) {
    const { data, error } = await service
      .from('sections')
      .insert({ title: `تجربة قسم الواردة ${t} ${ts}`, visibility: 'all' })
      .select('id')
      .single();
    if (error || !data) throw error ?? new Error('fixture section not created');
    sectionIds.push(data.id);
  }
  [sectionA, sectionB] = sectionIds;

  const { data: sh } = await service.from('sheikhs').select('id').limit(1).single();
  sheikhRowId = sh!.id;

  // Section B already holds lectures 1..3 → a moved lecture must land at 4.
  for (let i = 1; i <= 3; i++) {
    const r = await service
      .from('lectures')
      .insert({ title: `تجربة درس ${i}`, order: i, status: 'draft', section_id: sectionB, sheikh_id: sheikhRowId });
    if (r.error) throw r.error;
  }

  readySess = await insertSession({
    section_id: sectionA,
    sheikh_id: sheikhRowId,
    title: 'تجربة مجلس جاهز',
    status: 'ready',
    host_user_id: adminId,
    started_at: STARTED,
    ended_at: at(3600),
    raw_path: `/recordings/${roomPrefix.slice(0, 3)}/tajriba-${ts}.ogg`,
    raw_backup_key: `live-raw/tajriba-${ts}.ogg`,
    peak_listeners: 42,
  });
  lectureA = await insertLiveDraft(readySess, sectionA, 'تجربة مجلس جاهز', 1);

  readySess2 = await insertSession({
    section_id: sectionA,
    sheikh_id: null,
    title: 'تجربة مجلس ثانٍ',
    status: 'ready',
    host_user_id: adminId,
    started_at: STARTED,
    ended_at: at(1800),
  });
  lectureB = await insertLiveDraft(readySess2, sectionA, 'تجربة مجلس ثانٍ', 2);

  processingSess = await insertSession({
    section_id: sectionA,
    title: 'تجربة مجلس يُضغط',
    status: 'processing',
    host_user_id: adminId,
    started_at: STARTED,
    ended_at: at(900),
    raw_path: `/recordings/${roomPrefix.slice(0, 3)}/tajriba-p-${ts}.ogg`,
  });
  const job = await service
    .from('media_jobs')
    .insert({
      kind: 'live_recording',
      input_key: `/recordings/${roomPrefix.slice(0, 3)}/tajriba-p-${ts}.ogg`,
      live_session_id: processingSess,
      status: 'failed', // never claimable by a running staging worker
      progress: 0.42,
      error: 'تجربة',
      not_before: '2100-01-01T00:00:00Z',
    })
    .select('id')
    .single();
  if (job.error || !job.data) throw job.error ?? new Error('job not inserted');
  jobIds.push(job.data.id);

  // Interventions on readySess: the host (admin), a brother approved at 12:30 and
  // demoted at 14:45, a hidden sister approved at 34:10 who left at 35:00.
  const hostIdentity = await addParticipant(readySess, adminId, 'm', 'host', { spoke_seconds: 3000 });
  const brother = await addParticipant(readySess, studentId, 'm', 'listener', { spoke_seconds: 135 });
  const hidden = await addParticipant(readySess, sisterId, 'f', 'listener', {
    hidden_name: true,
    spoke_seconds: 50,
    left_at: at(2100),
  });
  const log = await service.from('live_moderation_log').insert([
    { session_id: readySess, actor_user_id: adminId, target_identity: brother, action: 'approve', created_at: at(750) },
    { session_id: readySess, actor_user_id: adminId, target_identity: brother, action: 'demote', created_at: at(885) },
    { session_id: readySess, actor_user_id: adminId, target_identity: hidden, action: 'approve', created_at: at(2050) },
    { session_id: readySess, actor_user_id: adminId, target_identity: hostIdentity, action: 'mute', created_at: at(10) },
  ]);
  if (log.error) throw log.error;

  const future = new Date(Date.now() + 3 * 3600_000).toISOString();
  const s1 = await sheikh.rpc('create_live_session', {
    p_section: sectionA,
    p_title: 'تجربة مجلس الشيخ',
    p_scheduled_at: future,
    p_notify: false,
  });
  if (s1.error) throw s1.error;
  sheikhScheduled = s1.data as string;
  sessionIds.push(sheikhScheduled);
  const s2 = await publisher.rpc('create_live_session', {
    p_section: sectionA,
    p_title: 'تجربة مجلس الناشر',
    p_scheduled_at: future,
    p_notify: false,
  });
  if (s2.error) throw s2.error;
  publisherScheduled = s2.data as string;
  sessionIds.push(publisherScheduled);
});

afterAll(async () => {
  for (const id of sessionIds) await service.from('notifications').delete().eq('data->>liveSessionId', id);
  for (const id of jobIds) await service.from('notifications').delete().eq('data->>mediaJobId', id);
  if (jobIds.length) await service.from('media_jobs').delete().in('id', jobIds);
  for (const id of sectionIds) await service.from('lectures').delete().eq('section_id', id);
  if (sessionIds.length) await service.from('live_sessions').delete().in('id', sessionIds);
  if (sectionIds.length) await service.from('sections').delete().in('id', sectionIds);
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await Promise.all(
    [guest, student, sister, admin, publisher, sheikh].filter(Boolean).map((c) => c.auth.signOut()),
  );
});

// ---------------------------------------------------------------------------------
describe('who may call what', () => {
  test('students, guests and anon get none of the 0143 RPCs', async () => {
    for (const c of [student, guest, anon]) {
      for (const [fn, args] of [
        ['admin_live_overview', {}],
        ['admin_live_inbox', {}],
        ['get_live_interventions', { p_session: readySess }],
        ['admin_save_live_lecture', { p_lecture: lectureA, p_title: 'تجربة', p_sheikh: sheikhRowId }],
      ] as const) {
        const { data, error } = await c.rpc(fn, args);
        expect(error).not.toBeNull();
        expect(data).toBeNull();
      }
    }
  });

  test('a sheikh reads the overview and interventions, but not the inbox or save', async () => {
    expect((await sheikh.rpc('admin_live_overview')).error).toBeNull();
    expect((await sheikh.rpc('get_live_interventions', { p_session: readySess })).error).toBeNull();
    const inbox = await sheikh.rpc('admin_live_inbox');
    expect(inbox.error!.message).toContain(DENIED);
    const save = await sheikh.rpc('admin_save_live_lecture', {
      p_lecture: lectureA,
      p_title: 'تجربة عنوان',
      p_sheikh: sheikhRowId,
    });
    expect(save.error!.message).toContain(DENIED);
  });

  test('the internal helpers stay closed', async () => {
    for (const c of [student, admin]) {
      expect((await c.rpc('live_admin_session_json', { p_id: readySess })).error).not.toBeNull();
      expect((await c.rpc('live_admin_is_mine', { p_host: adminId, p_sheikh: sheikhRowId })).error).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------
describe('admin_live_overview', () => {
  test('a content manager sees every group, with the job and no secrets', async () => {
    const { data, error } = await admin.rpc('admin_live_overview', { p_recent: 50 });
    expect(error).toBeNull();
    const o = data as any;
    expect(o.is_manager).toBe(true);
    const recentIds = o.recent.map((r: any) => r.id);
    expect(recentIds).toEqual(expect.arrayContaining([readySess, processingSess]));
    const scheduledIds = o.scheduled.map((r: any) => r.id);
    expect(scheduledIds).toEqual(expect.arrayContaining([sheikhScheduled, publisherScheduled]));

    const ready = o.recent.find((r: any) => r.id === readySess);
    expect(ready).toMatchObject({
      status: 'ready',
      lecture_id: lectureA,
      lecture_status: 'draft',
      lecture_needs_title: true,
      raw_local: true,
      raw_backup: true,
      peak_listeners: 42,
      is_mine: true,
    });
    for (const secret of ['raw_path', 'raw_backup_key', 'room_name', 'egress_id']) {
      expect(ready).not.toHaveProperty(secret);
    }
    const proc = o.recent.find((r: any) => r.id === processingSess);
    expect(proc.job).toMatchObject({ status: 'failed', error: 'تجربة' });
    expect(proc.job.progress).toBeCloseTo(0.42, 2);
  });

  test('a sheikh sees his own scheduled session only, and no job errors', async () => {
    const { data, error } = await sheikh.rpc('admin_live_overview', { p_recent: 50 });
    expect(error).toBeNull();
    const o = data as any;
    expect(o.is_manager).toBe(false);
    const scheduledIds = o.scheduled.map((r: any) => r.id);
    expect(scheduledIds).toContain(sheikhScheduled);
    expect(scheduledIds).not.toContain(publisherScheduled);
    // The admin-hosted recent fixtures are under a sheikhs row that may be his —
    // either way, a job error never reaches a sheikh.
    for (const r of o.recent) if (r.job) expect(r.job.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------------
describe('admin_live_inbox', () => {
  test('needs_title drafts with the sheikh suggestion; recordings on their way', async () => {
    const { data, error } = await publisher.rpc('admin_live_inbox');
    expect(error).toBeNull();
    const inbox = data as any;
    const a = inbox.drafts.find((d: any) => d.lecture_id === lectureA);
    expect(a).toMatchObject({
      section_id: sectionA,
      order: 1,
      sheikh_id: null,
      suggested_sheikh_id: sheikhRowId, // the session's sheikh
      session_id: readySess,
      peak_listeners: 42,
    });
    const pendingIds = inbox.pending.map((p: any) => p.id);
    expect(pendingIds).toContain(processingSess);
    expect(pendingIds).not.toContain(readySess);
  });
});

// ---------------------------------------------------------------------------------
describe('get_live_interventions', () => {
  test('who spoke and when — real names (D2), offsets from the start, no host', async () => {
    const { data, error } = await admin.rpc('get_live_interventions', { p_session: readySess });
    expect(error).toBeNull();
    const rows = data as any[];
    expect(rows.map((r) => r.gender)).toEqual(['m', 'f']); // ordered by first approve
    const [brother, hidden] = rows;
    expect(brother.display_name).toContain('تجربة أخ المداخلات');
    expect(brother.spoke_seconds).toBe(135);
    expect(brother.stints).toHaveLength(1);
    expect(brother.stints[0]).toMatchObject({ from_sec: 750, to_sec: 885 });

    expect(hidden.hidden_name).toBe(true);
    expect(hidden.display_name).toContain('تجربة أخت المداخلات'); // the REAL name
    expect(hidden.stints[0]).toMatchObject({ from_sec: 2050, to_sec: 2100 }); // ended by her leave
  });

  test('an unknown session is an Arabic error', async () => {
    const { error } = await admin.rpc('get_live_interventions', {
      p_session: '00000000-0000-0000-0000-000000000000',
    });
    expect(error!.message).toContain('المجلس غير موجود');
  });
});

// ---------------------------------------------------------------------------------
describe('admin_save_live_lecture', () => {
  test('the two required fields are enforced', async () => {
    const short = await admin.rpc('admin_save_live_lecture', { p_lecture: lectureA, p_title: 'ab', p_sheikh: sheikhRowId });
    expect(short.error!.message).toContain('العنوان بين');
    const noSheikh = await admin.rpc('admin_save_live_lecture', { p_lecture: lectureA, p_title: 'تجربة عنوان', p_sheikh: null });
    expect(noSheikh.error!.message).toContain('اختر الشيخ');
    expect((await lectureRow(lectureA)).review_state).toBe('needs_title');
  });

  test('only live lectures', async () => {
    const { data: plain } = await service.from('lectures').select('id').eq('section_id', sectionB).limit(1).single();
    const r = await admin.rpc('admin_save_live_lecture', {
      p_lecture: plain!.id,
      p_title: 'تجربة عنوان',
      p_sheikh: sheikhRowId,
    });
    expect(r.error!.message).toContain('ليست من بث مباشر');
  });

  test('«حفظ دون نشر»: finalized, still a draft, out of the inbox', async () => {
    const { error } = await admin.rpc('admin_save_live_lecture', {
      p_lecture: lectureA,
      p_title: '  تجربة العنوان النهائي  ',
      p_sheikh: sheikhRowId,
      p_publish: false,
    });
    expect(error).toBeNull();
    const l = await lectureRow(lectureA);
    expect(l).toMatchObject({
      title: 'تجربة العنوان النهائي',
      sheikh_id: sheikhRowId,
      review_state: null,
      status: 'draft',
      section_id: sectionA,
      order: 1,
    });
    const inbox = (await admin.rpc('admin_live_inbox')).data as any;
    expect(inbox.drafts.map((d: any) => d.lecture_id)).not.toContain(lectureA);
  });

  test('«نشر بدون إشعار» + «تغيير» the section: published quietly at the end of the new section', async () => {
    const { error } = await publisher.rpc('admin_save_live_lecture', {
      p_lecture: lectureB,
      p_title: 'تجربة المجلس الثاني',
      p_sheikh: sheikhRowId,
      p_section: sectionB,
      p_publish: true,
      p_notify: false,
    });
    expect(error).toBeNull();
    const l = await lectureRow(lectureB);
    expect(l).toMatchObject({
      status: 'published',
      notify_on_publish: false,
      review_state: null,
      section_id: sectionB,
      order: 4,
    });
    // 0137 tracks the live lecture's publish time on its session.
    const { data: s } = await service
      .from('live_sessions')
      .select('lecture_published_at')
      .eq('id', readySess2)
      .single();
    expect(s!.lecture_published_at).not.toBeNull();
  });
});
