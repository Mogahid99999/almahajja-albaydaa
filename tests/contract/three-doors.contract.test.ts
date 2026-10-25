/**
 * Contract tests for migration 0161 («الأبواب الثلاثة») against STAGING:
 * lecture-questions feed, unified benefits (general + lecture), and the
 * aggregate-only mushaf usage stats. Anon-key clients only — RLS and the
 * DEFINER gates are what is under test.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const newClient = (): SupabaseClient => createClient(url, anonKey, opts);
const admin = createClient(url, serviceKey, opts);

// Throwaway accounts (service key only creates/deletes them; every assertion
// runs through the anon key). Removed in afterAll, pass or fail.
const stamp = Date.now();
const password = `Contract-${stamp}-x9`;
const created: string[] = [];

async function account(role: 'student' | 'sheikh'): Promise<SupabaseClient> {
  const email = `contract-0161-${role}-${stamp}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'اختبار', gender: 'male' },
  });
  if (error) throw error;
  created.push(data.user.id);
  if (role === 'sheikh') {
    const { error: e } = await admin.from('profiles').update({ role: 'sheikh' }).eq('id', data.user.id);
    if (e) throw e;
  }
  const c = newClient();
  const { error: se } = await c.auth.signInWithPassword({ email, password });
  if (se) throw se;
  return c;
}

let guest: SupabaseClient;
let student: SupabaseClient;
let sheikh: SupabaseClient;
beforeAll(async () => {
  guest = newClient();
  const { data, error } = await guest.auth.signInAnonymously();
  if (error) throw error;
  created.push(data.user!.id);
  [student, sheikh] = await Promise.all([account('student'), account('sheikh')]);
});
afterAll(async () => {
  await Promise.all([guest, student, sheikh].filter(Boolean).map((c) => c.auth.signOut()));
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe('أسئلة المحاضرات feed', () => {
  test('readable by a guest; rows carry their source lesson', async () => {
    const { data, error } = await guest.rpc('get_lecture_questions_feed');
    expect(error).toBeNull();
    for (const r of data as any[]) {
      expect(r.lecture_id).toBeTruthy();
      expect(r.lecture_title).toBeTruthy();
      expect(r).not.toHaveProperty('asker_id');
    }
  });

  test('the sessionless anon key gets nothing', async () => {
    const { error } = await newClient().rpc('get_lecture_questions_feed');
    expect(error).not.toBeNull();
  });
});

describe('فوائد الدارسين — unified feed', () => {
  test('a guest can read but not post a general benefit', async () => {
    const feed = await guest.rpc('get_benefits_feed', { p_kind: 'all' });
    expect(feed.error).toBeNull();
    const add = await guest.rpc('add_general_benefit', { p_body: 'فائدة من زائر' });
    expect(add.error).not.toBeNull();
  });

  test('a student posts a general benefit: anonymous, in all/general/mine, not in lecture; moderation sees it; delete works', async () => {
    const body = `فائدة عامة لاختبار العقد ${Date.now()}`;
    const { data: id, error } = await student.rpc('add_general_benefit', { p_body: body });
    expect(error).toBeNull();
    try {
      const kinds = ['all', 'general', 'mine', 'lecture'] as const;
      const found: Record<string, any> = {};
      for (const k of kinds) {
        const r = await student.rpc('get_benefits_feed', { p_kind: k });
        expect(r.error).toBeNull();
        found[k] = (r.data as any[]).find((b) => b.id === id);
      }
      expect(found.all).toMatchObject({ body, is_mine: true, lecture_id: null });
      expect(found.all).not.toHaveProperty('user_id');
      expect(found.general).toBeTruthy();
      expect(found.mine).toBeTruthy();
      expect(found.lecture).toBeUndefined();

      // Another viewer sees it too, but never as theirs.
      const g = await guest.rpc('get_benefits_feed', { p_kind: 'general' });
      expect((g.data as any[]).find((b) => b.id === id)).toMatchObject({ is_mine: false });

      // Staff moderation (0081 + LEFT JOIN) lists general benefits.
      const mod = await sheikh.rpc('admin_list_benefits');
      expect(mod.error).toBeNull();
      expect((mod.data as any[]).find((b) => b.id === id)).toMatchObject({ lecture_id: null });

      // A student cannot use the moderation RPC.
      expect((await student.rpc('admin_list_benefits')).error).not.toBeNull();
    } finally {
      const del = await student.rpc('delete_own_benefit', { p_id: id });
      expect(del.error).toBeNull();
    }
    const after = await student.rpc('get_benefits_feed', { p_kind: 'mine' });
    expect((after.data as any[]).find((b) => b.id === id)).toBeUndefined();
  });

  test('length and auth gates match lesson benefits', async () => {
    expect((await student.rpc('add_general_benefit', { p_body: 'ab' })).error).not.toBeNull();
  });
});

describe('استخدام المصحف — aggregate only', () => {
  test('guests and students are counted; nobody can read the table directly', async () => {
    expect((await guest.rpc('touch_mushaf_open')).error).toBeNull();
    expect((await guest.rpc('touch_mushaf_open')).error).toBeNull(); // idempotent per day
    expect((await student.rpc('touch_mushaf_open')).error).toBeNull();

    const direct = await student.from('mushaf_usage').select('*');
    expect(direct.error).not.toBeNull();
    expect((await guest.rpc('admin_mushaf_usage_stats')).error).not.toBeNull();
    expect((await student.rpc('admin_mushaf_usage_stats')).error).not.toBeNull();

    const { data, error } = await sheikh.rpc('admin_mushaf_usage_stats');
    expect(error).toBeNull();
    const s = data as { today: number; d7: number; d30: number; total: number };
    expect(s.today).toBeGreaterThanOrEqual(2);
    expect(s.d7).toBeGreaterThanOrEqual(s.today);
    expect(s.d30).toBeGreaterThanOrEqual(s.d7);
    expect(s.total).toBeGreaterThanOrEqual(s.d30);
    expect(Object.keys(s).sort()).toEqual(['d30', 'd7', 'today', 'total']);
  });
});
