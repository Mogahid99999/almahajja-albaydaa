// LiveKit webhooks (POST /lk, internal network only). Every request is
// verified with WebhookReceiver (JWT signed with the webhook key + sha256 of the
// RAW body). One LiveKit server serves both envs; rooms are named
// `${WORKER_ENV}_…`, so each worker only acts on its own env's rooms.
// Signing key id on the live server: `almahajja_int` (same pair for both workers).
//
// egress_ended (P2): egress writes the raw to the VPS disk, and
// fileResults[].filename is the LOCAL path `/recordings/<env>/<room>-<time>.ogg`.
// A recording is enqueued (`enqueue_live_recording(room, egress, raw_path)`)
// only for EGRESS_COMPLETE / EGRESS_LIMIT_REACHED (a partial recording is still
// a lesson) + an `.ogg` output that exists as a regular file inside
// RECORDINGS_DIR (symlink / `..` escapes refused). Manifests (`.json`) are
// ignored; FAILED / ABORTED are logged only. The raw is never deleted here.
//
// Room lifecycle events go to `live_room_event(...)`; its result feeds the D4
// host-absence watch (hostWatch.ts).

import type { WorkerEnv } from './config.js';
import type { JobDb, RoomEventResult } from './db.js';
import type { EgressTracker } from './egressTracker.js';
import { errorMessage, type Logger, silentLogger } from './log.js';
import type { RecordingsDir } from './recordings.js';

/** Structural subset of livekit-server-sdk's WebhookEvent that we use. */
export interface LkEventLike {
  event: string;
  id?: string;
  room?: { name?: string; numParticipants?: number } | undefined;
  participant?: { identity?: string } | undefined;
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

export interface RoomEventSink {
  onRoomEvent(event: string, result: RoomEventResult | null): Promise<void> | void;
}

export interface WebhookDeps {
  verifier: WebhookVerifier;
  env: WorkerEnv;
  egress: EgressTracker;
  db: Pick<JobDb, 'enqueueLiveRecording' | 'liveRoomEvent'>;
  recordings: Pick<RecordingsDir, 'check'>;
  hostWatch?: RoomEventSink;
  kick: () => void;
  log?: Logger;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/** Events forwarded to `live_room_event`. */
export const ROOM_EVENTS = new Set([
  'room_started',
  'room_finished',
  'participant_joined',
  'participant_left',
  'track_published',
  'track_unpublished',
]);

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

/** The `.ogg` recording path among the egress outputs (manifests etc. ignored), or null. */
export function rawPathOf(info: LkEventLike['egressInfo']): string | null {
  for (const f of info?.fileResults ?? []) {
    const p = (f.filename ?? '').trim();
    if (p.toLowerCase().endsWith('.ogg')) return p;
  }
  return null;
}

export function roomNameOf(ev: LkEventLike): string {
  return ev.room?.name || ev.egressInfo?.roomName || '';
}

function baseNameOf(p: string): string {
  return p.split(/[\\/]/).pop() ?? '';
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

    case 'egress_ended':
      return egressEnded(deps, log, ev, room, egressId);

    default:
      if (ROOM_EVENTS.has(ev.event)) return roomEvent(deps, log, ev, room);
      return ok();
  }
}

async function egressEnded(
  deps: WebhookDeps,
  log: Logger,
  ev: LkEventLike,
  room: string,
  egressId: string,
): Promise<WebhookResult> {
  deps.egress.ended(egressId);
  const status = ev.egressInfo?.status;
  const rawPath = rawPathOf(ev.egressInfo);
  const statusOk = status !== undefined && ENQUEUE_STATUSES.has(status);
  if (!statusOk || !rawPath) {
    // Not enqueued; any raw file stays on disk for manual recovery.
    log('warn', 'lk.egress_not_enqueued', {
      room,
      egress: egressId,
      status: statusName(status),
      raw: rawPath ? baseNameOf(rawPath) : undefined,
      reason: !statusOk ? 'status' : 'no .ogg output',
      error: ev.egressInfo?.error ? errorMessage(ev.egressInfo.error, 200) : undefined,
    });
    deps.kick();
    return ok();
  }

  const local = await deps.recordings.check(rawPath);
  if (typeof local === 'string') {
    // Missing / outside RECORDINGS_DIR / escape attempt → never enqueue a path
    // we can't safely read. 500 lets LiveKit redeliver if it was a timing issue.
    log('error', 'lk.recording_unusable', { room, egress: egressId, raw: baseNameOf(rawPath), reason: local });
    deps.kick();
    return { status: local === 'missing' ? 500 : 200, body: { ok: false, error: `recording ${local}` } };
  }

  try {
    const jobId = await deps.db.enqueueLiveRecording(room, egressId, local.path);
    log('info', 'lk.recording_enqueued', {
      room,
      egress: egressId,
      raw: local.name,
      bytes: local.size,
      status: statusName(status),
      job: jobId ?? 'deferred_until_end',
    });
  } catch (err) {
    log('error', 'lk.enqueue_failed', { room, egress: egressId, error: errorMessage(err, 200) });
    deps.kick();
    return { status: 500, body: { ok: false, error: 'enqueue failed' } };
  }
  deps.kick();
  return ok();
}

async function roomEvent(deps: WebhookDeps, log: Logger, ev: LkEventLike, room: string): Promise<WebhookResult> {
  if (ev.event === 'room_finished') {
    deps.egress.roomFinished(room);
    deps.kick();
  }
  const identity = ev.participant?.identity || null;
  const num = typeof ev.room?.numParticipants === 'number' ? ev.room.numParticipants : null;
  let result: RoomEventResult | null;
  try {
    result = await deps.db.liveRoomEvent(room, ev.event, identity, num);
  } catch (err) {
    // Informational for most events; room_finished is re-derived by the next
    // lifecycle call anyway. Return 500 so LiveKit may redeliver.
    log('error', 'lk.room_event_failed', { room, event: ev.event, error: errorMessage(err, 200) });
    return { status: 500, body: { ok: false, error: 'room event failed' } };
  }
  // Not awaited: an auto_end call must not hold up LiveKit's webhook delivery.
  void deps.hostWatch?.onRoomEvent(ev.event, result);
  return ok();
}

function ok(): WebhookResult {
  return { status: 200, body: { ok: true } };
}
