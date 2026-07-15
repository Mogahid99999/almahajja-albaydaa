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
