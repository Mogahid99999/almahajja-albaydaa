import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LiveRecordingWatch } from '../src/db.js';
import { EgressTmpDir } from '../src/egressRecovery.js';
import { EgressTracker } from '../src/egressTracker.js';
import type { EgressLookup, LiveKitProbe, PresenceLookup } from '../src/livekitProbe.js';
import type { LiveControl, ResumeReason, ResumeResult } from '../src/liveControl.js';
import {
  EGRESS_STATUS,
  GUARD_TIMING,
  type JudgeInput,
  judgeEgress,
  RecordingGuard,
  resumeDecision,
  shouldSettle,
} from '../src/recordingGuard.js';
import { RecordingsDir } from '../src/recordings.js';
import { FakeDb } from './fakes.js';

const MIN = 60_000;
const T0 = Date.parse('2026-09-29T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

// ─── judgeEgress (pure) ─────────────────────────────────────────────────────────

const base = (over: Partial<JudgeInput> = {}): JudgeInput => ({
  nowMs: T0,
  sessionStatus: 'live',
  sessionEndedMs: null,
  partStartedMs: T0 - 30 * MIN,
  webhookFailed: false,
  egress: { kind: 'found', status: EGRESS_STATUS.ACTIVE, rawPath: null },
  presence: { kind: 'present' },
  presenceConfirmed: true,
  absentForMs: null,
  tmpIdleMs: 5_000,
  ...over,
});

describe('judgeEgress', () => {
  it('a FAILED/ABORTED webhook or LiveKit status is definitive, even with the recorder "present"', () => {
    expect(judgeEgress(base({ webhookFailed: true }))).toMatchObject({ verdict: 'dead', why: 'egress_failed' });
    for (const status of [EGRESS_STATUS.FAILED, EGRESS_STATUS.ABORTED]) {
      expect(judgeEgress(base({ egress: { kind: 'found', status, rawPath: '/recordings/stg/x.ogg' } }))).toEqual({
        verdict: 'dead',
        why: 'egress_failed',
        hintPath: '/recordings/stg/x.ogg',
      });
    }
  });

  it('LiveKit says COMPLETE / LIMIT_REACHED → the lost webhook is replayed (never "dead")', () => {
    for (const status of [EGRESS_STATUS.COMPLETE, EGRESS_STATUS.LIMIT_REACHED]) {
      expect(judgeEgress(base({ egress: { kind: 'found', status, rawPath: '/recordings/stg/a.ogg' } }))).toEqual({
        verdict: 'completed',
        rawPath: '/recordings/stg/a.ogg',
      });
    }
  });

  it('an egress LiveKit does not know: dead only after the start grace', () => {
    const missing: EgressLookup = { kind: 'missing' };
    expect(judgeEgress(base({ egress: missing, presence: { kind: 'absent' }, partStartedMs: T0 - 30_000 }))).toMatchObject({
      verdict: 'wait',
    });
    expect(judgeEgress(base({ egress: missing, partStartedMs: T0 - 3 * MIN }))).toMatchObject({
      verdict: 'dead',
      why: 'egress_unknown',
    });
  });

  it('a recorder still in the room is alive — a long silence (idle tmp file) never kills it', () => {
    expect(judgeEgress(base({ tmpIdleMs: 60 * MIN }))).toEqual({ verdict: 'alive' });
  });

  it('left the room: needs a confirmed listing, ≥ 15 s of absence across sweeps AND a quiet tmp file', () => {
    const absent: PresenceLookup = { kind: 'absent' };
    const q = { presence: absent, tmpIdleMs: 60_000 };
    expect(judgeEgress(base({ ...q, absentForMs: 0 }))).toMatchObject({ verdict: 'wait' }); // first sighting
    expect(judgeEgress(base({ ...q, absentForMs: 3_000 }))).toMatchObject({ verdict: 'wait' }); // a burst of triggered sweeps
    expect(judgeEgress(base({ ...q, absentForMs: 20_000 }))).toMatchObject({ verdict: 'dead', why: 'left_room' });
    // file changed 10 s ago → still being written: never copy a growing file
    expect(judgeEgress(base({ ...q, absentForMs: 5 * MIN, tmpIdleMs: 10_000 }))).toEqual({
      verdict: 'wait',
      why: 'still_writing',
    });
    // hidden participants never seen in the listing → absence proves nothing…
    expect(judgeEgress(base({ ...q, absentForMs: 5 * MIN, presenceConfirmed: false }))).toMatchObject({ verdict: 'wait' });
    // …until the file has not moved for 10 min
    expect(
      judgeEgress(base({ presence: absent, absentForMs: 5 * MIN, presenceConfirmed: false, tmpIdleMs: 10 * MIN })),
    ).toMatchObject({ verdict: 'dead', why: 'stalled' });
  });

  it('room gone while live (after the start grace, file quiet) → dead', () => {
    const gone: PresenceLookup = { kind: 'room_gone' };
    expect(judgeEgress(base({ presence: gone, tmpIdleMs: null, absentForMs: 20_000 }))).toMatchObject({
      verdict: 'dead',
      why: 'room_gone',
    });
    expect(judgeEgress(base({ presence: gone, tmpIdleMs: null, absentForMs: 0 }))).toMatchObject({ verdict: 'wait' });
    expect(
      judgeEgress(base({ presence: gone, tmpIdleMs: null, absentForMs: 20_000, partStartedMs: T0 - 60_000 })),
    ).toMatchObject({ verdict: 'wait', why: 'starting' });
  });

  it('LiveKit API down / unconfigured: only the 10-min stall fallback applies', () => {
    for (const presence of [{ kind: 'error', error: 'x' }, { kind: 'unconfigured' }] as PresenceLookup[]) {
      const egress: EgressLookup = { kind: 'unconfigured' };
      expect(judgeEgress(base({ presence, egress, tmpIdleMs: 5 * MIN }))).toMatchObject({ verdict: 'wait' });
      expect(judgeEgress(base({ presence, egress, tmpIdleMs: 11 * MIN }))).toMatchObject({ verdict: 'dead', why: 'stalled' });
      expect(judgeEgress(base({ presence, egress, tmpIdleMs: null }))).toMatchObject({ verdict: 'wait' });
    }
  });

  it('ended session: give the stopped egress 10 min to report, then call it dead (never stuck)', () => {
    const ended = { sessionStatus: 'ended', presence: { kind: 'unconfigured' } as PresenceLookup };
    expect(judgeEgress(base({ ...ended, sessionEndedMs: T0 - 9 * MIN }))).toEqual({ verdict: 'wait', why: 'ending' });
    expect(judgeEgress(base({ ...ended, sessionEndedMs: T0 - 10 * MIN }))).toMatchObject({
      verdict: 'dead',
      why: 'ended_timeout',
    });
  });
});

describe('resumeDecision / shouldSettle (pure)', () => {
  const s = (status: string, ...parts: string[]) => ({ status, parts: parts.map((p) => ({ status: p })) });

  it('resumes a live session whose last egress is over', () => {
    expect(resumeDecision(s('live', 'dead'), T0, undefined)).toEqual({ resume: true, reason: 'egress_failed' });
    expect(resumeDecision(s('live', 'recovered', 'lost'), T0, undefined)).toEqual({ resume: true, reason: 'egress_failed' });
    expect(resumeDecision(s('live', 'complete'), T0, undefined)).toEqual({ resume: true, reason: 'egress_ended' });
  });

  it('never while something records, the session is over, or blindly (no parts)', () => {
    expect(resumeDecision(s('live', 'dead', 'recording'), T0, undefined)).toMatchObject({ resume: false, why: 'recording' });
    expect(resumeDecision(s('ended', 'dead'), T0, undefined)).toMatchObject({ resume: false, why: 'not_live' });
    expect(resumeDecision(s('live'), T0, undefined)).toMatchObject({ resume: false, why: 'no_parts' });
  });

  it('backs off 60 s, stops after 3 lost parts in a row, caps at 50 parts', () => {
    expect(resumeDecision(s('live', 'dead'), T0, T0 - 30_000)).toMatchObject({ why: 'backoff' });
    expect(resumeDecision(s('live', 'dead'), T0, T0 - 61_000)).toMatchObject({ resume: true });
    expect(resumeDecision(s('live', 'recovered', 'lost', 'lost', 'lost'), T0, undefined)).toMatchObject({ why: 'repeated_loss' });
    expect(resumeDecision(s('live', 'lost', 'lost', 'recovered'), T0, undefined)).toMatchObject({ resume: true });
    expect(resumeDecision(s('live', ...Array(50).fill('complete')), T0, undefined)).toMatchObject({ why: 'part_cap' });
  });

  it('settles an ended session only when nothing is open, 10 min after its end', () => {
    const ended = (min: number, ...parts: string[]) => ({
      status: 'ended',
      hasJob: false,
      endedAt: iso(T0 - min * MIN),
      parts: parts.map((p) => ({ status: p })),
    });
    expect(shouldSettle(ended(11), T0)).toBe(true); // pre-0146 session, no file ever
    expect(shouldSettle(ended(11, 'lost'), T0)).toBe(true);
    expect(shouldSettle(ended(9), T0)).toBe(false);
    expect(shouldSettle(ended(11, 'dead'), T0)).toBe(false);
    expect(shouldSettle(ended(11, 'recording'), T0)).toBe(false);
    expect(shouldSettle({ ...ended(11), hasJob: true }, T0)).toBe(false);
    expect(shouldSettle({ ...ended(11), status: 'live' }, T0)).toBe(false);
  });
});

// ─── RecordingGuard (real temp dirs, fake DB / LiveKit / live-control) ──────────

const ROOM = 'stg_0a1b2c3d4e5f';
const EG = 'EG_one1';
const PARTIAL_NAME = `${ROOM}-2026-09-29T093000.ogg`;
const PARTIAL = Buffer.from('OggS-opus-partial-without-EOS');

class FakeProbe implements LiveKitProbe {
  egressFor: (id: string) => EgressLookup = () => ({ kind: 'found', status: EGRESS_STATUS.ACTIVE, rawPath: null });
  presenceFor: (room: string, id: string) => PresenceLookup = () => ({ kind: 'present' });
  asked: string[] = [];
  async egress(id: string) {
    this.asked.push(id);
    return this.egressFor(id);
  }
  async presence(room: string, id: string) {
    return this.presenceFor(room, id);
  }
}

let root: string;
let tmpRoot: string;
let recDir: string;
let db: FakeDb;
let probe: FakeProbe;
let control: Pick<LiveControl, 'resumeRecording'> & { calls: Array<[string, ResumeReason]>; result: ResumeResult | Error };
let tracker: EgressTracker;
let events: Array<[string, Record<string, unknown> | undefined]>;
let now: number;

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

const row = (over: Partial<LiveRecordingWatch> = {}): LiveRecordingWatch => ({
  sessionId: 'sess-1',
  roomName: ROOM,
  status: 'live',
  startedAt: iso(T0 - 30 * MIN),
  endedAt: null,
  hasJob: false,
  parts: [{ seq: 1, egressId: EG, status: 'recording', rawPath: null, startedAt: iso(T0 - 30 * MIN) }],
  ...over,
});

/** The crashed egress's in-progress file, last written `idleMs` ago. */
async function partial(egressId = EG, name = PARTIAL_NAME, idleMs = 5 * MIN, bytes = PARTIAL): Promise<string> {
  const dir = join(tmpRoot, egressId);
  await mkdir(dir, { recursive: true });
  const p = join(dir, name);
  await writeFile(p, bytes);
  const t = (now - idleMs) / 1000;
  await utimes(p, t, t);
  return p;
}

function guard(env: 'stg' | 'prd' = 'stg', tmpDir = tmpRoot): RecordingGuard {
  return new RecordingGuard({
    env,
    db,
    probe,
    control,
    recordings: new RecordingsDir(recDir),
    tmp: new EgressTmpDir(tmpDir, env),
    egress: tracker,
    log: (_l, e, f) => void events.push([e, f]),
    now: () => now,
  });
}

const evt = (name: string) => events.filter(([e]) => e === name).map(([, f]) => f);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mw-guard-'));
  tmpRoot = join(root, 'egress-tmp');
  recDir = join(root, 'recordings', 'stg');
  await mkdir(tmpRoot, { recursive: true });
  await mkdir(recDir, { recursive: true });
  await mkdir(join(root, 'recordings', 'prd'), { recursive: true });
  now = T0;
  db = new FakeDb();
  probe = new FakeProbe();
  control = {
    calls: [],
    result: { status: 'resumed', egressId: 'EG_two2', seq: 2 },
    async resumeRecording(sessionId, reason) {
      db.calls.push('resume');
      control.calls.push([sessionId, reason]);
      if (control.result instanceof Error) throw control.result;
      return control.result;
    },
  };
  tracker = new EgressTracker();
  tracker.started(EG, ROOM);
  events = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('RecordingGuard — the 2026-09-29 drill (egress killed mid-session, no webhook)', () => {
  it('recorder vanishes → marked dead → recording resumed at once → partial recovered byte-for-byte', async () => {
    db.watch = [row()];
    const src = await partial();
    const g = guard();

    // 1. alive: the recorder is in the room (even though the file is quiet: silence)
    await g.sweep();
    expect(db.registered).toEqual([]);
    expect(control.calls).toEqual([]);

    // 2. killed: LiveKit still says ACTIVE (stale), the recorder left the room
    probe.presenceFor = () => ({ kind: 'absent' });
    now += 20_000;
    await g.sweep();
    now += 3_000;
    await g.sweep(); // a triggered sweep 3 s later: still no proof
    expect(db.registered).toEqual([]);
    now += 17_000;
    const stats = await g.sweep();

    expect(stats).toMatchObject({ dead: 1, resumed: 1, recovered: 1, lost: 0, errors: 0 });
    // order: dead (lets live-control resume) → resume → the recovered file
    const order = db.calls.filter((c) => c.startsWith('register_part') || c === 'resume');
    expect(order).toEqual(['register_part:dead', 'resume', 'register_part:recovered']);
    expect(control.calls).toEqual([['sess-1', 'egress_failed']]);

    const rec = db.registered[1]!;
    expect(rec).toMatchObject({ room: ROOM, egress: EG, status: 'recovered', bytes: PARTIAL.length });
    expect(rec.raw).toMatch(/stg_0a1b2c3d4e5f-2026-09-29T093000-recovered\.ogg$/);
    expect(await readFile(rec.raw!)).toEqual(PARTIAL);
    // source removed from the egress tmp dir only after the verified copy was registered
    expect(await exists(src)).toBe(false);
    expect(await exists(join(tmpRoot, EG))).toBe(false);
    // transcodes are no longer held back for a dead egress
    expect(tracker.count).toBe(0);
    expect(evt('recording.egress_dead')[0]).toMatchObject({ why: 'left_room', seq: 1 });

    // next sweep: nothing left to do for that part
    await g.sweep();
    expect(db.registered).toHaveLength(2);
  });

  it('egress_ended FAILED (webhook) → dead at once, even if LiveKit still lists the recorder', async () => {
    db.watch = [row()];
    await partial(EG, PARTIAL_NAME, 2_000);
    const g = guard();
    g.egressFailed(EG, null);
    const stats = await g.sweep();
    expect(stats).toMatchObject({ dead: 1, resumed: 1, recovered: 1 });
    expect(db.registered.map((r) => r.status)).toEqual(['dead', 'recovered']);
    await g.stop();
  });

  it('the stuck staging session: ended, egress never reported → 10 min after the end it is recovered, not resumed', async () => {
    db.watch = [row({ status: 'ended', endedAt: iso(T0 - 5 * MIN) })];
    await partial();
    const g = guard();
    await g.sweep();
    expect(db.registered).toEqual([]);

    now += 6 * MIN;
    const stats = await g.sweep();
    expect(stats).toMatchObject({ dead: 1, recovered: 1, resumed: 0 });
    expect(control.calls).toEqual([]);
    expect(evt('recording.egress_dead')[0]).toMatchObject({ why: 'ended_timeout' });
  });

  it('nothing recoverable anywhere → the part is `lost` (the RPC then fails the session loudly)', async () => {
    db.watch = [row({ status: 'ended', endedAt: iso(T0 - 11 * MIN) })];
    db.registerResult = 'job-failed-1';
    const stats = await guard().sweep();
    expect(stats).toMatchObject({ dead: 1, lost: 1, recovered: 0 });
    expect(db.registered.map((r) => [r.status, r.raw])).toEqual([
      ['dead', null],
      ['lost', null],
    ]);
    expect(evt('recording.part_lost')[0]).toMatchObject({ how: 'nothing_found', job: 'job-failed-1' });
  });

  it('a lost clean-end webhook (LiveKit: COMPLETE) is replayed as enqueue_live_recording', async () => {
    const final = join(recDir, `${ROOM}-2026-09-29T093000.ogg`);
    await writeFile(final, 'complete recording');
    probe.egressFor = () => ({ kind: 'found', status: EGRESS_STATUS.COMPLETE, rawPath: final });
    db.watch = [row({ status: 'ended', endedAt: iso(T0 - MIN) })];
    const stats = await guard().sweep();
    expect(stats).toMatchObject({ completed: 1, dead: 0 });
    expect(db.enqueued).toHaveLength(1);
    expect(db.enqueued[0]).toMatchObject({ room: ROOM, egress: EG });
    expect(db.enqueued[0]!.raw.endsWith(`${ROOM}-2026-09-29T093000.ogg`)).toBe(true);
    expect(db.registered).toEqual([]);
  });

  it('clean end while still live (egress limit) → replayed, then a new egress (egress_ended)', async () => {
    const final = join(recDir, `${ROOM}-2026-09-29T093000.ogg`);
    await writeFile(final, 'first 6 hours');
    probe.egressFor = () => ({ kind: 'found', status: EGRESS_STATUS.LIMIT_REACHED, rawPath: final });
    db.watch = [row()];
    const stats = await guard().sweep();
    expect(stats).toMatchObject({ completed: 1, resumed: 1 });
    expect(control.calls).toEqual([['sess-1', 'egress_ended']]);
  });
});

describe('RecordingGuard — env-prefix safety (one tmp dir, two envs)', () => {
  it('a prd worker never touches a stg session or its files', async () => {
    db.watch = [row()];
    const src = await partial();
    probe.presenceFor = () => ({ kind: 'room_gone' });
    const stats = await guard('prd').sweep();
    expect(stats).toMatchObject({ refused: 1, sessions: 0, dead: 0 });
    expect(db.registered).toEqual([]);
    expect(probe.asked).toEqual([]);
    expect(await readFile(src)).toEqual(PARTIAL);
  });

  it("a stg worker whose egress dir holds only a prd_ file does not take it (part lost, prd file untouched)", async () => {
    db.watch = [row({ status: 'ended', endedAt: iso(T0 - 11 * MIN) })];
    const prdFile = await partial(EG, 'prd_9f8e7d6c5b4a-2026-09-29T093000.ogg');
    const stats = await guard('stg').sweep();
    expect(stats).toMatchObject({ lost: 1, recovered: 0 });
    expect(await readFile(prdFile)).toEqual(PARTIAL);
    expect(await readdir(recDir)).toEqual([]);
  });
});

describe('RecordingGuard — never lost, never stuck', () => {
  it('a register failure after the copy: the next sweep reuses that copy (no duplicate), then removes the source', async () => {
    db.watch = [row({ status: 'ended', endedAt: iso(T0 - 11 * MIN) })];
    const src = await partial();
    db.registerError = new Error('register_live_recording_part failed: timeout');
    db.registerErrorStatus = 'recovered';
    const g = guard();
    const first = await g.sweep();
    expect(first).toMatchObject({ dead: 1, errors: 1 });
    expect(await exists(src)).toBe(true); // kept until a copy is registered

    db.registerError = null;
    const second = await g.sweep();
    expect(second).toMatchObject({ recovered: 1 });
    expect((await readdir(recDir)).filter((n) => n.includes('-recovered'))).toHaveLength(1);
    expect(await exists(src)).toBe(false);
  });

  it('egress tmp dir not mounted: never marks a live part lost; after the ended grace it is lost', async () => {
    db.watch = [row()];
    const g = guard('stg', join(root, 'not-mounted'));
    g.egressFailed(EG, null);
    const stats = await g.sweep();
    expect(stats).toMatchObject({ dead: 1, resumed: 1, lost: 0 });
    expect(evt('recording.tmp_unavailable')).toHaveLength(1);

    db.watch[0]!.status = 'ended';
    db.watch[0]!.endedAt = iso(now - 11 * MIN);
    await g.sweep();
    expect(db.registered.map((r) => r.status)).toEqual(['dead', 'lost']);
    await g.stop();
  });

  it('an unreferenced final file of the room is attached only when unambiguous', async () => {
    await writeFile(join(recDir, `${ROOM}-2026-09-29T093000.ogg`), 'final file, webhook lost');
    db.watch = [row({ status: 'ended', endedAt: iso(T0 - 11 * MIN) })];
    probe.egressFor = () => ({ kind: 'missing' });
    await guard().sweep();
    expect(db.registered.map((r) => r.status)).toEqual(['dead', 'recovered']);
    expect(evt('recording.part_recovered')[0]).toMatchObject({ how: 'unreferenced_file' });

    // two candidate files → never guess: the part stays open (visible as waiting)
    db = new FakeDb();
    events = [];
    await writeFile(join(recDir, `${ROOM}-2026-09-29T100000.ogg`), 'another');
    db.watch = [row({ status: 'ended', endedAt: iso(T0 - 11 * MIN) })];
    await guard().sweep();
    expect(db.registered.map((r) => r.status)).toEqual(['dead']);
    expect(evt('recording.ambiguous_files')).toHaveLength(1);
  });

  it('an ended session with no job and nothing open is settled 10 min after its end (pre-0146 / no file)', async () => {
    db.watch = [row({ status: 'ended', endedAt: iso(T0 - 5 * MIN), parts: [] })];
    const g = guard();
    await g.sweep();
    expect(db.settled).toEqual([]);
    now += 6 * MIN;
    const stats = await g.sweep();
    expect(stats.settled).toBe(1);
    expect(db.settled).toEqual(['sess-1']);
  });

  it('resume refused (409) is logged, retried after the backoff; stopped after 3 lost parts in a row', async () => {
    db.watch = [row({ parts: [{ seq: 1, egressId: EG, status: 'dead', rawPath: null, startedAt: iso(T0 - 30 * MIN) }] })];
    await partial();
    control.result = { status: 'refused', httpStatus: 409, detail: '{"error":"invalid_state","detail":"room_gone"}' };
    const g = guard();
    await g.sweep();
    expect(control.calls).toHaveLength(1);
    expect(evt('recording.resume_refused')[0]).toMatchObject({ http: 409 });
    now += 30_000;
    await g.sweep();
    expect(control.calls).toHaveLength(1); // backoff
    now += 31_000;
    await g.sweep();
    expect(control.calls).toHaveLength(2);

    const lost = (seq: number, id: string) => ({ seq, egressId: id, status: 'lost' as const, rawPath: null, startedAt: null });
    db.watch = [row({ parts: [lost(1, 'EG_a1'), lost(2, 'EG_b2'), lost(3, 'EG_c3')] })];
    now += 2 * MIN;
    await g.sweep();
    await g.sweep();
    expect(control.calls).toHaveLength(2);
    expect(evt('recording.resume_stopped')).toHaveLength(1);
  });

  it('a resume that errors (live-control down) is counted and retried later — the dead part is still recovered', async () => {
    db.watch = [row()];
    await partial();
    control.result = new Error('live-control resume_recording failed: HTTP 502');
    const g = guard();
    g.egressFailed(EG, null);
    const stats = await g.sweep();
    expect(stats).toMatchObject({ dead: 1, errors: 1, recovered: 1 });
    await g.stop();
  });

  it('a watch RPC failure is logged by the periodic task, never thrown', async () => {
    db.watchError = new Error('live_recording_watch failed');
    const g = guard();
    await g.runOnce();
    expect(events.map(([e]) => e)).toEqual(['recording_guard.error']);
    await g.stop();
  });

  it('idle sweeps log nothing (it runs every 20 s)', async () => {
    db.watch = [row()];
    const g = guard();
    await g.runOnce();
    expect(events).toEqual([]);
    await g.stop();
  });
});

it('GUARD_TIMING keeps the documented defaults', () => {
  expect(GUARD_TIMING).toMatchObject({
    startGraceMs: 2 * MIN,
    endedGraceMs: 10 * MIN,
    absentMinMs: 15_000,
    resumeBackoffMs: MIN,
    lostStreakStop: 3,
  });
});
