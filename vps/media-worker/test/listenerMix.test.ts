// The listener-rec mix as the live lecture's primary source (owner, 2026-11-14), egress as fallback.
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type JobRunnerDeps, runJob } from '../src/jobRunner.js';
import { ListenerDir, roomFromRawName, waitListenerMix } from '../src/listenerMix.js';
import { RecordingsDir } from '../src/recordings.js';
import { FakeDb, FakeMedia, FakeStorage, makeJob } from './fakes.js';

const ROOM = 'stg_abc123';
const RAW_NAME = `${ROOM}-2026-09-28T190000.ogg`;
const MIX_DIR = `${ROOM}-20260928T185955Z`;
const MIX_BYTES = Buffer.from('OggS-listener-mix');

let root: string, recDir: string, lisDir: string, tmpDir: string;
let db: FakeDb, storage: FakeStorage, media: FakeMedia;
const logs: Array<[string, string, Record<string, unknown> | undefined]> = [];

const deps = (over: Partial<JobRunnerDeps> = {}): JobRunnerDeps => ({
  db, storage, media, recordings: new RecordingsDir(recDir), tmpDir, liveLoudnorm: false,
  reporter: { minIntervalMs: 0 },
  log: (l, e, f) => logs.push([l, e, f as Record<string, unknown> | undefined]),
  listener: { dir: new ListenerDir(lisDir), waitMs: 0, pollMs: 1 },
  ...over,
});
const liveJob = () =>
  makeJob({ kind: 'live_recording', lecture_id: null, input_key: join(recDir, RAW_NAME), live_session_id: 'sess-1' });
const writeMix = async (name = 'mix.ogg') => {
  await mkdir(join(lisDir, MIX_DIR), { recursive: true });
  await writeFile(join(lisDir, MIX_DIR, name), MIX_BYTES);
};
const source = () => logs.find((l) => l[1] === 'job.source')?.[2];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mw-lis-'));
  recDir = join(root, 'recordings', 'stg');
  lisDir = join(root, 'recordings', 'listener');
  tmpDir = join(root, 'tmp');
  await mkdir(recDir, { recursive: true });
  await mkdir(lisDir, { recursive: true });
  await writeFile(join(recDir, RAW_NAME), Buffer.from('OggS-egress-raw'));
  db = new FakeDb();
  storage = new FakeStorage();
  media = new FakeMedia('ok', 3600);
  logs.length = 0;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('roomFromRawName', () => {
  it('reads the room from an egress raw name', () => {
    expect(roomFromRawName('prd_f1ec5df8db7f-2026-11-14T191528.ogg')).toBe('prd_f1ec5df8db7f');
    expect(roomFromRawName('../x-2026-11-14T191528.ogg')).toBeNull();
    expect(roomFromRawName('zz_test-2026-11-14T191528.ogg')).toBeNull();
  });
});

describe('live lecture source', () => {
  it('uses the listener mix when it is ready and long enough; the egress raw is still backed up; the mix too', async () => {
    await writeMix();
    media.probes.set('mix.ogg', 3605);
    const out = await runJob(liveJob(), deps());
    expect(out).toMatchObject({ status: 'done', rawBackupKey: `live-raw/${RAW_NAME}` });
    expect(media.transcodes).toHaveLength(1);
    expect(media.transcodes[0]!.input).toMatch(/mix\.ogg$/);
    expect(storage.objects.get(`live-raw/listener/${MIX_DIR}.ogg`)).toEqual(MIX_BYTES);
    expect(storage.objects.has(`live-raw/${RAW_NAME}`)).toBe(true);
    expect(db.liveCreated[0]).toMatchObject({ durationSec: 3600 }); // output probe (fake duration)
    expect(source()).toMatchObject({ source: 'listener', mix: MIX_DIR });
  });

  it('falls back to the egress raw when the mix is much shorter (lost audio)', async () => {
    await writeMix();
    media.probes.set('mix.ogg', 3000);
    const out = await runJob(liveJob(), deps());
    expect(out).toMatchObject({ status: 'done' });
    expect(media.transcodes[0]!.input).toMatch(/\.ogg$/);
    expect(media.transcodes[0]!.input).not.toMatch(/mix\.ogg$/);
    expect([...storage.objects.keys()].some((k) => k.startsWith('live-raw/listener/'))).toBe(false);
    expect(source()).toMatchObject({ source: 'egress' });
    expect(String(source()?.reason)).toMatch(/too short/);
  });

  it('accepts a mix up to 30 s shorter than the egress recording', async () => {
    await writeMix();
    media.probes.set('mix.ogg', 3571);
    await runJob(liveJob(), deps());
    expect(source()).toMatchObject({ source: 'listener' });
  });

  it('falls back when there is no listener recording for the room', async () => {
    const out = await runJob(liveJob(), deps());
    expect(out).toMatchObject({ status: 'done' });
    expect(source()).toMatchObject({ source: 'egress', reason: 'no listener recording' });
  });

  it('falls back when the mix is still being written after the wait (mix.part.ogg only)', async () => {
    await writeMix('mix.part.ogg');
    await runJob(liveJob(), deps());
    expect(source()).toMatchObject({ source: 'egress', reason: 'listener mix not ready in time' });
  });

  it('falls back at once when listener-rec reports mix.failed', async () => {
    await writeMix('mix.failed');
    await runJob(liveJob(), deps());
    expect(source()).toMatchObject({ source: 'egress', reason: 'listener mix failed' });
  });

  it('falls back when the recorder left several folders for the room', async () => {
    await writeMix();
    await mkdir(join(lisDir, `${ROOM}-20260928T191000Z`));
    await runJob(liveJob(), deps());
    expect(String(source()?.reason)).toMatch(/several listener folders/);
  });

  it('without LISTENER_DIR the egress raw is used as before (no source decision logged)', async () => {
    await writeMix();
    await runJob(liveJob(), deps({ listener: undefined }));
    expect(media.transcodes[0]!.input).not.toMatch(/mix\.ogg$/);
    expect(source()).toBeUndefined();
  });

  it('never picks another room or env folder', async () => {
    await mkdir(join(lisDir, 'stg_abc1234-20260928T185955Z'));
    await writeFile(join(lisDir, 'stg_abc1234-20260928T185955Z', 'mix.ogg'), MIX_BYTES);
    await runJob(liveJob(), deps());
    expect(source()).toMatchObject({ source: 'egress', reason: 'no listener recording' });
    expect(await readdir(lisDir)).toHaveLength(1);
  });
});

describe('waitListenerMix', () => {
  it('waits while pending and returns the mix once it is renamed into place', async () => {
    let t = 0;
    let polls = 0;
    const dir = {
      state: async () => (++polls < 3 ? ({ state: 'pending' } as const) : ({ state: 'ready', mix: { path: '/m', size: 1, dirName: 'd' } } as const)),
    };
    const s = await waitListenerMix(dir, ROOM, { timeoutMs: 60_000, pollMs: 10_000, now: () => t, sleep: async (ms) => void (t += ms) });
    expect(s.state).toBe('ready');
    expect(t).toBe(20_000);
  });
});
