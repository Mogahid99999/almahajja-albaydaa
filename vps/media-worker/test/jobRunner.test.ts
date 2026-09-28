import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type JobRunnerDeps, runJob } from '../src/jobRunner.js';
import { FakeDb, FakeMedia, FakeStorage, makeJob } from './fakes.js';

let tmpDir: string;
let db: FakeDb;
let storage: FakeStorage;
let media: FakeMedia;

const deps = (over: Partial<JobRunnerDeps> = {}): JobRunnerDeps => ({
  db,
  storage,
  media,
  tmpDir,
  liveLoudnorm: false,
  reporter: { minIntervalMs: 0 },
  ...over,
});

const tmpIsEmpty = async () => expect(await readdir(tmpDir)).toEqual([]);

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mw-test-'));
  db = new FakeDb();
  storage = new FakeStorage();
  media = new FakeMedia();
  storage.objects.set('incoming/5f0c.m4a', Buffer.from('original-audio'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('lecture_transcode', () => {
  it('success → MP3 at the lecture key, complete RPC, original deleted, temp cleaned', async () => {
    const out = await runJob(makeJob(), deps());

    const key = 'lectures/كتاب التوحيد/الدرس الأول.mp3';
    expect(out).toMatchObject({ status: 'done', outputKey: key, durationSec: 30 });
    expect(storage.uploads).toEqual([{ key, contentType: 'audio/mpeg' }]);
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

describe('live_recording (P2 — RPC pending)', () => {
  const liveJob = () =>
    makeJob({ kind: 'live_recording', lecture_id: null, input_key: 'live-raw/stg_abc-2026-09-28T1900.ogg' });

  beforeEach(() => {
    storage.objects.set('live-raw/stg_abc-2026-09-28T1900.ogg', Buffer.from('ogg'));
  });

  it('creates the lecture via create_live_lecture and keeps the raw (D5 retention)', async () => {
    const out = await runJob(liveJob(), deps());
    expect(out).toMatchObject({ status: 'done', outputKey: 'lectures/_live/stg_abc-2026-09-28T1900.mp3' });
    expect(db.liveCreated).toEqual([{ jobId: 'job-1', key: 'lectures/_live/stg_abc-2026-09-28T1900.mp3' }]);
    expect(storage.deleted).toEqual([]);
    expect(media.transcodes[0]!.loudnorm).toBe(false);
  });

  it('applies loudnorm only for live recordings when LIVE_LOUDNORM=1', async () => {
    await runJob(liveJob(), deps({ liveLoudnorm: true }));
    expect(media.transcodes[0]!.loudnorm).toBe(true);

    const m2 = new FakeMedia();
    await runJob(makeJob(), deps({ liveLoudnorm: true, media: m2 }));
    expect(m2.transcodes[0]!.loudnorm).toBe(false);
  });
});
