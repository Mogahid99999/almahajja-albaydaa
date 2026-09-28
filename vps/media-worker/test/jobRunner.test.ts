import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type JobRunnerDeps, runJob } from '../src/jobRunner.js';
import { RecordingsDir } from '../src/recordings.js';
import { FakeDb, FakeMedia, FakeStorage, makeJob } from './fakes.js';

let tmpDir: string;
let recRoot: string;
let recDir: string;
let outsideDir: string;
let db: FakeDb;
let storage: FakeStorage;
let media: FakeMedia;

const deps = (over: Partial<JobRunnerDeps> = {}): JobRunnerDeps => ({
  db,
  storage,
  media,
  recordings: new RecordingsDir(recDir),
  tmpDir,
  liveLoudnorm: false,
  reporter: { minIntervalMs: 0 },
  ...over,
});

const tmpIsEmpty = async () => expect(await readdir(tmpDir)).toEqual([]);

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mw-test-'));
  recRoot = await mkdtemp(join(tmpdir(), 'mw-rec-'));
  recDir = join(recRoot, 'recordings', 'stg');
  outsideDir = join(recRoot, 'recordings', 'prd');
  await mkdir(recDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  db = new FakeDb();
  storage = new FakeStorage();
  media = new FakeMedia();
  storage.objects.set('incoming/5f0c.m4a', Buffer.from('original-audio'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  await rm(recRoot, { recursive: true, force: true });
});

describe('lecture_transcode', () => {
  it('success → MP3 at the lecture key, complete RPC, original deleted, temp cleaned', async () => {
    const out = await runJob(makeJob(), deps());

    const key = 'lectures/كتاب التوحيد/الدرس الأول.mp3';
    expect(out).toMatchObject({ status: 'done', outputKey: key, durationSec: 30 });
    expect(storage.uploads.map((u) => [u.key, u.contentType])).toEqual([[key, 'audio/mpeg']]);
    expect(db.completed).toEqual([{ jobId: 'job-1', key, durationSec: 30, size: storage.objects.get(key)!.length }]);
    expect(storage.deleted).toEqual(['incoming/5f0c.m4a']);
    expect(db.failed).toEqual([]);
    // progress only moves forward, stays < 1 (1 is the RPC's), and stops before complete
    expect(db.progress.length).toBeGreaterThan(0);
    expect([...db.progress].sort((a, b) => a - b)).toEqual(db.progress);
    expect(Math.max(...db.progress)).toBeLessThan(1);
    expect(db.calls.lastIndexOf('progress')).toBeLessThan(db.calls.indexOf('complete'));
    // speech profile, no loudnorm for uploads
    expect(media.transcodes[0]).toMatchObject({ loudnorm: false, durationSec: 30 });
    expect(media.transcodes[0]!.input.endsWith('.m4a')).toBe(true);
    await tmpIsEmpty();
  });

  it('name collision with an existing lecture → " (2)"', async () => {
    storage.objects.set('lectures/كتاب التوحيد/الدرس الأول.mp3', Buffer.from('older upload'));
    const out = await runJob(makeJob(), deps());
    expect(out).toMatchObject({ status: 'done', outputKey: 'lectures/كتاب التوحيد/الدرس الأول (2).mp3' });
    expect(storage.objects.get('lectures/كتاب التوحيد/الدرس الأول.mp3')?.toString()).toBe('older upload');
  });

  it('unclassified lecture lands under lectures/_unclassified/', async () => {
    db.naming = { lectureId: 'lec-1', title: 'مجلس', sectionTitle: null };
    const out = await runJob(makeJob(), deps());
    expect(out).toMatchObject({ outputKey: 'lectures/_unclassified/مجلس.mp3' });
  });

  it('ffmpeg failure → fail_media_job, original KEPT, nothing uploaded, temp cleaned', async () => {
    media = new FakeMedia('fail');
    const out = await runJob(makeJob(), deps());

    expect(out.status).toBe('retry');
    expect(db.failed).toHaveLength(1);
    expect(db.failed[0]!.error).toContain('ffmpeg exited with code 1');
    expect(storage.objects.has('incoming/5f0c.m4a')).toBe(true);
    expect(storage.deleted).toEqual([]);
    expect(storage.uploads).toEqual([]);
    expect(db.completed).toEqual([]);
    await tmpIsEmpty();
  });

  it("returns the RPC's terminal verdict ('failed' after the last attempt)", async () => {
    media = new FakeMedia('fail');
    db.failResult = 'failed';
    const out = await runJob(makeJob({ attempts: 3 }), deps());
    expect(out.status).toBe('failed');
  });

  it('complete RPC failure → fail_media_job and the original is kept', async () => {
    db.completeError = new Error('complete_lecture_transcode failed: boom');
    const out = await runJob(makeJob(), deps());
    expect(out.status).toBe('retry');
    expect(db.failed[0]!.error).toContain('boom');
    expect(storage.deleted).toEqual([]);
    await tmpIsEmpty();
  });

  it('missing input object → fail_media_job (message from R2), temp cleaned', async () => {
    storage.objects.clear();
    const out = await runJob(makeJob(), deps());
    expect(out.status).toBe('retry');
    expect(db.failed[0]!.error).toContain('does not exist');
    expect(media.transcodes).toEqual([]);
    await tmpIsEmpty();
  });

  it('job without lecture_id fails fast without downloading', async () => {
    const out = await runJob(makeJob({ lecture_id: null }), deps());
    expect(out.status).toBe('retry');
    expect(db.failed[0]!.error).toContain('no lecture_id');
    expect(media.transcodes).toEqual([]);
  });

  it('never deletes an input outside incoming/', async () => {
    storage.objects.set('lectures/x/old.wav', Buffer.from('wav'));
    const out = await runJob(makeJob({ input_key: 'lectures/x/old.wav' }), deps());
    expect(out.status).toBe('done');
    expect(storage.deleted).toEqual([]);
  });

  it('a failed delete of the original does not fail a completed job', async () => {
    storage.failDelete = true;
    const out = await runJob(makeJob(), deps());
    expect(out.status).toBe('done');
    expect(db.failed).toEqual([]);
  });

  it('truncates long error messages before fail_media_job', async () => {
    db.completeError = new Error('x'.repeat(5000));
    await runJob(makeJob(), deps());
    expect(db.failed[0]!.error.length).toBeLessThanOrEqual(500);
  });

  it('shutdown (abort) mid-ffmpeg → no fail RPC, job left for re-claim, original kept, temp cleaned', async () => {
    media = new FakeMedia('hang');
    const ac = new AbortController();
    const running = runJob(makeJob(), deps(), ac.signal);
    await media.entered;
    ac.abort();
    const out = await running;

    expect(out).toEqual({ status: 'aborted' });
    expect(db.failed).toEqual([]);
    expect(db.completed).toEqual([]);
    expect(storage.objects.has('incoming/5f0c.m4a')).toBe(true);
    await tmpIsEmpty();
  });
});

describe('contract 0133: touch_media_job / fail → ignored', () => {
  it('touch returns false (job no longer running) → abort cleanly: no fail RPC, no complete, original kept', async () => {
    db.touchResult = false;
    media = new FakeMedia('hang'); // only the lost-job abort can end this run
    const out = await runJob(makeJob(), deps());
    expect(out).toEqual({ status: 'lost' });
    expect(db.failed).toEqual([]);
    expect(db.completed).toEqual([]);
    expect(storage.objects.has('incoming/5f0c.m4a')).toBe(true);
    await tmpIsEmpty();
  });

  it('lost right after the upload → never committed, and the uncommitted MP3 is removed', async () => {
    db.touchJob = async (_id, p) => {
      db.progress.push(p);
      return p < 0.96; // the job disappears during the upload phase
    };
    const out = await runJob(makeJob(), deps());
    expect(out).toEqual({ status: 'lost' });
    expect(db.completed).toEqual([]);
    expect(db.failed).toEqual([]);
    expect(storage.uploads).toHaveLength(1);
    expect(storage.deleted).toEqual(['lectures/كتاب التوحيد/الدرس الأول.mp3']);
    expect(storage.objects.has('incoming/5f0c.m4a')).toBe(true);
  });

  it("fail_media_job → 'ignored' is logged and the run ends (no retry assumed)", async () => {
    media = new FakeMedia('fail');
    db.failResult = 'ignored';
    const events: string[] = [];
    const out = await runJob(makeJob(), deps({ log: (_l, e) => void events.push(e) }));
    expect(out.status).toBe('ignored');
    expect(events).toContain('job.fail_ignored');
    expect(storage.objects.has('incoming/5f0c.m4a')).toBe(true);
  });

  it('passes a null duration through when neither input nor output could be probed', async () => {
    media = new FakeMedia('ok', null);
    const out = await runJob(makeJob(), deps());
    expect(out.status).toBe('done');
    expect(db.completed[0]!.durationSec).toBeNull();
  });
});

describe('watchdog', () => {
  it('a wedged job is aborted and FAILED (not left running forever by its own heartbeat)', async () => {
    media = new FakeMedia('hang');
    const out = await runJob(makeJob(), deps({ maxJobMs: 50 }));
    expect(out.status).toBe('retry');
    expect(db.failed[0]!.error).toContain('timed out');
    expect(storage.objects.has('incoming/5f0c.m4a')).toBe(true);
    await tmpIsEmpty();
  });
});

describe('live_recording (P2: local raw, never lost)', () => {
  const RAW_NAME = 'stg_abc123-2026-09-28T190000.ogg';
  const RAW_BYTES = Buffer.from('OggS-fake-live-raw-bytes');
  let rawPath: string;
  const liveJob = (over: Parameters<typeof makeJob>[0] = {}) =>
    makeJob({ kind: 'live_recording', lecture_id: null, input_key: rawPath, live_session_id: 'sess-1', ...over });
  const rawStillThere = async () => expect(await readFile(rawPath)).toEqual(RAW_BYTES);

  beforeEach(async () => {
    rawPath = join(recDir, RAW_NAME);
    await writeFile(rawPath, RAW_BYTES);
  });

  const rawGone = async () =>
    expect(
      await readFile(rawPath).then(
        () => 'present',
        () => 'gone',
      ),
    ).toBe('gone');

  it('reads the raw IN PLACE, names via live_job_naming, uploads MP3 + raw backup, then create_live_lecture', async () => {
    const realRaw = await realpathOf(rawPath); // before the job deletes it
    const out = await runJob(liveJob(), deps());

    const mp3 = 'lectures/السيرة النبوية/مجلس الخميس.mp3';
    const backup = `live-raw/${RAW_NAME}`;
    expect(out).toMatchObject({ status: 'done', outputKey: mp3, rawBackupKey: backup });
    // no download of the raw; ffmpeg read the local file itself
    expect(media.transcodes[0]!.input).toBe(realRaw);
    expect(storage.uploads.map((u) => [u.key, u.contentType])).toEqual([
      [mp3, 'audio/mpeg'],
      [backup, 'audio/ogg'],
    ]);
    expect(storage.objects.get(backup)).toEqual(RAW_BYTES);
    expect(db.liveCreated).toEqual([
      { jobId: 'job-1', key: mp3, durationSec: 30, size: storage.objects.get(mp3)!.length, backup },
    ]);
    // order: naming → create_live_lecture → (verified) local delete + mark
    expect(db.calls.indexOf('live_naming')).toBeLessThan(db.calls.indexOf('create_live_lecture'));
    expect(db.calls.indexOf('create_live_lecture')).toBeLessThan(db.calls.indexOf('mark_live_raw_deleted'));
    // amended owner rule: local raw deleted once the R2 copy is confirmed; R2 backup kept
    expect(out).toMatchObject({ localRawDeleted: true });
    await rawGone();
    expect(db.markedRawDeleted).toEqual(['sess-1']);
    expect(storage.objects.get(backup)).toEqual(RAW_BYTES);
    expect(storage.deleted).toEqual([]);
    await tmpIsEmpty();
  });

  it('keeps the local raw when the R2 backup size does not match after the lecture is created (raw.keep)', async () => {
    const events: Array<[string, Record<string, unknown> | undefined]> = [];
    const orig = storage.objectSize.bind(storage);
    let n = 0;
    storage.objectSize = async (k) => (k.startsWith('live-raw/') && n++ > 0 ? 3 : orig(k)); // 2nd look = verification
    const out = await runJob(liveJob(), deps({ log: (_l, e, f) => void events.push([e, f]) }));
    expect(out).toMatchObject({ status: 'done', localRawDeleted: false });
    await rawStillThere();
    expect(db.markedRawDeleted).toEqual([]);
    expect(events.find(([e]) => e === 'raw.keep')?.[1]).toMatchObject({ reason: 'backup_size_mismatch' });
  });

  it('keeps the local raw when the backup is missing or the MP3 is not in R2', async () => {
    const orig = storage.objectSize.bind(storage);
    let n = 0;
    storage.objectSize = async (k) => (k.startsWith('live-raw/') && n++ > 0 ? null : orig(k));
    expect(await runJob(liveJob(), deps())).toMatchObject({ status: 'done', localRawDeleted: false });
    await rawStillThere();

    storage.objectSize = orig;
    storage.exists = async () => false; // naming sees free keys; verification sees no MP3
    const reasons: unknown[] = [];
    await runJob(liveJob(), deps({ log: (_l, e, f) => void (e === 'raw.keep' && reasons.push(f?.reason)) }));
    expect(reasons).toEqual(['mp3_missing']);
    await rawStillThere();
  });

  it('keeps the local raw when the job has no live_session_id', async () => {
    const out = await runJob(liveJob({ live_session_id: null }), deps());
    expect(out).toMatchObject({ status: 'done', localRawDeleted: false });
    await rawStillThere();
  });

  it('a mark_live_raw_deleted failure after a good job does NOT fail the job (the sweep stamps it later)', async () => {
    db.markError = new Error('mark_live_raw_deleted failed: timeout');
    const events: string[] = [];
    const out = await runJob(liveJob(), deps({ log: (_l, e) => void events.push(e) }));
    expect(out).toMatchObject({ status: 'done', localRawDeleted: true });
    expect(db.failed).toEqual([]);
    expect(events).toContain('raw.mark_failed');
  });

  it('a local delete error after a good job does NOT fail the job; the raw is kept', async () => {
    const real = new RecordingsDir(recDir);
    const out = await runJob(
      liveJob(),
      deps({
        recordings: {
          check: (p) => real.check(p),
          delete: async () => {
            throw new Error('EACCES: permission denied');
          },
        },
      }),
    );
    expect(out).toMatchObject({ status: 'done', localRawDeleted: false });
    expect(db.failed).toEqual([]);
    await rawStillThere();
  });

  it('skips the backup upload when an object of the same size is already in R2 (retry)', async () => {
    storage.objects.set(`live-raw/${RAW_NAME}`, Buffer.from(RAW_BYTES));
    const out = await runJob(liveJob(), deps());
    expect(out.status).toBe('done');
    expect(storage.uploads.map((u) => u.key)).toEqual(['lectures/السيرة النبوية/مجلس الخميس.mp3']);
    expect(db.liveCreated[0]!.backup).toBe(`live-raw/${RAW_NAME}`);
  });

  it('re-uploads a backup whose size differs (partial earlier upload)', async () => {
    storage.objects.set(`live-raw/${RAW_NAME}`, Buffer.from('short'));
    await runJob(liveJob(), deps());
    expect(storage.uploads.map((u) => u.key)).toContain(`live-raw/${RAW_NAME}`);
    expect(storage.objects.get(`live-raw/${RAW_NAME}`)).toEqual(RAW_BYTES);
  });

  it('name collision → " (2)" like any lecture', async () => {
    storage.objects.set('lectures/السيرة النبوية/مجلس الخميس.mp3', Buffer.from('older'));
    const out = await runJob(liveJob(), deps());
    expect(out).toMatchObject({ outputKey: 'lectures/السيرة النبوية/مجلس الخميس (2).mp3' });
  });

  it('ffmpeg failure → fail_media_job; the raw stays; nothing created', async () => {
    media = new FakeMedia('fail');
    const out = await runJob(liveJob(), deps());
    expect(out.status).toBe('retry');
    expect(db.failed[0]!.error).toContain('ffmpeg exited');
    expect(db.liveCreated).toEqual([]);
    await rawStillThere();
    await tmpIsEmpty();
  });

  it('backup upload failure → fail_media_job (the lecture is not created without a backup); raw stays', async () => {
    storage.failUploadPrefix = 'live-raw/';
    const out = await runJob(liveJob(), deps());
    expect(out.status).toBe('retry');
    expect(db.failed[0]!.error).toContain('upload failed');
    expect(db.liveCreated).toEqual([]);
    await rawStillThere();
  });

  it('create_live_lecture failure → fail_media_job; raw stays', async () => {
    db.completeError = new Error('create_live_lecture failed: boom');
    const out = await runJob(liveJob(), deps());
    expect(out.status).toBe('retry');
    await rawStillThere();
  });

  it('missing raw → fail_media_job, nothing uploaded', async () => {
    const out = await runJob(liveJob({ input_key: join(recDir, 'nope.ogg') }), deps());
    expect(out.status).toBe('retry');
    expect(db.failed[0]!.error).toContain('live raw is not usable (missing)');
    expect(storage.uploads).toEqual([]);
  });

  it('refuses a raw outside RECORDINGS_DIR (other env / ".." / relative) without touching it', async () => {
    const foreign = join(outsideDir, 'prd_x.ogg');
    await writeFile(foreign, 'prd raw');
    for (const input of [foreign, `${recDir}/../prd/prd_x.ogg`, 'stg_abc.ogg']) {
      db.failed = [];
      const out = await runJob(liveJob({ input_key: input }), deps());
      expect(out.status).toBe('retry');
      expect(db.failed[0]!.error).toMatch(/live raw is not usable \((outside|invalid)\)/);
    }
    expect(media.transcodes).toEqual([]);
    expect(await readFile(foreign, 'utf8')).toBe('prd raw');
  });

  it('refuses a symlink that escapes RECORDINGS_DIR', async (ctx) => {
    const foreign = join(outsideDir, 'secret.ogg');
    await writeFile(foreign, 'x');
    // a directory link works on Windows without privileges ('junction'); plain symlink on Linux
    try {
      await symlink(outsideDir, join(recDir, 'escape'), 'junction');
    } catch {
      ctx.skip();
    }
    const out = await runJob(liveJob({ input_key: join(recDir, 'escape', 'secret.ogg') }), deps());
    expect(out.status).toBe('retry');
    expect(db.failed[0]!.error).toContain('(outside)');
    expect(media.transcodes).toEqual([]);
  });

  it('lost mid-run → no fail, no lecture; the raw stays', async () => {
    db.touchResult = false;
    media = new FakeMedia('hang');
    const out = await runJob(liveJob(), deps());
    expect(out).toEqual({ status: 'lost' });
    expect(db.failed).toEqual([]);
    await rawStillThere();
  });

  it('applies loudnorm only for live recordings when LIVE_LOUDNORM=1', async () => {
    await runJob(liveJob(), deps({ liveLoudnorm: true }));
    expect(media.transcodes[0]!.loudnorm).toBe(true);

    const m2 = new FakeMedia();
    await runJob(makeJob(), deps({ liveLoudnorm: true, media: m2 }));
    expect(m2.transcodes[0]!.loudnorm).toBe(false);
  });

  it('the raw is never modified before its verified deletion (read-only use by ffmpeg)', async () => {
    const before = (await stat(rawPath)).size;
    media = new FakeMedia('fail');
    await runJob(liveJob(), deps());
    expect((await stat(rawPath)).size).toBe(before);
  });
});

async function realpathOf(p: string): Promise<string> {
  const { realpath } = await import('node:fs/promises');
  return realpath(p);
}
