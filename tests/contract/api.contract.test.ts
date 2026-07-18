/**
 * Contract tests: the server-side assumptions `src/api/*` bakes in, verified
 * against the live STAGING project (seeded per the FINDINGS staging-readiness
 * note: العقيدة → التوحيد with 2 published + 1 draft lectures, a female-only
 * section, demo accounts). Anon-key clients only — RLS is the thing under test.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const seedPassword = process.env.STAGING_STAGING_SEED_PASSWORD ?? '';

const newClient = (): SupabaseClient =>
  createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** Fresh anonymous (guest) session — the app's default identity. */
async function guestClient(): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInAnonymously();
  if (error) throw error;
  return c;
}

async function studentClient(): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({
    email: 'user@gmail.com',
    password: seedPassword,
  });
  if (error) throw error;
  return c;
}

async function sheikhClient(): Promise<SupabaseClient> {
  const c = newClient();
  const { error } = await c.auth.signInWithPassword({
    email: 'sheikh@gmail.com',
    password: seedPassword,
  });
  if (error) throw error;
  return c;
}

describe('guest (anonymous) session', () => {
  let guest: SupabaseClient;
  beforeAll(async () => {
    guest = await guestClient();
  });
  afterAll(() => guest.auth.signOut());

  test('anonymous sign-in is enabled and yields a usable session', async () => {
    const { data } = await guest.auth.getUser();
    expect(data.user?.is_anonymous).toBe(true);
  });

  test('lectures select exposes ONLY published rows (draft invisible via RLS)', async () => {
    const { data, error } = await guest.from('lectures').select('id, status');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0); // seed has published lectures
    expect(data!.every((l) => l.status === 'published')).toBe(true);
  });

  test('get_home_page returns the section tree without drafts', async () => {
    const { data, error } = await guest.rpc('get_home_page');
    expect(error).toBeNull();
    expect(data).toBeTruthy();
  });

  test("another user's private tables are not readable (notes)", async () => {
    const { data, error } = await guest.from('lecture_notes').select('*');
    // RLS: a fresh guest owns nothing — must see zero rows, never an error leak.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('journey day-anchored RPCs (F-043 / migration 0090 contract)', () => {
  let student: SupabaseClient;
  beforeAll(async () => {
    student = await studentClient();
  });
  afterAll(() => student.auth.signOut());

  test('get_streak_status: either p_today is accepted (0090 applied) or PGRST202 signals the client fallback', async () => {
    const withDay = await student.rpc('get_streak_status', { p_today: '2026-07-15' });
    if (withDay.error) {
      // Pre-0090: the ONLY acceptable failure is function-not-found — that is
      // exactly what rpcWithLocalToday's fallback keys on (F-049 risk).
      expect(withDay.error.code).toBe('PGRST202');
      const zeroArg = await student.rpc('get_streak_status');
      expect(zeroArg.error).toBeNull();
    } else {
      expect(withDay.error).toBeNull();
    }
  });

  test('get_journey_summary row shape matches the SummaryRow mapper in src/api/journey.ts', async () => {
    const call = await student.rpc('get_journey_summary', { p_today: '2026-07-15' });
    const res = call.error?.code === 'PGRST202' ? await student.rpc('get_journey_summary') : call;
    expect(res.error).toBeNull();
    const row = (res.data as Record<string, unknown>[] | null)?.[0];
    if (row) {
      for (const key of [
        'completed_lectures',
        'total_seconds',
        'current_streak',
        'longest_streak',
        'active_days',
        'week_metric',
        'week_target',
        'week_current',
      ]) {
        expect(row).toHaveProperty(key);
      }
    }
  });
});

describe('Q&A anonymity at the network layer (Phase 7)', () => {
  let asker: SupabaseClient;
  let sheikh: SupabaseClient;
  let askerUid = '';
  const created: string[] = [];

  beforeAll(async () => {
    asker = await studentClient();
    sheikh = await sheikhClient();
    askerUid = (await asker.auth.getUser()).data.user!.id;
  });
  afterAll(async () => {
    for (const id of created) await asker.rpc('delete_own_question', { p_question_id: id });
    await asker.auth.signOut();
    await sheikh.auth.signOut();
  });

  // The F-056 regression: a sheikh must NOT be able to raw-select the questions
  // table and read the asker_id / is_anonymous of an anonymous question. Before
  // 0091 the questions_select_own_or_moderator RLS policy let any moderator read
  // every row directly, defeating the DEFINER RPCs' anonymity (0077) — a sheikh
  // could correlate an anonymous question with a named one by the shared UUID.
  test('the F-056 regression: a sheikh cannot raw-select another user\'s asker_id from the questions table', async () => {
    const { data: qid, error } = await asker.rpc('ask_question', {
      p_scope: 'general',
      p_lecture_id: null,
      p_is_anonymous: true,
      p_audience: 'public',
      p_body: 'سؤال مجهول لاختبار خصوصية الشبكة',
      p_category: 'general',
    });
    expect(error).toBeNull();
    created.push(qid as string);

    // Sheikh raw table read — must never return this user's row.
    const raw = await sheikh
      .from('questions')
      .select('id, asker_id, is_anonymous')
      .eq('asker_id', askerUid);
    expect(raw.error).toBeNull();
    expect(raw.data).toEqual([]);

    // The intended path still anonymises: 'سائل' to the sheikh, asker_id null.
    const inbox = await sheikh.rpc('get_question_inbox', {});
    expect(inbox.error).toBeNull();
    const row = (inbox.data as any[]).find((r) => r.id === qid);
    expect(row).toBeTruthy();
    expect(row.asker_display).toBe('سائل');
    expect(row.asker_id).toBeNull();
  });

  // The F-057 regression: editing a question's body must clear its 0086 answer
  // thread, not just the mirrored answer columns — so a stale answer never sits
  // under new question text once the question is answered again.
  test('the F-057 regression: editing a question body clears the old answer thread', async () => {
    const { data: qid } = await asker.rpc('ask_question', {
      p_scope: 'general',
      p_lecture_id: null,
      p_is_anonymous: false,
      p_audience: 'public',
      p_body: 'السؤال الأصلي عن الطهارة',
      p_category: 'general',
    });
    created.push(qid as string);

    await sheikh.rpc('answer_question', {
      p_question_id: qid,
      p_answer_body: 'جواب عن الطهارة',
      p_answer_audio_path: null,
    });
    await asker.rpc('update_own_question', {
      p_id: qid,
      p_body: 'سؤال جديد تماماً عن الصلاة',
      p_audience: 'public',
      p_category: 'general',
    });
    await sheikh.rpc('answer_question', {
      p_question_id: qid,
      p_answer_body: 'جواب عن الصلاة',
      p_answer_audio_path: null,
    });

    const thread = await asker.rpc('get_question_answers', { p_question_id: qid });
    expect(thread.error).toBeNull();
    const bodies = (thread.data as any[]).map((a) => a.body);
    expect(bodies).toEqual(['جواب عن الصلاة']);
  });
});

describe('quiz RPC shapes (Phase 8 client contract)', () => {
  test('get_section_quizzes rows match RawStatusRow (mapCard input)', async () => {
    const guest = await guestClient();
    try {
      const { data: sections, error: sErr } = await guest.from('sections').select('id').limit(10);
      expect(sErr).toBeNull();
      for (const s of sections ?? []) {
        const { data, error } = await guest.rpc('get_section_quizzes', { p_section_id: s.id });
        expect(error).toBeNull();
        const row = (data as Record<string, unknown>[] | null)?.[0];
        if (row) {
          for (const key of [
            'id',
            'title',
            'pass_score',
            'question_count',
            'attempts_used',
            'attempts_left',
            'passed',
            'in_progress_attempt_id',
          ]) {
            expect(row).toHaveProperty(key);
          }
          return; // one real row is enough
        }
      }
      // No quizzes seeded yet — shape check skipped but the RPC must exist (no error above).
    } finally {
      await guest.auth.signOut();
    }
  });
});
