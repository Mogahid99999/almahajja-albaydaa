// Read-only LiveKit server API calls for the recording guard (0146): is an
// egress still running, and is its (hidden, recorder) participant still in the
// room? The egress joins its room with identity = its egress id (egress
// BuildEgressToken). Internal URL + the internal key pair only; nothing here
// starts, stops or changes anything.

import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';
import { errorMessage } from './log.js';

export type EgressLookup =
  | { kind: 'found'; status: number; rawPath: string | null }
  /** LiveKit does not know this egress (or no longer). */
  | { kind: 'missing' }
  | { kind: 'error'; error: string }
  | { kind: 'unconfigured' };

export type PresenceLookup =
  | { kind: 'present' }
  | { kind: 'absent' }
  | { kind: 'room_gone' }
  | { kind: 'error'; error: string }
  | { kind: 'unconfigured' };

export interface LiveKitProbe {
  egress(egressId: string): Promise<EgressLookup>;
  /** Is participant `identity` (the egress id) in `room` right now? */
  presence(room: string, identity: string): Promise<PresenceLookup>;
}

export const UNCONFIGURED_PROBE: LiveKitProbe = {
  egress: async () => ({ kind: 'unconfigured' }),
  presence: async () => ({ kind: 'unconfigured' }),
};

function isNotFound(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string };
  return e?.status === 404 || e?.code === 'not_found' || /does not exist|not.?found/i.test(e?.message ?? '');
}

/** The `.ogg` among an egress's file results (manifests ignored), or null. */
export function oggOf(files: ReadonlyArray<{ filename?: string }> | undefined): string | null {
  for (const f of files ?? []) {
    const p = (f.filename ?? '').trim();
    if (p.toLowerCase().endsWith('.ogg')) return p;
  }
  return null;
}

export function createLiveKitProbe(url: string, apiKey: string, apiSecret: string, requestTimeoutSec = 10): LiveKitProbe {
  const egress = new EgressClient(url, apiKey, apiSecret, { requestTimeout: requestTimeoutSec, failover: false });
  const rooms = new RoomServiceClient(url, apiKey, apiSecret, { requestTimeout: requestTimeoutSec, failover: false });
  return {
    async egress(egressId) {
      try {
        const list = await egress.listEgress({ egressId });
        const info = list.find((e) => e.egressId === egressId);
        if (!info) return { kind: 'missing' };
        return { kind: 'found', status: Number(info.status), rawPath: oggOf(info.fileResults) };
      } catch (err) {
        if (isNotFound(err)) return { kind: 'missing' };
        return { kind: 'error', error: errorMessage(err, 200) };
      }
    },

    async presence(room, identity) {
      try {
        const participants = await rooms.listParticipants(room);
        if (participants.some((p) => p.identity === identity)) return { kind: 'present' };
        // An empty list may also mean "no such room" — ask.
        const found = await rooms.listRooms([room]);
        return found.some((r) => r.name === room) ? { kind: 'absent' } : { kind: 'room_gone' };
      } catch (err) {
        if (isNotFound(err)) return { kind: 'room_gone' };
        return { kind: 'error', error: errorMessage(err, 200) };
      }
    },
  };
}
