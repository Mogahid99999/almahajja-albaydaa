import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EgressTracker } from '../src/egressTracker.js';
import { createHttpServer } from '../src/server.js';
import { handleWebhook, type WebhookDeps } from '../src/webhooks.js';
import { FakeDb } from './fakes.js';

const KEY = 'APItestkey';
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

let db: FakeDb;
let egress: EgressTracker;
let kick: ReturnType<typeof vi.fn<() => void>>;
let deps: WebhookDeps;

beforeEach(() => {
  db = new FakeDb();
  egress = new EgressTracker();
  kick = vi.fn<() => void>();
  deps = { verifier: new WebhookReceiver(KEY, SECRET), env: 'stg', egress, db, kick };
});

describe('handleWebhook', () => {
  it('egress_started for our env → deferral armed', async () => {
    const body = egressEvent('egress_started', 'stg_room1');
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(egress.count).toBe(1);
  });

  it('ignores rooms of the other env (and never touches state)', async () => {
    const body = egressEvent('egress_started', 'prd_room1');
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(egress.count).toBe(0);
    expect(kick).not.toHaveBeenCalled();
  });

  it('ignores un-prefixed rooms (e.g. "stgroom")', async () => {
    const body = egressEvent('egress_started', 'stgroom');
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.body).toMatchObject({ ignored: true });
  });

  it('egress_ended → deferral released, live_recording enqueued with the raw key, loop kicked', async () => {
    egress.started('EG_abc', 'stg_room1');
    const body = egressEvent('egress_ended', 'stg_room1', {
      status: 'EGRESS_COMPLETE',
      fileResults: [{ filename: 'live-raw/stg_room1-2026-09-28T190000.ogg', size: '123456' }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(egress.count).toBe(0);
    expect(db.enqueued).toEqual([
      { room: 'stg_room1', egress: 'EG_abc', raw: 'live-raw/stg_room1-2026-09-28T190000.ogg' },
    ]);
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it('egress_ended without a file → nothing enqueued, still kicked', async () => {
    egress.started('EG_abc', 'stg_room1');
    const body = egressEvent('egress_ended', 'stg_room1', { status: 'EGRESS_FAILED', error: 'no audio' });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(db.enqueued).toEqual([]);
    expect(egress.count).toBe(0);
    expect(kick).toHaveBeenCalled();
  });

  it('enqueue failure → 500 so LiveKit can retry', async () => {
    db.enqueueError = new Error('enqueue_live_recording failed: 404');
    const body = egressEvent('egress_ended', 'stg_room1', {
      status: 'EGRESS_COMPLETE',
      fileResults: [{ filename: 'live-raw/x.ogg' }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(500);
  });

  it('real payload shape from the live server (2026-09-28) → enqueued', async () => {
    const body = egressEvent('egress_ended', 'stg_p0_rec', {
      egressId: 'EG_live',
      status: 'EGRESS_COMPLETE',
      fileResults: [{ filename: 'live-raw/stg_p0_rec-2026-09-28T164931.ogg', size: '48213', duration: '61000000000' }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(db.enqueued).toEqual([
      { room: 'stg_p0_rec', egress: 'EG_live', raw: 'live-raw/stg_p0_rec-2026-09-28T164931.ogg' },
    ]);
  });

  it('EGRESS_LIMIT_REACHED with an .ogg → enqueued like COMPLETE (a partial lesson beats a lost one)', async () => {
    const body = egressEvent('egress_ended', 'stg_room1', {
      status: 'EGRESS_LIMIT_REACHED',
      fileResults: [{ filename: 'live-raw/EG_abc.json' }, { filename: 'live-raw/stg_room1-long.ogg' }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(db.enqueued).toEqual([{ room: 'stg_room1', egress: 'EG_abc', raw: 'live-raw/stg_room1-long.ogg' }]);
  });

  it('EGRESS_LIMIT_REACHED without an .ogg → not enqueued', async () => {
    const body = egressEvent('egress_ended', 'stg_room1', {
      status: 'EGRESS_LIMIT_REACHED',
      fileResults: [{ filename: 'live-raw/EG_abc.json' }],
    });
    await handleWebhook(deps, body, await sign(body));
    expect(db.enqueued).toEqual([]);
  });

  it.each(['EGRESS_FAILED', 'EGRESS_ABORTED'])(
    '%s with a file → logged only, NOT enqueued (raw kept)',
    async (status) => {
      const events: string[] = [];
      deps.log = (_l, e) => void events.push(e);
      const body = egressEvent('egress_ended', 'stg_room1', {
        status,
        error: 'pipeline stalled',
        fileResults: [{ filename: 'live-raw/stg_room1-partial.ogg' }],
      });
      const r = await handleWebhook(deps, body, await sign(body));
      expect(r.status).toBe(200);
      expect(db.enqueued).toEqual([]);
      expect(events).toContain('lk.egress_not_enqueued');
      expect(kick).toHaveBeenCalled();
    },
  );

  it('ignores the egress manifest (.json): only the .ogg is enqueued', async () => {
    const body = egressEvent('egress_ended', 'stg_room1', {
      status: 'EGRESS_COMPLETE',
      fileResults: [{ filename: 'live-raw/EG_abc.json' }, { filename: 'live-raw/stg_room1-t.ogg' }],
    });
    await handleWebhook(deps, body, await sign(body));
    expect(db.enqueued.map((e) => e.raw)).toEqual(['live-raw/stg_room1-t.ogg']);
  });

  it('COMPLETE with only a .json manifest → nothing enqueued', async () => {
    const body = egressEvent('egress_ended', 'stg_room1', {
      status: 'EGRESS_COMPLETE',
      fileResults: [{ filename: 'live-raw/EG_abc.json' }],
    });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(db.enqueued).toEqual([]);
  });

  it('room_finished (room payload) clears any egress still tracked for that room', async () => {
    egress.started('EG_abc', 'stg_room1');
    const body = JSON.stringify({ event: 'room_finished', room: { name: 'stg_room1', sid: 'RM_1' } });
    const r = await handleWebhook(deps, body, await sign(body));
    expect(r.status).toBe(200);
    expect(egress.count).toBe(0);
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

describe('HTTP server', () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    server = createHttpServer({
      health: () => ({ ok: true, env: 'stg', busy: false, egressActive: egress.count > 0 }),
      onWebhook: (raw, auth) => handleWebhook(deps, raw, auth),
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
      headers: { 'Content-Type': 'application/webhook+json', Authorization: await sign(body, 'wrong-secret-0123456789abcdefgh') },
      body,
    });
    expect(bad.status).toBe(401);
  });

  it('unknown route → 404, wrong method → 405', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/lk`)).status).toBe(405);
  });
});
