import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomEventResult } from '../src/db.js';
import { EgressTracker } from '../src/egressTracker.js';
import { HostAbsenceWatch } from '../src/hostWatch.js';
import type { LiveControl } from '../src/liveControl.js';
import { RecordingsDir } from '../src/recordings.js';
import { createHttpServer } from '../src/server.js';
import { handleWebhook, type WebhookDeps } from '../src/webhooks.js';
import { FakeDb } from './fakes.js';

const KEY = 'almahajja_int';
const SECRET = 'test-secret-with-enough-length-0123456789';

/** Sign exactly like the LiveKit server: HS256 JWT (iss=key) carrying sha256(body) base64. */
async function sign(body: string, secret = SECRET, key = KEY): Promise<string> {
  const at = new AccessToken(key, secret);
  at.sha256 = createHash('sha256').update(body).digest('base64');
  return at.toJwt();
}

const egressEvent = (event: string, room: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    event,
    id: 'EV_1',
    createdAt: '1790000000',
    egressInfo: { egressId: 'EG_abc', roomName: room, status: 'EGRESS_ACTIVE', ...extra },
  });

const roomEventBody = (event: string, room: string, identity?: string, numParticipants?: number) =>
  JSON.stringify({
    event,
    id: 'EV_2',
    room: { name: room, sid: 'RM_1', ...(numParticipants !== undefined ? { numParticipants } : {}) },
    ...(identity ? { participant: { identity, sid: 'PA_1' } } : {}),
  });

let recRoot: string;
let recDir: string;
let db: FakeDb;
let egress: EgressTracker;
let kick: ReturnType<typeof vi.fn<() => void>>;
let events: string[];
let deps: WebhookDeps;

/** Write a raw into this env's RECORDINGS_DIR; returns its path as egress reports it. */
async function raw(name: string, bytes = 'OggS'): Promise<string> {
  const p = join(recDir, name);
  await writeFile(p, bytes);
  return p;
}

beforeEach(async () => {
  recRoot = await mkdtemp(join(tmpdir(), 'mw-wh-'));
  recDir = join(recRoot, 'recordings', 'stg');
  await mkdir(recDir, { recursive: true });
  await mkdir(join(recRoot, 'recordings', 'prd'), { recursive: true });
  db = new FakeDb();
  egress = new EgressTracker();
  kick = vi.fn<() => void>();
  events = [];
  deps = {
    verifier: new WebhookReceiver(KEY, SECRET),
    env: 'stg',
    egress,
    db,
    recordings: new RecordingsDir(recDir),
    kick,
    log: (_l, e) => void events.push(e),
  };
});

afterEach(async () => {
  await rm(recRoot, { recursive: true, force: true });
});

describe('handleWebhook — env filter and signature', () => {
  it('egress_started for our env → deferral armed', async () => {
    const body = egressEvent('egress_started', 'stg_room1');
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(egress.count).toBe(1);
  });

  it('ignores rooms of the other env (and never touches state or the DB)', async () => {
    for (const body of [egressEvent('egress_started', 'prd_room1'), roomEventBody('participant_left', 'prd_room1', 'u1')]) {
      const r = await handleWebhook(deps, body, await sign(body));
      expect(r).toEqual({ status: 200, body: { ok: true, ignored: true } });
    }
    expect(egress.count).toBe(0);
    expect(db.roomEvents).toEqual([]);
    expect(kick).not.toHaveBeenCalled();
  });

  it('ignores un-prefixed rooms (e.g. "stgroom")', async () => {
    const body = egressEvent('egress_started', 'stgroom');
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.body).toMatchObject({ ignored: true });
  });

  it('bad signature (wrong secret) → 401', async () => {
    const body = egressEvent('egress_started', 'stg_room1');
    const r = await handleWebhook(deps, body, await sign(body, 'some-other-secret-0123456789abcdef'));
    expect(r.status).toBe(401);
    expect(egress.count).toBe(0);
  });

  it('tampered body (hash mismatch) → 401', async () => {
    const body = egressEvent('egress_started', 'stg_room1');
    const token = await sign(body);
    const r = await handleWebhook(deps, body.replace('stg_room1', 'stg_room2'), token);
    expect(r.status).toBe(401);
  });

  it('missing Authorization → 401', async () => {
    const r = await handleWebhook(deps, egressEvent('egress_started', 'stg_room1'), undefined);
    expect(r.status).toBe(401);
  });
});

