import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RawRetention, type RetentionStats, sweepLiveRaws } from '../src/rawRetention.js';
import { RecordingsDir } from '../src/recordings.js';
import { FakeDb, FakeStorage } from './fakes.js';

let root: string;
let stg: string;
let db: FakeDb;
let storage: FakeStorage;
let events: string[];

const RAW = Buffer.from('OggS-a-live-recording');

async function localRaw(name: string, bytes: Buffer = RAW): Promise<string> {
  const p = join(stg, name);
  await writeFile(p, bytes);
  return p;
}
const exists = async (p: string) =>
  readFile(p).then(
    () => true,
    () => false,
  );
const sweep = () =>
  sweepLiveRaws({ db, storage, recordings: new RecordingsDir(stg), log: (_l, e) => void events.push(e) });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mw-ret-'));
  stg = join(root, 'recordings', 'stg');
  await mkdir(stg, { recursive: true });
  await mkdir(join(root, 'recordings', 'prd'), { recursive: true });
  db = new FakeDb();
  storage = new FakeStorage();
  events = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('sweepLiveRaws', () => {
  it('deletes the local raw ONLY when the R2 backup exists with the same size, then stamps it', async () => {
    const p = await localRaw('stg_a-1.ogg');
    storage.objects.set('live-raw/stg_a-1.ogg', Buffer.from(RAW));
    db.rawsDue = [{ sessionId: 's1', rawPath: p, rawBackupKey: 'live-raw/stg_a-1.ogg' }];

    const stats = await sweep();

    expect(await exists(p)).toBe(false);
    expect(db.markedRawDeleted).toEqual(['s1']);
    expect(stats).toEqual<RetentionStats>({ due: 1, deleted: 1, stampedMissing: 0, kept: 0, refused: 0, errors: 0 });
    expect(storage.objects.has('live-raw/stg_a-1.ogg')).toBe(true); // the backup is never touched
  });

  it('keeps the raw when the backup is missing, has a different size, or there is no backup key', async () => {
    const a = await localRaw('a.ogg');
    const b = await localRaw('b.ogg');
    const c = await localRaw('c.ogg');
    storage.objects.set('live-raw/b.ogg', Buffer.from('truncated'));
    db.rawsDue = [
      { sessionId: 'sa', rawPath: a, rawBackupKey: 'live-raw/a.ogg' },
      { sessionId: 'sb', rawPath: b, rawBackupKey: 'live-raw/b.ogg' },
      { sessionId: 'sc', rawPath: c, rawBackupKey: null },
    ];

    const stats = await sweep();

    expect(await exists(a)).toBe(true);
    expect(await exists(b)).toBe(true);
    expect(await exists(c)).toBe(true);
    expect(db.markedRawDeleted).toEqual([]);
    expect(stats).toMatchObject({ due: 3, deleted: 0, kept: 3 });
    expect(events.filter((e) => e === 'raw_retention.kept')).toHaveLength(3);
  });

  it('never touches a path outside RECORDINGS_DIR (other env, "..", relative)', async () => {
    const prd = join(root, 'recordings', 'prd', 'p.ogg');
    await writeFile(prd, RAW);
    storage.objects.set('live-raw/p.ogg', Buffer.from(RAW));
    db.rawsDue = [
      { sessionId: 's1', rawPath: prd, rawBackupKey: 'live-raw/p.ogg' },
      { sessionId: 's2', rawPath: `${stg}/../prd/p.ogg`, rawBackupKey: 'live-raw/p.ogg' },
      { sessionId: 's3', rawPath: 'p.ogg', rawBackupKey: 'live-raw/p.ogg' },
    ];

    const stats = await sweep();

    expect(await exists(prd)).toBe(true);
    expect(db.markedRawDeleted).toEqual([]);
    expect(stats).toMatchObject({ refused: 3, deleted: 0 });
  });

  it('refuses a symlink escaping RECORDINGS_DIR (the target survives)', async (ctx) => {
    const prdDir = join(root, 'recordings', 'prd');
    await writeFile(join(prdDir, 'p.ogg'), RAW);
    try {
      await symlink(prdDir, join(stg, 'escape'), 'junction');
    } catch {
      ctx.skip();
    }
    storage.objects.set('live-raw/p.ogg', Buffer.from(RAW));
    db.rawsDue = [{ sessionId: 's1', rawPath: join(stg, 'escape', 'p.ogg'), rawBackupKey: 'live-raw/p.ogg' }];
    const stats = await sweep();
    expect(stats.refused).toBe(1);
    expect(await exists(join(prdDir, 'p.ogg'))).toBe(true);
  });

  it('local file already gone + backup present → stamp only (recovers a failed stamp); no backup → keep row', async () => {
    storage.objects.set('live-raw/gone.ogg', Buffer.from(RAW));
    db.rawsDue = [
      { sessionId: 's1', rawPath: join(stg, 'gone.ogg'), rawBackupKey: 'live-raw/gone.ogg' },
      { sessionId: 's2', rawPath: join(stg, 'lost.ogg'), rawBackupKey: 'live-raw/lost.ogg' },
    ];
    const stats = await sweep();
    expect(db.markedRawDeleted).toEqual(['s1']);
    expect(stats).toMatchObject({ stampedMissing: 1, kept: 1 });
    expect(events).toContain('raw_retention.local_and_backup_missing');
  });

  it('an R2 error on one row is counted and the sweep carries on', async () => {
    const a = await localRaw('a.ogg');
    const b = await localRaw('b.ogg');
    storage.objects.set('live-raw/b.ogg', Buffer.from(RAW));
    db.rawsDue = [
      { sessionId: 'sa', rawPath: a, rawBackupKey: 'live-raw/a.ogg' },
      { sessionId: 'sb', rawPath: b, rawBackupKey: 'live-raw/b.ogg' },
    ];
    let calls = 0;
    const orig = storage.objectSize.bind(storage);
    storage.objectSize = async (k) => {
      if (calls++ === 0) throw new Error('R2 timeout');
      return orig(k);
    };
    const stats = await sweep();
    expect(stats).toMatchObject({ errors: 1, deleted: 1 });
    expect(await exists(a)).toBe(true);
    expect(await exists(b)).toBe(false);
  });

  it('a delete refused at re-validation is an error — never stamped as deleted', async () => {
    const p = await localRaw('a.ogg');
    storage.objects.set('live-raw/a.ogg', Buffer.from(RAW));
    db.rawsDue = [{ sessionId: 'sa', rawPath: p, rawBackupKey: 'live-raw/a.ogg' }];
    const real = new RecordingsDir(stg);
    const stats = await sweepLiveRaws({
      db,
      storage,
      recordings: { check: (x) => real.check(x), delete: async () => false },
    });
    expect(stats).toMatchObject({ deleted: 0, errors: 1 });
    expect(db.markedRawDeleted).toEqual([]);
    expect(await exists(p)).toBe(true);
  });

  it('nothing due → no-op', async () => {
    expect(await sweep()).toEqual<RetentionStats>({ due: 0, deleted: 0, stampedMissing: 0, kept: 0, refused: 0, errors: 0 });
  });
});

