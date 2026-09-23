/**
 * src/api/backup.ts — «النسخ الاحتياطي» must export whole tables.
 *
 * The bug this pins: the loop used to stop when a page came back smaller than
 * requested. PostgREST caps every response at `max_rows` (1000 on this
 * project), so asking for 2000 always returned 1000 — and every table over
 * 1000 rows was written to the ZIP with only its first 1000 rows, with no
 * error anywhere. A backup that looks fine but silently drops 99% of
 * notifications is worse than one that fails, so the "short page" heuristic is
 * gone for good: only an empty page ends a table.
 */
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/config', () => ({ USE_MOCK: false }));
// client-zip ships ESM only; nothing here builds a ZIP, so stub the import out.
jest.mock('client-zip', () => ({ makeZip: jest.fn() }));

import { collectTableJsonl } from '@/api/backup';

type Row = { pk: string; row_json: unknown };

/** A fake server holding `total` rows that never returns more than `cap` (max_rows). */
function fakeTable(total: number, cap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  return async (_table: string, after: string | null): Promise<Row[]> => {
    const start = after === null ? 0 : Number(JSON.parse(after)[0]);
    return rows.slice(start, start + cap).map((r) => ({
      pk: JSON.stringify([String(r.id)]),
      row_json: r,
    }));
  };
}

const lines = (jsonl: string) => (jsonl ? jsonl.trimEnd().split('\n') : []);

test('a table larger than the server row cap is exported IN FULL, not truncated to one page', async () => {
  const jsonl = await collectTableJsonl('notifications', fakeTable(3500));
  const out = lines(jsonl);
  expect(out).toHaveLength(3500);
  // and in order, with nothing skipped between pages — the old cursor bug
  expect(JSON.parse(out[0])).toEqual({ id: 1 });
  expect(JSON.parse(out[999])).toEqual({ id: 1000 });
  expect(JSON.parse(out[1000])).toEqual({ id: 1001 }); // page 2 starts where page 1 ended
  expect(JSON.parse(out[3499])).toEqual({ id: 3500 });
  expect(new Set(out).size).toBe(3500); // no duplicates either
});

test('a table that fits in one page still exports exactly once', async () => {
  const jsonl = await collectTableJsonl('lectures', fakeTable(237));
  expect(lines(jsonl)).toHaveLength(237);
});

test('an exact multiple of the page size is not cut short', async () => {
  const jsonl = await collectTableJsonl('profiles', fakeTable(2000));
  expect(lines(jsonl)).toHaveLength(2000);
});

test('an empty table yields an empty file', async () => {
  expect(await collectTableJsonl('push_tokens', fakeTable(0))).toBe('');
});

test('a cursor that never advances fails loudly instead of looping forever', async () => {
  const stuck = async (): Promise<Row[]> => [{ pk: '["1"]', row_json: { id: 1 } }];
  await expect(collectTableJsonl('notifications', stuck)).rejects.toThrow(/لم يتقدّم مؤشّر التصدير/);
});
