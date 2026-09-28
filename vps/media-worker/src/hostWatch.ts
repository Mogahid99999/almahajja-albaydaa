// D4 — auto-end a `live` session whose host has been gone for 10 minutes, or
// whose LiveKit room finished while the session was still `live`.
//
// Fed with every `live_room_event` result (webhooks.ts):
//   participant_left, is_host, host not present, status live → arm a timer
//   any event with host_present = true (host rejoined)        → cancel it
//   any event whose session is no longer live                 → cancel it
//   room_finished while still live                            → auto_end now
// Timers are in memory; after a restart the next event / room_finished
// restores the state (accepted in the plan).

import type { RoomEventResult } from './db.js';
import type { AutoEndReason, LiveControl } from './liveControl.js';
import { errorMessage, type Logger, silentLogger } from './log.js';

export const HOST_ABSENT_GRACE_MS = 10 * 60 * 1000;

export class HostAbsenceWatch {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly log: Logger;
  private stopped = false;

  constructor(
    private readonly control: LiveControl,
    private readonly opts: { graceMs?: number; log?: Logger } = {},
  ) {
    this.log = opts.log ?? silentLogger;
  }

  /** Number of sessions currently counting down. */
  get pending(): number {
    return this.timers.size;
  }

  isArmed(sessionId: string): boolean {
    return this.timers.has(sessionId);
  }

  /** Returns a promise only when an auto_end call was made (for tests / logging). */
  onRoomEvent(event: string, r: RoomEventResult | null): Promise<void> | void {
    if (!r || this.stopped) return;
    if (r.status !== 'live') {
      this.cancel(r.sessionId, 'not_live');
      return;
    }
    if (event === 'room_finished') {
      this.cancel(r.sessionId, 'room_finished');
      return this.end(r.sessionId, 'room_finished');
    }
    if (r.hostPresent) {
      this.cancel(r.sessionId, 'host_back');
      return;
    }
    if (event === 'participant_left' && r.isHost) this.arm(r.sessionId);
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private arm(sessionId: string): void {
    if (this.timers.has(sessionId)) return; // keep the original deadline
    const graceMs = this.opts.graceMs ?? HOST_ABSENT_GRACE_MS;
    const t = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.end(sessionId, 'host_absent');
    }, graceMs);
    t.unref?.();
    this.timers.set(sessionId, t);
    this.log('info', 'live.host_absent_timer', { session: sessionId, minutes: Math.round(graceMs / 60_000) });
  }

  private cancel(sessionId: string, why: string): void {
    const t = this.timers.get(sessionId);
    if (!t) return;
    clearTimeout(t);
    this.timers.delete(sessionId);
    this.log('info', 'live.host_absent_cancelled', { session: sessionId, reason: why });
  }

  private async end(sessionId: string, reason: AutoEndReason): Promise<void> {
    if (this.stopped) return;
    try {
      await this.control.autoEnd(sessionId, reason);
      this.log('info', 'live.auto_end', { session: sessionId, reason });
    } catch (err) {
      this.log('error', 'live.auto_end_failed', { session: sessionId, reason, error: errorMessage(err, 200) });
    }
  }
}
