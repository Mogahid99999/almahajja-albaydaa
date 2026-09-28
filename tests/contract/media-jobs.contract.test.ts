/**
 * Contract tests for migrations 0132_media_jobs + 0133_media_jobs_refine
 * (V23 P1 — server-side media worker), against the live STAGING project.
 *
 * Pins the contract the VPS worker and the admin upload page are coded against:
 *   - enqueue_lecture_transcode(lecture, key, publish_on_done?): content managers
 *     (admin + publisher) only; refused only while a queued/running job exists
 *     for the lecture (re-enqueue after a failed job is fine).
 *   - claim_media_job(p_kinds?) / touch_media_job / complete_lecture_transcode /
 *     fail_media_job: service_role only (anon and every authenticated role are
 *     refused).
 *   - claim → running (optionally only some kinds); touch → progress/heartbeat
 *     while running, false otherwise; complete → lecture audio fields + job done
 *     (+ publish when publish_on_done); fail → 'retry', 'retry', then 'failed'
 *     (+ staff inbox row), and 'ignored' for any job that is not running.
 *   - media_jobs is invisible to students/guests; content managers can read it.
 *   - app_config.server_transcode is readable by admin + publisher sessions.
 *   - a lecture whose audio is still being compressed cannot be published.
 *
 * Fixtures: «تجربة…» draft lectures with no section (never in the tree, never
 * notify), their jobs, the staff notifications a final failure creates, one
 * throwaway guest and one throwaway «تجربة» student — all deleted in afterAll.
 * The test jobs are "parked" (not_before far in the future) right after they
 * are created so a staging worker polling the queue can't grab them, and each
 * claim first makes the target job the oldest claimable one (and refuses to
 * claim at all while someone else's job is claimable).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const STAFF_PASSWORD = '12345678';
const PARKED = '2100-01-01T00:00:00Z';
const OLDEST = '2000-01-01T00:00:00Z';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const service: SupabaseClient = createClient(url, serviceKey, opts);

async function signIn(email: string, passwords: string[]): Promise<SupabaseClient> {
  let last: unknown = null;
  for (const password of passwords.filter(Boolean)) {
    const c = newClient();
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (!error) return c;
    last = error;
  }
  throw last ?? new Error(`no password for ${email}`);
}

const ts = Date.now();
const lectureIds: string[] = [];
const jobIds: string[] = [];
let guestId: string | null = null;
let studentId: string | null = null;

/**
 * Staging has no student login with a known password (STAGING_SEED_PASSWORD is
 * unset), so — like scripts/security-check.mjs — a throwaway «تجربة» student is
 * created with the service key and deleted in afterAll.
 */
async function throwawayStudent(): Promise<SupabaseClient> {
  const email = `tajriba-media-jobs-${ts}@example.com`;
  const password = `Tajriba-${ts}-pw`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `تجربة — طالب عقد الضغط ${ts}` },
  });
  if (error || !data.user) throw error ?? new Error('throwaway student not created');
  studentId = data.user.id;
  return signIn(email, [password]);
}

let anon: SupabaseClient;
let guest: SupabaseClient;
let student: SupabaseClient;
let publisher: SupabaseClient;
let admin: SupabaseClient;

