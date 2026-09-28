// Tracks LiveKit egresses (live recordings) running for THIS env's rooms, so
// the worker can hold back CPU-heavy lecture transcodes while a session is on
// air. Each entry expires after `maxAgeMs` (default 3 h): a lost
// `egress_ended` webhook can delay work, never block it forever.
//
// State is in memory only — after a worker restart mid-session the next
// `egress_started`/`egress_updated` is what re-arms it.

export const DEFAULT_MAX_DEFER_MS = 3 * 60 * 60 * 1000;

interface Entry {
  roomName: string;
  since: number;
}

export class EgressTracker {
  private readonly active = new Map<string, Entry>();

  constructor(
    private readonly maxAgeMs = DEFAULT_MAX_DEFER_MS,
    private readonly now: () => number = Date.now,
  ) {}

  started(egressId: string, roomName: string): void {
    if (!egressId) return;
    // keep the original start time on duplicate/updated events
    if (!this.active.has(egressId)) this.active.set(egressId, { roomName, since: this.now() });
  }

  ended(egressId: string): void {
    this.active.delete(egressId);
  }

  /** Safety net: a finished room cannot still be recording. */
  roomFinished(roomName: string): void {
    for (const [id, e] of this.active) if (e.roomName === roomName) this.active.delete(id);
  }

  /** Drops expired entries; returns the ids dropped (for logging). */
  prune(): string[] {
    const cutoff = this.now() - this.maxAgeMs;
    const dropped: string[] = [];
    for (const [id, e] of this.active) {
      if (e.since <= cutoff) {
        this.active.delete(id);
        dropped.push(id);
      }
    }
    return dropped;
  }

  isActive(): boolean {
    this.prune();
    return this.active.size > 0;
  }

  get count(): number {
    return this.active.size;
  }
}
