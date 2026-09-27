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

import { collectTableJsonl, collectTableJsonlChunked, type ExportChunk } from '@/api/backup';

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

// ─── Chunked export (0128) — ~5× fewer round trips, same completeness rules ───

/** A fake export_table_chunk: `size` rows per chunk as one JSONL string. */
function fakeChunks(total: number, size = 5000) {
  return async (_table: string, after: string | null): Promise<ExportChunk> => {
    const start = after === null ? 0 : Number(JSON.parse(after)[0]);
    const ids = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => start + i + 1);
    return {
      rows: ids.length,
      next: ids.length ? JSON.stringify([String(ids[ids.length - 1])]) : null,
      jsonl: ids.map((id) => JSON.stringify({ id })).join('\n'),
    };
  };
}

test('chunked export returns every row, in order, across chunks', async () => {
  const out = lines(await collectTableJsonlChunked('notifications', fakeChunks(12_345)));
  expect(out).toHaveLength(12_345);
  expect(JSON.parse(out[4999])).toEqual({ id: 5000 });
  expect(JSON.parse(out[5000])).toEqual({ id: 5001 }); // chunk 2 starts where chunk 1 ended
  expect(JSON.parse(out[12_344])).toEqual({ id: 12_345 });
  expect(new Set(out).size).toBe(12_345);
});

test('chunked export: exact multiple of the chunk size and empty tables', async () => {
  expect(lines(await collectTableJsonlChunked('profiles', fakeChunks(10_000)))).toHaveLength(10_000);
  expect(await collectTableJsonlChunked('push_tokens', fakeChunks(0))).toBe('');
});

test('chunked export: a stuck cursor fails loudly', async () => {
  const stuck = async (): Promise<ExportChunk> => ({ rows: 1, next: '["1"]', jsonl: '{"id":1}' });
  await expect(collectTableJsonlChunked('notifications', stuck)).rejects.toThrow(/لم يتقدّم مؤشّر التصدير/);
});