async function makeLecture(label: string): Promise<string> {
  const { data, error } = await service
    .from('lectures')
    .insert({
      title: `تجربة — ضغط الخادم (${label}) ${ts}`,
      section_id: null,
      status: 'draft',
      notify_on_publish: false,
      audio_path: null,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('fixture lecture insert failed');
  lectureIds.push(data.id);
  return data.id;
}

const RACE_NOTE =
  "a staging media worker claimed this suite's job between un-park and claim (it polls claim_media_job) — stop the staging worker or rerun";

const inputKey = (label: string) => `incoming/tajriba-${label}-${ts}.m4a`;

/** Keep a staging worker (if one is polling) away from our jobs. */
async function park(jobId: string) {
  const { error } = await service.from('media_jobs').update({ not_before: PARKED }).eq('id', jobId);
  if (error) throw error;
}

async function jobRow(jobId: string): Promise<Record<string, any>> {
  const { data, error } = await service.from('media_jobs').select('*').eq('id', jobId).single();
  if (error || !data) throw error ?? new Error('job not found');
  return data;
}

/**
 * Refuse to claim when someone else's job is claimable — the claim would steal
 * it. (A staging worker being developed concurrently may have queued real work.)
 */
async function assertNoForeignClaimable() {
  const stale = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data, error } = await service
    .from('media_jobs')
    .select('id')
    .or(
      `and(status.eq.queued,not_before.lte."${new Date().toISOString()}"),` +
        `and(status.eq.running,heartbeat_at.lt."${stale}")`,
    );
  if (error) throw error;
  const foreign = (data ?? []).filter((r) => !jobIds.includes(r.id));
  if (foreign.length > 0) {
    throw new Error(
      `staging media_jobs has ${foreign.length} claimable job(s) that are not this suite's — rerun when the queue is idle`,
    );
  }
}

/** Make `jobId` the oldest claimable job, then claim as the worker would. */
async function claimMine(jobId: string, kinds?: string[]): Promise<Record<string, any>> {
  // Foreign check first, so un-park → claim is a single round trip apart (a
  // staging worker polling claim_media_job has the smallest possible window).
  await assertNoForeignClaimable();
  const { error } = await service
    .from('media_jobs')
    .update({ created_at: OLDEST, not_before: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', jobId);
  if (error) throw error;
  const res = kinds
    ? await service.rpc('claim_media_job', { p_kinds: kinds })
    : await service.rpc('claim_media_job');
  expect(res.error).toBeNull();
  const rows = res.data as Record<string, any>[];
  if (rows.length === 0 || rows[0].id !== jobId) {
    throw new Error(`${RACE_NOTE} (job ${jobId} is now ${(await jobRow(jobId)).status})`);
  }
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(jobId);
  return rows[0];
}

beforeAll(async () => {
  if (!serviceKey) throw new Error('media-jobs contract tests need SUPABASE_SECRET_KEY in .env.staging.local');
  anon = newClient();
  guest = newClient();
  const g = await guest.auth.signInAnonymously();
  if (g.error) throw g.error;
  guestId = g.data.user!.id;
  student = await throwawayStudent();
  publisher = await signIn('publisher@gmail.com', [STAFF_PASSWORD]);
  admin = await signIn('admin@gmail.com', [STAFF_PASSWORD]);
});

afterAll(async () => {
  for (const id of jobIds) {
    await service.from('notifications').delete().eq('data->>mediaJobId', id);
  }
  if (jobIds.length) await service.from('media_jobs').delete().in('id', jobIds);
  if (lectureIds.length) await service.from('lectures').delete().in('id', lectureIds);
  if (guestId) await service.auth.admin.deleteUser(guestId);
  if (studentId) await service.auth.admin.deleteUser(studentId);
  await Promise.all([guest, student, publisher, admin].filter(Boolean).map((c) => c.auth.signOut()));
});

describe('media_jobs — enqueue_lecture_transcode (content managers only)', () => {
  let lecA = '';
  let lecB = '';
  let jobA = '';

  beforeAll(async () => {
    lecA = await makeLecture('ناشر');
    lecB = await makeLecture('مدير');
  });

  test('a student cannot enqueue', async () => {
    const { data, error } = await student.rpc('enqueue_lecture_transcode', {
      p_lecture: lecA,
      p_input_key: inputKey('student'),
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('غير مصرح');
    expect(data).toBeNull();
  });

  test('a guest cannot enqueue', async () => {
    const { error } = await guest.rpc('enqueue_lecture_transcode', {
      p_lecture: lecA,
      p_input_key: inputKey('guest'),
    });
    expect(error).not.toBeNull();
  });

  test('a no-session (anon) caller cannot enqueue', async () => {
    const { error } = await anon.rpc('enqueue_lecture_transcode', {
      p_lecture: lecA,
      p_input_key: inputKey('anon'),
    });
    expect(error).not.toBeNull();
  });

  test('a publisher can enqueue; a retried call returns the same job', async () => {
    const first = await publisher.rpc('enqueue_lecture_transcode', {
      p_lecture: lecA,
      p_input_key: inputKey('a'),
    });
    expect(first.error).toBeNull();
    jobA = first.data as string;
    expect(jobA).toMatch(/^[0-9a-f-]{36}$/);
    jobIds.push(jobA);
    await park(jobA);

    const again = await publisher.rpc('enqueue_lecture_transcode', {
      p_lecture: lecA,
      p_input_key: inputKey('a'),
    });
    expect(again.error).toBeNull();
    expect(again.data).toBe(jobA);

    const row = await jobRow(jobA);
    expect(row.kind).toBe('lecture_transcode');
    expect(row.status).toBe('queued');
    expect(row.progress).toBe(0);
    expect(row.attempts).toBe(0);
    expect(row.lecture_id).toBe(lecA);
    expect(row.publish_on_done).toBe(false);
    expect(row.created_by).toBe((await publisher.auth.getUser()).data.user!.id);
  });

  test('a different file while a job is still active is refused', async () => {
    const { error } = await publisher.rpc('enqueue_lecture_transcode', {
      p_lecture: lecA,
      p_input_key: inputKey('a-other'),
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('يجري ضغط ملف آخر');
  });

  test('an admin can enqueue', async () => {
    const { data, error } = await admin.rpc('enqueue_lecture_transcode', {
      p_lecture: lecB,
      p_input_key: inputKey('b'),
    });
    expect(error).toBeNull();
    jobIds.push(data as string);
    await park(data as string);
  });

  test('keys outside incoming/ and unknown lectures are refused', async () => {
    const badKey = await admin.rpc('enqueue_lecture_transcode', {
      p_lecture: lecB,
      p_input_key: 'lectures/tajriba.mp3',
    });
    expect(badKey.error?.message).toContain('مفتاح الملف غير صالح');

    const traversal = await admin.rpc('enqueue_lecture_transcode', {
      p_lecture: lecB,
      p_input_key: 'incoming/../lectures/x.mp3',
    });
    expect(traversal.error?.message).toContain('مفتاح الملف غير صالح');

    const noLecture = await admin.rpc('enqueue_lecture_transcode', {
      p_lecture: '00000000-0000-0000-0000-000000000000',
      p_input_key: inputKey('none'),
    });
    expect(noLecture.error?.message).toContain('المحاضرة غير موجودة');
  });
});

describe('media_jobs — worker RPCs are service-role only', () => {
  const dummy = '00000000-0000-0000-0000-000000000000';
  const calls: [string, Record<string, unknown>][] = [
    ['claim_media_job', {}],
    ['claim_media_job', { p_kinds: ['lecture_transcode'] }],
    ['touch_media_job', { p_job: dummy, p_progress: 0.5 }],
    [
      'complete_lecture_transcode',
      { p_job: dummy, p_output_key: 'lectures/x.mp3', p_duration_sec: 1, p_size_bytes: 1 },
    ],
    ['fail_media_job', { p_job: dummy, p_error: 'x' }],
  ];

  test.each(calls)('%s is refused for anon, student and admin', async (fn, args) => {
    for (const c of [anon, student, admin]) {
      const { data, error } = await c.rpc(fn, args);
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    }
  });
});

describe('media_jobs — table visibility (RLS)', () => {
  test('students and guests see no jobs; content managers do', async () => {
    expect(jobIds.length).toBeGreaterThan(0);

    for (const c of [student, guest]) {
      const { data, error } = await c.from('media_jobs').select('id').in('id', jobIds);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    for (const c of [publisher, admin]) {
      const { data, error } = await c.from('media_jobs').select('id, progress, status').in('id', jobIds);
      expect(error).toBeNull();
      expect(data!.length).toBe(jobIds.length);
    }
  });

  test('no client can write media_jobs directly (even a content manager)', async () => {
    const ins = await admin.from('media_jobs').insert({ kind: 'lecture_transcode', input_key: inputKey('direct') });
    expect(ins.error).not.toBeNull();

    const upd = await publisher.from('media_jobs').update({ progress: 0.5 }).eq('id', jobIds[0]);
    expect(upd.error).not.toBeNull();
    expect((await jobRow(jobIds[0])).progress).toBe(0);
  });
});

describe('app_config.server_transcode', () => {
  test('admin and publisher sessions can read the flag', async () => {
    for (const c of [admin, publisher]) {
      const { data, error } = await c.from('app_config').select('value').eq('key', 'server_transcode').single();
      expect(error).toBeNull();
      expect(['true', 'false']).toContain(data!.value);
    }
  });
});

describe('media_jobs — publish guard + claim → touch → complete', () => {
  test('a lecture cannot be published while its audio is still being compressed', async () => {
    const [jobA] = jobIds;
    const lecA = (await jobRow(jobA)).lecture_id as string;
    const { error } = await admin.from('lectures').update({ status: 'published' }).eq('id', lecA);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('لا يمكن نشر المحاضرة قبل اكتمال ضغط ملفها الصوتي');
    const { data } = await service.from('lectures').select('status').eq('id', lecA).single();
    expect(data!.status).toBe('draft');
  });

  test('claim honours p_kinds: a live_recording-only claim skips a queued transcode', async () => {
    const [jobA] = jobIds;
    await assertNoForeignClaimable();
    // Claimable for as short a time as possible (a staging worker polls).
    await service
      .from('media_jobs')
      .update({ created_at: OLDEST, not_before: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', jobA);
    const res = await service.rpc('claim_media_job', { p_kinds: ['live_recording'] });
    await park(jobA);
    expect(res.error).toBeNull();
    expect(res.data).toEqual([]);
    const row = await jobRow(jobA);
    if (row.status !== 'queued') throw new Error(`${RACE_NOTE} (job ${jobA} is now ${row.status})`);
    expect(row.attempts).toBe(0);
  });

  test('claim → running; touch; complete → lecture audio fields + job done', async () => {
    const [jobA] = jobIds;
    const claimed = await claimMine(jobA, ['lecture_transcode']);
    expect(claimed.status).toBe('running');
    expect(claimed.attempts).toBe(1);
    expect(claimed.started_at).toBeTruthy();
    expect(claimed.heartbeat_at).toBeTruthy();

    // The worker reports progress + heartbeat through touch_media_job (DB clock).
    const before = Date.parse(claimed.heartbeat_at);
    const hb = await service.rpc('touch_media_job', { p_job: jobA, p_progress: 0.42 });
    expect(hb.error).toBeNull();
    expect(hb.data).toBe(true);
    const { data: seen } = await publisher
      .from('media_jobs')
      .select('progress, heartbeat_at')
      .eq('id', jobA)
      .single();
    expect(seen!.progress).toBeCloseTo(0.42, 5);
    expect(Date.parse(seen!.heartbeat_at)).toBeGreaterThanOrEqual(before);
    // Clamped to 0..1; null keeps the progress and only beats the heart.
    expect((await service.rpc('touch_media_job', { p_job: jobA, p_progress: 1.7 })).data).toBe(true);
    expect((await jobRow(jobA)).progress).toBe(1);
    expect((await service.rpc('touch_media_job', { p_job: jobA, p_progress: null })).data).toBe(true);
    expect((await jobRow(jobA)).progress).toBe(1);

    const outputKey = `lectures/tajriba-contract-${ts}.mp3`;
    const done = await service.rpc('complete_lecture_transcode', {
      p_job: jobA,
      p_output_key: outputKey,
      p_duration_sec: 3725,
      p_size_bytes: 9876543,
    });
    expect(done.error).toBeNull();

    const job = await jobRow(jobA);
    expect(job.status).toBe('done');
    expect(job.progress).toBe(1);
    expect(job.output_key).toBe(outputKey);
    expect(job.finished_at).toBeTruthy();

    const { data: lec } = await service
      .from('lectures')
      .select('audio_path, duration_sec, audio_size_bytes, status')
      .eq('id', job.lecture_id)
      .single();
    expect(lec).toEqual({ audio_path: outputKey, duration_sec: 3725, audio_size_bytes: 9876543, status: 'draft' });

    // A retried complete (lost response) is a no-op, not an error.
    const dup = await service.rpc('complete_lecture_transcode', {
      p_job: jobA,
      p_output_key: outputKey,
      p_duration_sec: 3725,
      p_size_bytes: 9876543,
    });
    expect(dup.error).toBeNull();
  });

  test('a finished job: touch → false, fail → ignored (a lost reply never re-queues it)', async () => {
    const [jobA] = jobIds;
    const touch = await service.rpc('touch_media_job', { p_job: jobA, p_progress: 0.1 });
    expect(touch.error).toBeNull();
    expect(touch.data).toBe(false);

    const fail = await service.rpc('fail_media_job', { p_job: jobA, p_error: 'تجربة: late reply' });
    expect(fail.error).toBeNull();
    expect(fail.data).toBe('ignored');

    const job = await jobRow(jobA);
    expect(job.status).toBe('done');
    expect(job.progress).toBe(1);
    expect(job.error).toBeNull();

    const unknown = await service.rpc('fail_media_job', {
      p_job: '00000000-0000-0000-0000-000000000000',
      p_error: 'x',
    });
    expect(unknown.data).toBe('ignored');
  });

  test('once the audio is in place the normal publish path is untouched', async () => {
    const lecA = (await jobRow(jobIds[0])).lecture_id as string;
    // notify_on_publish=false + no section: publishes silently, then back to draft.
    const pub = await admin.from('lectures').update({ status: 'published' }).eq('id', lecA);
    expect(pub.error).toBeNull();
    const back = await admin.from('lectures').update({ status: 'draft' }).eq('id', lecA);
    expect(back.error).toBeNull();
  });
});

describe('media_jobs — fail: retry, retry, then failed; re-enqueue; dead worker', () => {
  test('backoff 1 min, then 5 min, then final failure notifies staff', async () => {
    const jobB = jobIds[1];

    const c1 = await claimMine(jobB);
    expect(c1.attempts).toBe(1);
    const f1 = await service.rpc('fail_media_job', { p_job: jobB, p_error: 'تجربة: ffmpeg exit 1' });
    expect(f1.error).toBeNull();
    expect(f1.data).toBe('retry');
    let row = await jobRow(jobB);
    expect(row.status).toBe('queued');
    expect(row.error).toBe('تجربة: ffmpeg exit 1');
    let wait = Date.parse(row.not_before) - Date.parse(row.started_at);
    expect(wait).toBeGreaterThanOrEqual(59_000);
    expect(wait).toBeLessThan(75_000);

    // A duplicate fail (lost response) on the now-queued job changes nothing.
    const dupRetry = await service.rpc('fail_media_job', { p_job: jobB, p_error: 'dup' });
    expect(dupRetry.data).toBe('ignored');
    row = await jobRow(jobB);
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(1);
    expect(row.error).toBe('تجربة: ffmpeg exit 1');
    // …and a queued job can't be touched.
    expect((await service.rpc('touch_media_job', { p_job: jobB, p_progress: 0.5 })).data).toBe(false);

    const c2 = await claimMine(jobB);
    expect(c2.attempts).toBe(2);
    const f2 = await service.rpc('fail_media_job', { p_job: jobB, p_error: 'تجربة: timeout' });
    expect(f2.data).toBe('retry');
    row = await jobRow(jobB);
    wait = Date.parse(row.not_before) - Date.parse(row.started_at);
    expect(wait).toBeGreaterThanOrEqual(299_000);
    expect(wait).toBeLessThan(315_000);

    const c3 = await claimMine(jobB);
    expect(c3.attempts).toBe(3);
    const f3 = await service.rpc('fail_media_job', { p_job: jobB, p_error: 'تجربة: final' });
    expect(f3.error).toBeNull();
    expect(f3.data).toBe('failed');
    row = await jobRow(jobB);
    expect(row.status).toBe('failed');
    expect(row.finished_at).toBeTruthy();

    const { data: notes, error } = await service
      .from('notifications')
      .select('type, title, data')
      .eq('data->>mediaJobId', jobB);
    expect(error).toBeNull();
    expect(notes!.length).toBeGreaterThan(0);
    expect(notes!.every((n) => n.type === 'content_reported')).toBe(true);
    expect(notes![0].title).toBe('تعذّر ضغط ملف المحاضرة');
    // Never a lectureId: the inbox would open the player on a draft.
    expect(notes![0].data).not.toHaveProperty('lectureId');

    const dupFailed = await service.rpc('fail_media_job', { p_job: jobB, p_error: 'dup' });
    expect(dupFailed.data).toBe('ignored');
    expect((await jobRow(jobB)).status).toBe('failed');
  });

  test('re-enqueue after a failed job is allowed (only an active job blocks)', async () => {
    const lecB = (await jobRow(jobIds[1])).lecture_id as string;
    expect((await jobRow(jobIds[1])).status).toBe('failed');
    const { data: jobC, error } = await admin.rpc('enqueue_lecture_transcode', {
      p_lecture: lecB,
      p_input_key: inputKey('c'),
    });
    expect(error).toBeNull();
    expect(jobC).not.toBe(jobIds[1]);
    jobIds.push(jobC as string);
    await park(jobC as string);
    expect((await jobRow(jobC as string)).status).toBe('queued');
  });

  test('a worker that died mid-job: the job is re-claimed after 2 silent minutes', async () => {
    const jobC = jobIds[2];
    const first = await claimMine(jobC as string);
    expect(first.attempts).toBe(1);
    // Simulate a dead worker: no heartbeat for 3 minutes.
    await service
      .from('media_jobs')
      .update({ heartbeat_at: new Date(Date.now() - 3 * 60_000).toISOString() })
      .eq('id', jobC as string);
    await assertNoForeignClaimable();
    const res = await service.rpc('claim_media_job');
    expect(res.error).toBeNull();
    expect((res.data as any[])[0]?.id).toBe(jobC);
    expect((res.data as any[])[0]?.attempts).toBe(2);

    const f = await service.rpc('fail_media_job', { p_job: jobC, p_error: 'تجربة' });
    expect(f.data).toBe('retry');
    await park(jobC as string);
  });
});

describe('media_jobs — publish_on_done (0133)', () => {
  test('complete publishes the lecture (normal publish path, null duration accepted)', async () => {
    const lecD = await makeLecture('نشر تلقائي');

    // Enqueued without the flag, then the same file again with it: same job, flag on.
    const first = await publisher.rpc('enqueue_lecture_transcode', {
      p_lecture: lecD,
      p_input_key: inputKey('d'),
    });
    expect(first.error).toBeNull();
    const jobD = first.data as string;
    jobIds.push(jobD);
    await park(jobD);
    expect((await jobRow(jobD)).publish_on_done).toBe(false);

    const again = await publisher.rpc('enqueue_lecture_transcode', {
      p_lecture: lecD,
      p_input_key: inputKey('d'),
      p_publish_on_done: true,
    });
    expect(again.error).toBeNull();
    expect(again.data).toBe(jobD);
    expect((await jobRow(jobD)).publish_on_done).toBe(true);

    // Still a draft until the audio is in.
    const { data: pre } = await service.from('lectures').select('status').eq('id', lecD).single();
    expect(pre!.status).toBe('draft');

    await claimMine(jobD);
    const outputKey = `lectures/tajriba-publish-${ts}.mp3`;
    const done = await service.rpc('complete_lecture_transcode', {
      p_job: jobD,
      p_output_key: outputKey,
      p_duration_sec: null,
      p_size_bytes: 5555,
    });
    expect(done.error).toBeNull();

    const job = await jobRow(jobD);
    expect(job.status).toBe('done');
    expect(job.error).toBeNull();

    const { data: lec } = await service
      .from('lectures')
      .select('audio_path, duration_sec, audio_size_bytes, status, notify_on_publish')
      .eq('id', lecD)
      .single();
    // notify_on_publish=false + no section: the publish trigger stays silent.
    expect(lec).toEqual({
      audio_path: outputKey,
      duration_sec: null,
      audio_size_bytes: 5555,
      status: 'published',
      notify_on_publish: false,
    });

    // Duplicate complete: no error, nothing changes.
    const dup = await service.rpc('complete_lecture_transcode', {
      p_job: jobD,
      p_output_key: outputKey,
      p_duration_sec: null,
      p_size_bytes: 5555,
    });
    expect(dup.error).toBeNull();

    // Back to draft right away (the fixture is deleted in afterAll anyway).
    const back = await service.from('lectures').update({ status: 'draft' }).eq('id', lecD);
    expect(back.error).toBeNull();
  });
});