describe('egress_ended → enqueue_live_recording (local raw)', () => {
  it('COMPLETE + existing .ogg under RECORDINGS_DIR → enqueued with the local path, deferral released, kicked', async () => {
    const p = await raw('stg_p0_rec-2026-09-28T164931.ogg');
    egress.started('EG_live', 'stg_p0_rec');
    const body = egressEvent('egress_ended', 'stg_p0_rec', {
      egressId: 'EG_live',
      status: 'EGRESS_COMPLETE',
      fileResults: [{ filename: p, size: '4', duration: '61000000000' }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(egress.count).toBe(0);
    expect(db.enqueued).toEqual([{ room: 'stg_p0_rec', egress: 'EG_live', raw: await realpath(p) }]);
    expect(kick).toHaveBeenCalledTimes(1);
    expect(events).toContain('lk.recording_enqueued');
  });

  it('EGRESS_LIMIT_REACHED with an .ogg → enqueued like COMPLETE; the .json manifest is ignored', async () => {
    const p = await raw('stg_room1-long.ogg');
    const body = egressEvent('egress_ended', 'stg_room1', {
      status: 'EGRESS_LIMIT_REACHED',
      fileResults: [{ filename: join(recDir, 'EG_abc.json') }, { filename: p }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(db.enqueued.map((e) => e.raw)).toEqual([await realpath(p)]);
  });

  it('session still live (RPC returns null) → accepted; the job starts when the session ends', async () => {
    db.enqueueResult = null;
    const p = await raw('stg_room1-a.ogg');
    const body = egressEvent('egress_ended', 'stg_room1', { status: 'EGRESS_COMPLETE', fileResults: [{ filename: p }] });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(db.enqueued).toHaveLength(1);
  });

  it.each(['EGRESS_FAILED', 'EGRESS_ABORTED'])('%s with a file → logged only, NOT enqueued (raw kept)', async (status) => {
    const p = await raw('stg_room1-partial.ogg');
    const body = egressEvent('egress_ended', 'stg_room1', {
      status,
      error: 'pipeline stalled',
      fileResults: [{ filename: p }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(db.enqueued).toEqual([]);
    expect(events).toContain('lk.egress_not_enqueued');
    expect(kick).toHaveBeenCalled();
  });

  it('COMPLETE with only a .json manifest / no files → nothing enqueued', async () => {
    for (const fileResults of [[{ filename: join(recDir, 'EG_abc.json') }], []]) {
      const body = egressEvent('egress_ended', 'stg_room1', { status: 'EGRESS_COMPLETE', fileResults });
      const r = await handleWebhook(deps, body, await sign(body));
      expect(r.status).toBe(200);
    }
    expect(db.enqueued).toEqual([]);
  });

  it('the .ogg does not exist → NOT enqueued, 500 (LiveKit may redeliver), logged', async () => {
    const body = egressEvent('egress_ended', 'stg_room1', {
      status: 'EGRESS_COMPLETE',
      fileResults: [{ filename: join(recDir, 'ghost.ogg') }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(500);
    expect(db.enqueued).toEqual([]);
    expect(events).toContain('lk.recording_unusable');
  });

  it('refuses paths outside RECORDINGS_DIR: other env folder, "..", relative, legacy R2 key', async () => {
    const prd = join(recRoot, 'recordings', 'prd', 'prd_room-1.ogg');
    await writeFile(prd, 'OggS');
    await raw('stg_room1-ok.ogg');
    for (const filename of [prd, `${recDir}/../prd/prd_room-1.ogg`, 'stg_room1-ok.ogg', 'live-raw/stg_room1-ok.ogg']) {
      const body = egressEvent('egress_ended', 'stg_room1', { status: 'EGRESS_COMPLETE', fileResults: [{ filename }] });
      const r = await handleWebhook(deps, body, await sign(body));
      expect(r.status).toBe(200); // not retryable
    }
    expect(db.enqueued).toEqual([]);
  });

  it('enqueue RPC failure → 500 so LiveKit can retry', async () => {
    db.enqueueError = new Error('enqueue_live_recording failed: 404');
    const p = await raw('stg_room1-x.ogg');
    const body = egressEvent('egress_ended', 'stg_room1', { status: 'EGRESS_COMPLETE', fileResults: [{ filename: p }] });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(500);
  });
});

describe('room lifecycle → live_room_event', () => {
  it.each([
    ['room_started', undefined, 0],
    ['participant_joined', 'u_1', 2],
    ['participant_left', 'u_1', 1],
    ['track_published', 'u_host', 3],
    ['track_unpublished', 'u_host', 3],
    ['room_finished', undefined, 0],
  ] as const)('%s → live_room_event(room, event, identity, numParticipants)', async (event, identity, num) => {
    const body = roomEventBody(event, 'stg_room1', identity, num);
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(db.roomEvents).toEqual([{ room: 'stg_room1', event, identity: identity ?? null, num }]);
  });

  it('room_finished also clears the egress deferral for that room', async () => {
    egress.started('EG_abc', 'stg_room1');
    const body = roomEventBody('room_finished', 'stg_room1');
    await handleWebhook(deps, body, await sign(body));
    expect(egress.count).toBe(0);
    expect(kick).toHaveBeenCalled();
  });

  it('live_room_event failure → 500 (LiveKit may redeliver)', async () => {
    db.roomEventError = new Error('live_room_event failed: timeout');
    const body = roomEventBody('participant_joined', 'stg_room1', 'u_1', 1);
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(500);
  });
});

describe('D4 host absence (webhooks + HostAbsenceWatch)', () => {
  let control: LiveControl & { calls: Array<[string, string]> };
  let watch: HostAbsenceWatch;
  const result = (over: Partial<RoomEventResult>): RoomEventResult => ({
    sessionId: 'sess-1',
    status: 'live',
    isHost: false,
    hostPresent: true,
    ...over,
  });
  const send = async (event: string, identity?: string) => {
    const body = roomEventBody(event, 'stg_room1', identity, 1);
    return handleWebhook(deps, body, await sign(body));
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    control = {
      calls: [],
      async autoEnd(sessionId, reason) {
        control.calls.push([sessionId, reason]);
      },
    };
    watch = new HostAbsenceWatch(control, { graceMs: 10 * 60 * 1000 });
    deps.hostWatch = watch;
  });
  afterEach(() => {
    watch.stop();
    vi.useRealTimers();
  });

  it('host leaves → 10-minute timer → auto_end(host_absent)', async () => {
    db.roomEventResult = result({ isHost: true, hostPresent: false });
    await send('participant_left', 'u_host');
    expect(watch.isArmed('sess-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
    expect(control.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(control.calls).toEqual([['sess-1', 'host_absent']]);
  });

  it('host rejoins within 10 minutes → timer cancelled, no auto_end', async () => {
    db.roomEventResult = result({ isHost: true, hostPresent: false });
    await send('participant_left', 'u_host');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    db.roomEventResult = result({ isHost: true, hostPresent: true });
    await send('participant_joined', 'u_host');
    expect(watch.isArmed('sess-1')).toBe(false);
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(control.calls).toEqual([]);
  });

  it('room_finished while the session is still live → auto_end(room_finished) at once', async () => {
    db.roomEventResult = result({ status: 'live', hostPresent: false });
    await send('room_finished');
    await vi.advanceTimersByTimeAsync(0);
    expect(control.calls).toEqual([['sess-1', 'room_finished']]);
  });

  it('room_finished for a session already ended → nothing to do', async () => {
    db.roomEventResult = result({ status: 'ended', hostPresent: false });
    await send('room_finished');
    await vi.advanceTimersByTimeAsync(0);
    expect(control.calls).toEqual([]);
  });

  it('a non-host leaving never arms the timer', async () => {
    db.roomEventResult = result({ isHost: false, hostPresent: true });
    await send('participant_left', 'u_student');
    expect(watch.pending).toBe(0);
  });
});

describe('HTTP server', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = createHttpServer({
      health: () => ({ ok: true, env: 'stg', busy: false, egressActive: egress.count > 0 }),
      onWebhook: (rawBody, auth) => handleWebhook(deps, rawBody, auth),
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('GET /health → 200 {ok, env, busy, egressActive}', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, env: 'stg', busy: false, egressActive: false });
  });

  it('POST /lk verifies the RAW body: valid → 200, bad signature → 401', async () => {
    const body = egressEvent('egress_started', 'stg_room1');
    const good = await fetch(`${base}/lk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/webhook+json', Authorization: await sign(body) },
      body,
    });
    expect(good.status).toBe(200);
    expect(egress.count).toBe(1);

    const bad = await fetch(`${base}/lk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/webhook+json',
        Authorization: await sign(body, 'wrong-secret-0123456789abcdefgh'),
      },
      body,
    });
    expect(bad.status).toBe(401);
  });

  it('unknown route → 404, wrong method → 405', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/lk`)).status).toBe(405);
  });
});
