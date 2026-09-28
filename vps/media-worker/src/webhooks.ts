// LiveKit webhooks (POST /lk, internal network only). Every request is
// verified with WebhookReceiver (JWT signed with the env's API secret + sha256
// of the RAW body). One LiveKit server serves both envs; rooms are named
// `${WORKER_ENV}_…`, so each worker only acts on its own env's rooms.
// Signing key id on the live server: `almahajja_int` (same pair for both workers).
//
// egress_ended (confirmed on the live server 2026-09-28): status EGRESS_COMPLETE,
// fileResults[0].filename = the R2 key, e.g. `live-raw/stg_p0_rec-2026-09-28T164931.ogg`.
// A recording is enqueued for EGRESS_COMPLETE or EGRESS_LIMIT_REACHED (a partial
// recording is still a valid lesson) + an `.ogg` key; manifests
// (`live-raw/<egressId>.json`) are ignored; FAILED / ABORTED are logged only
// (the raw file, if any, is kept).

import type { WorkerEnv } from './config.js';
import type { JobDb } from './db.js';
import type { EgressTracker } from './egressTracker.js';
import { errorMessage, type Logger, silentLogger } from './log.js';

/** Structural subset of livekit-server-sdk's WebhookEvent that we use. */
export interface LkEventLike {
  event: string;
  id?: string;
  room?: { name?: string } | undefined;
  egressInfo?:
    | {
        egressId?: string;
        roomName?: string;
        status?: number;
        error?: string;
        fileResults?: Array<{ filename?: string; location?: string }>;
      }
    | undefined;
}

export interface WebhookVerifier {
  receive(body: string, authHeader?: string): Promise<LkEventLike>;
}

export interface WebhookDeps {
  verifier: WebhookVerifier;
  env: WorkerEnv;
  egress: EgressTracker;
  db: Pick<JobDb, 'enqueueLiveRecording'>;
  kick: () => void;
  log?: Logger;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

// livekit.EgressStatus
const EGRESS_STARTING = 0;
const EGRESS_ACTIVE = 1;
const EGRESS_ENDING = 2;
const EGRESS_COMPLETE = 3;
const EGRESS_LIMIT_REACHED = 6;
/** egress_ended statuses whose .ogg output becomes a lecture. */
const ENQUEUE_STATUSES = new Set([EGRESS_COMPLETE, EGRESS_LIMIT_REACHED]);
const EGRESS_STATUS_NAMES = ['STARTING', 'ACTIVE', 'ENDING', 'COMPLETE', 'FAILED', 'ABORTED', 'LIMIT_REACHED'];

function statusName(status: number | undefined): string {
  return status === undefined ? 'unknown' : (EGRESS_STATUS_NAMES[status] ?? String(status));
}

/** The `.ogg` recording key among the egress outputs (manifests etc. ignored), or null. */
export function rawKeyOf(info: LkEventLike['egressInfo']): string | null {
  for (const f of info?.fileResults ?? []) {
    const key = (f.filename ?? '').replace(/^\/+/, '');
    if (key.toLowerCase().endsWith('.ogg')) return key;
  }
  return null;
}

export function roomNameOf(ev: LkEventLike): string {
  return ev.room?.name || ev.egressInfo?.roomName || '';
}

export async function handleWebhook(
  deps: WebhookDeps,
  rawBody: string,
  authHeader: string | undefined,
): Promise<WebhookResult> {
  const log = deps.log ?? silentLogger;
  let ev: LkEventLike;
  try {
    // LiveKit sends the bare JWT; tolerate a "Bearer " prefix.
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    ev = await deps.verifier.receive(rawBody, token);
  } catch (err) {
    log('warn', 'lk.rejected', { reason: errorMessage(err, 120) });
    return { status: 401, body: { ok: false, error: 'invalid signature' } };
  }

  const room = roomNameOf(ev);
  if (!room.startsWith(`${deps.env}_`)) {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const egressId = ev.egressInfo?.egressId ?? '';
  log('info', 'lk.event', { event: ev.event, room, egress: egressId || undefined });

  switch (ev.event) {
    case 'egress_started':
      deps.egress.started(egressId, room);
      return ok();

    case 'egress_updated': {
      // Re-arms the deferral after a worker restart mid-session.
      const s = ev.egressInfo?.status;
      if (s === EGRESS_STARTING || s === EGRESS_ACTIVE || s === EGRESS_ENDING) deps.egress.started(egressId, room);
      else deps.egress.ended(egressId);
      return ok();
    }

    case 'egress_ended': {
      deps.egress.ended(egressId);
      const status = ev.egressInfo?.status;
      const rawKey = rawKeyOf(ev.egressInfo);
      const statusOk = status !== undefined && ENQUEUE_STATUSES.has(status);
      if (!statusOk || !rawKey) {
        // Not enqueued; any raw file stays in live-raw/ for manual recovery.
        log('warn', 'lk.egress_not_enqueued', {
          room,
          egress: egressId,
          status: statusName(status),
          raw: rawKey ?? undefined,
          reason: !statusOk ? 'status' : 'no .ogg output',
          error: ev.egressInfo?.error ? errorMessage(ev.egressInfo.error, 200) : undefined,
        });
        deps.kick();
        return ok();
      }
      try {
        // P2 — RPC pending: enqueue_live_recording.
        await deps.db.enqueueLiveRecording(room, egressId, rawKey);
      } catch (err) {
        log('error', 'lk.enqueue_failed', { room, egress: egressId, error: errorMessage(err, 200) });
        deps.kick();
        return { status: 500, body: { ok: false, error: 'enqueue failed' } };
      }
      log('info', 'lk.recording_enqueued', { room, egress: egressId, raw: rawKey, status: statusName(status) });
      deps.kick();
      return ok();
    }

    case 'room_finished':
      // P2 — pending: safety-net `live_sessions.status = ended` (D4) via RPC.
      deps.egress.roomFinished(room);
      deps.kick();
      return ok();

    // P2 — pending: room_started, participant_joined/left (peak count),
    // track_published/unpublished (spoke_seconds). Logged only for now.
    default:
      return ok();
  }
}

function ok(): WebhookResult {
  return { status: 200, body: { ok: true } };
}