describe('sweepLiveRaws — recording parts (0146)', () => {
  it('each part is deleted only against its own verified backup and stamped with mark_live_part_raw_deleted', async () => {
    const a = await localRaw('stg_r-1-recovered.ogg');
    const b = await localRaw('stg_r-2.ogg');
    storage.objects.set('live-raw/stg_r-1-recovered.ogg', Buffer.from(RAW));
    storage.objects.set('live-raw/stg_r-2.ogg', Buffer.from('short')); // size mismatch → keep
    db.partRawsDue = [
      { sessionId: 's1', seq: 1, rawPath: a, rawBackupKey: 'live-raw/stg_r-1-recovered.ogg' },
      { sessionId: 's1', seq: 2, rawPath: b, rawBackupKey: 'live-raw/stg_r-2.ogg' },
    ];
    const stats = await sweep();
    expect(stats).toMatchObject({ due: 2, deleted: 1, kept: 1, errors: 0 });
    expect(db.partRawsDeleted).toEqual([{ session: 's1', seq: 1 }]);
    expect(db.markedRawDeleted).toEqual([]);
    expect(await exists(a)).toBe(false);
    expect(await exists(b)).toBe(true);
  });

  it('a failing parts RPC (e.g. 0146 not applied yet) never blocks the session-level rows', async () => {
    const p = await localRaw('stg_a-1.ogg');
    storage.objects.set('live-raw/stg_a-1.ogg', Buffer.from(RAW));
    db.rawsDue = [{ sessionId: 's1', rawPath: p, rawBackupKey: 'live-raw/stg_a-1.ogg' }];
    db.partRawsDueError = new Error('live_part_raws_due_for_deletion failed [PGRST202]');
    const stats = await sweep();
    expect(stats).toMatchObject({ due: 1, deleted: 1, errors: 1 });
    expect(db.markedRawDeleted).toEqual(['s1']);
    expect(events).toContain('raw_retention.parts_error');
  });

  it('a part path outside RECORDINGS_DIR is refused, never touched', async () => {
    const prd = join(root, 'recordings', 'prd', 'prd_x-1.ogg');
    await writeFile(prd, RAW);
    db.partRawsDue = [{ sessionId: 's1', seq: 1, rawPath: prd, rawBackupKey: 'live-raw/prd_x-1.ogg' }];
    storage.objects.set('live-raw/prd_x-1.ogg', Buffer.from(RAW));
    expect(await sweep()).toMatchObject({ refused: 1, deleted: 0 });
    expect(await exists(prd)).toBe(true);
  });
});

describe('RawRetention schedule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once right after start and then every 30 min; logs counts only', async () => {
    const lines: Array<[string, Record<string, unknown> | undefined]> = [];
    const run = vi.fn(async () => ({ due: 2, deleted: 1, stampedMissing: 0, kept: 1, refused: 0, errors: 0 }));
    const r = new RawRetention(run, { log: (_l, e, f) => void lines.push([e, f]) });
    r.start();
    await vi.advanceTimersByTimeAsync(15 * 1000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(lines[0]?.[0]).toBe('raw_retention.done');
    expect(Object.keys(lines[0]?.[1] ?? {})).toEqual(['due', 'deleted', 'stamped_missing', 'kept', 'refused', 'errors', 'ms']);
    await r.stop();
  });

  it('an RPC error is logged, never thrown', async () => {
    const events2: string[] = [];
    db.rawsDueError = new Error('live_raws_due_for_deletion failed');
    const r = new RawRetention(
      (signal) => sweepLiveRaws({ db, storage, recordings: new RecordingsDir(stg), signal }),
      { log: (_l, e) => void events2.push(e) },
    );
    await r.runOnce();
    expect(events2).toEqual(['raw_retention.error']);
    await r.stop();
  });
});
