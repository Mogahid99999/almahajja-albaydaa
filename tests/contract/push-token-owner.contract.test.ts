/**
 * Contract test for migration 0171, STAGING: one device token, one account.
 * Accounts are «تجربة» and deleted in afterAll.
 */
import { randomUUID } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.STAGING_EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.STAGING_EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey =
  process.env.STAGING_SUPABASE_SECRET_KEY || process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service: SupabaseClient = createClient(url, serviceKey, opts);

const ids: string[] = [];
async function account(): Promise<{ c: SupabaseClient; id: string }> {
  const email = `tajriba-token-${randomUUID()}@example.com`;
  const password = `Tajriba-${randomUUID()}`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  ids.push(data.user.id);
  const c = createClient(url, anonKey, opts);
  await c.auth.signInWithPassword({ email, password });
  return { c, id: data.user.id };
}
const newToken = () => `ExponentPushToken[tajriba-${randomUUID()}]`;
const upsert = (c: SupabaseClient, user_id: string, token: string) =>
  c.from('push_tokens').upsert(
    { user_id, token, platform: 'android', updated_at: new Date().toISOString() },
    { onConflict: 'user_id,token' },
  );
const owners = async (token: string) =>
  (await service.from('push_tokens').select('user_id').eq('token', token)).data?.map((r) => r.user_id);

afterAll(async () => {
  for (const id of ids) await service.auth.admin.deleteUser(id);
});

describe('push_tokens: 0171', () => {
  let a: { c: SupabaseClient; id: string };
  let b: { c: SupabaseClient; id: string };
  beforeAll(async () => {
    a = await account();
    b = await account();
  });

  it('moves a token to the account that registers it last', async () => {
    const t = newToken();
    expect((await upsert(a.c, a.id, t)).error).toBeNull();
    expect((await upsert(b.c, b.id, t)).error).toBeNull();
    expect(await owners(t)).toEqual([b.id]);
  });

  it('keeps separate devices of one account, and refreshing keeps the row', async () => {
    const t1 = newToken();
    const t2 = newToken();
    await upsert(a.c, a.id, t1);
    await upsert(a.c, a.id, t2);
    expect((await upsert(a.c, a.id, t1)).error).toBeNull();
    expect(await owners(t1)).toEqual([a.id]);
    expect(await owners(t2)).toEqual([a.id]);
  });

  it('still refuses registering a token for someone else', async () => {
    const t = newToken();
    expect((await upsert(a.c, b.id, t)).error).not.toBeNull();
    expect(await owners(t)).toEqual([]);
  });
});
