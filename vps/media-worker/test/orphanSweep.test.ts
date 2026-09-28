import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FIRST_SWEEP_DELAY_MS,
  DEFAULT_MIN_AGE_MS,
  DEFAULT_SWEEP_EVERY_MS,
  isDeletable,
  OrphanSweeper,
  type SweepStats,
  sweepIncomingOrphans,
} from '../src/orphanSweep.js';
import { FakeDb, FakeStorage } from './fakes.js';

const NOW = new Date('2026-09-28T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;

let storage: FakeStorage;
let db: FakeDb;

/** Put an object in the fake bucket with an age in hours. */
function put(key: string, ageHours: number | null) {
  storage.objects.set(key, Buffer.from('x'));
  if (ageHours !== null) storage.modified.set(key, new Date(NOW - ageHours * HOUR));
}

const sweep = (over: Partial<Parameters<typeof sweepIncomingOrphans>[0]> = {}) =>
  sweepIncomingOrphans({ storage, db, now: () => NOW, ...over });

beforeEach(() => {
  storage = new FakeStorage();
  db = new FakeDb();
});

describe('sweepIncomingOrphans', () => {
  it('deletes only old (>48 h) incoming/ objects that NO job references', async () => {
    put('incoming/abandoned.m4a', 72); // orphan → deleted
    put('incoming/failed-job.wav', 200); // referenced by a failed job → kept for retry
    put('incoming/queued-job.mp3', 49); // referenced by a queued job → kept
    put('incoming/fresh.m4a', 47); // < 48 h (upload may still be enqueuing) → kept
    put('incoming/no-date.m4a', null); // unknown age → kept
    put('lectures/x/old.mp3', 999); // outside incoming/ → never even listed
    put('live-raw/stg_a.ogg', 999);
    db.jobRows = [
      { input_key: 'incoming/failed-job.wav', status: 'failed' },
      { input_key: 'incoming/queued-job.mp3', status: 'queued' },
    ];

    const stats = await sweep();

    expect(storage.deleted).toEqual(['incoming/abandoned.m4a']);
    expect(stats).toEqual<SweepStats>({ pages: 1, scanned: 5, old: 3, referenced: 2, deleted: 1, doneOnly: 0, deleteFailed: 0 });
    expect(storage.objects.has('lectures/x/old.mp3')).toBe(true);
    expect(storage.objects.has('live-raw/stg_a.ogg')).toBe(true);
  });

  it('deletes an old original whose referencing jobs are ALL done; keeps it if any is queued/running/failed', async () => {
    put('incoming/done-once.m4a', 72); // one done job → MP3 exists → deleted
    put('incoming/done-twice.m4a', 72); // re-uploaded, both done → deleted
    put('incoming/done-and-failed.m4a', 72); // a failed job still needs it → kept
    put('incoming/done-and-running.m4a', 72); // running → kept
    put('incoming/done-and-queued.m4a', 72); // queued retry → kept
    put('incoming/done-fresh.m4a', 10); // done but < 48 h → kept (age rule still applies)
    db.jobRows = [
      { input_key: 'incoming/done-once.m4a', status: 'done' },
      { input_key: 'incoming/done-twice.m4a', status: 'done' },
      { input_key: 'incoming/done-twice.m4a', status: 'done' },
      { input_key: 'incoming/done-and-failed.m4a', status: 'done' },
      { input_key: 'incoming/done-and-failed.m4a', status: 'failed' },
      { input_key: 'incoming/done-and-running.m4a', status: 'running' },
      { input_key: 'incoming/done-and-running.m4a', status: 'done' },
      { input_key: 'incoming/done-and-queued.m4a', status: 'queued' },
      { input_key: 'incoming/done-and-queued.m4a', status: 'done' },
      { input_key: 'incoming/done-fresh.m4a', status: 'done' },
    ];

    const stats = await sweep();

    expect([...storage.deleted].sort()).toEqual(['incoming/done-once.m4a', 'incoming/done-twice.m4a']);
    expect(stats).toMatchObject({ old: 5, referenced: 3, deleted: 2, doneOnly: 2 });
  });

  it('isDeletable: no jobs, or only done jobs', () => {
    expect(isDeletable([])).toBe(true);
    expect(isDeletable(['done', 'done'])).toBe(true);
    for (const s of ['queued', 'running', 'failed'] as const) {
      expect(isDeletable([s])).toBe(false);
      expect(isDeletable(['done', s])).toBe(false);
    }
  });

  it('the age boundary is inclusive at exactly 48 h', async () => {
    put('incoming/edge.m4a', DEFAULT_MIN_AGE_MS / HOUR);
    await sweep();
    expect(storage.deleted).toEqual(['incoming/edge.m4a']);
  });

  it('paginates the listing and chunks the job lookups', async () => {
    for (let i = 0; i < 7; i++) put(`incoming/o${i}.m4a`, 100);
    db.jobRows = [{ input_key: 'incoming/o3.m4a', status: 'running' }];
    storage.pageSize = 3;

    const stats = await sweep({ lookupChunk: 2 });

    expect(storage.listCalls).toBe(3);
    expect(stats).toMatchObject({ pages: 3, scanned: 7, old: 7, referenced: 1, deleted: 6 });
    expect(db.lookups.every((c) => c.length <= 2)).toBe(true);
    expect([...storage.objects.keys()]).toEqual(['incoming/o3.m4a']);
  });

  it('a job lookup error aborts the sweep before deleting that batch', async () => {
    put('incoming/a.m4a', 100);
    put('incoming/b.m4a', 100);
    db.lookupError = new Error('media_jobs input_key lookup failed: timeout');
    await expect(sweep()).rejects.toThrow('lookup failed');
    expect(storage.deleted).toEqual([]);
    expect(storage.objects.size).toBe(2);
  });

  it('counts delete failures and carries on', async () => {
    put('incoming/a.m4a', 100);
    storage.failDelete = true;
    const stats = await sweep();
    expect(stats).toMatchObject({ old: 1, deleted: 0, deleteFailed: 1 });
  });

  it('is a safe no-op on an empty prefix (no lookups, no deletes)', async () => {
    const stats = await sweep();
    expect(stats).toEqual<SweepStats>({ pages: 1, scanned: 0, old: 0, referenced: 0, deleted: 0, doneOnly: 0, deleteFailed: 0 });
    expect(db.lookups).toEqual([]);
  });

  it('never deletes a folder marker or a key outside the prefix even if the listing returns one', async () => {
    storage.listPage = async () => ({
      objects: [
        { key: 'incoming/', lastModified: new Date(0) },
        { key: 'incoming/sub/', lastModified: new Date(0) },
        { key: 'lectures/evil.mp3', lastModified: new Date(0) },
      ],
      next: null,
    });
    const stats = await sweep();
    expect(stats.old).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it('stops listing further pages once aborted (shutdown)', async () => {
    for (let i = 0; i < 4; i++) put(`incoming/o${i}.m4a`, 100);
    storage.pageSize = 2;
    const ac = new AbortController();
    const origDelete = storage.delete.bind(storage);
    storage.delete = async (k) => {
      await origDelete(k);
      ac.abort();
    };
    const stats = await sweep({ signal: ac.signal });
    // the in-flight lookup batch finishes; no further page is listed
    expect(stats.pages).toBe(1);
    expect(stats.deleted).toBe(2);
    expect(storage.objects.size).toBe(2);
  });
});

describe('OrphanSweeper schedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const ok: SweepStats = { pages: 1, scanned: 0, old: 0, referenced: 0, deleted: 0, doneOnly: 0, deleteFailed: 0 };

  it('runs once shortly after start, then every 6 h, logging counts only', async () => {
    const run = vi.fn(async () => ok);
    const lines: Array<[string, Record<string, unknown> | undefined]> = [];
    const s = new OrphanSweeper(run, { log: (_l, e, f) => void lines.push([e, f]) });
    s.start();

    await vi.advanceTimersByTimeAsync(DEFAULT_FIRST_SWEEP_DELAY_MS - 1);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_SWEEP_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(2);

    expect(lines[0]?.[0]).toBe('sweep.done');
    expect(Object.keys(lines[0]?.[1] ?? {})).toEqual([
      'prefix', 'pages', 'scanned', 'old', 'referenced', 'deleted', 'done_only', 'delete_failed', 'ms',
    ]);
    await s.stop();
  });

  it('never overlaps itself and logs (does not throw) sweep errors', async () => {
    let release!: () => void;
    const run = vi.fn(
      () =>
        new Promise<SweepStats>((resolve, reject) => {
          release = () => reject(new Error('R2 list failed'));
          void resolve;
        }),
    );
    const events: string[] = [];
    const s = new OrphanSweeper(run, { log: (_l, e) => void events.push(e) });
    const first = s.runOnce();
    void s.runOnce(); // overlapping call is coalesced
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(events).toEqual(['sweep.error']);
    await s.stop();
  });

  it('stop() cancels future runs', async () => {
    const run = vi.fn(async () => ok);
    const s = new OrphanSweeper(run);
    s.start();
    await s.stop();
    await vi.advanceTimersByTimeAsync(DEFAULT_SWEEP_EVERY_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });
});
