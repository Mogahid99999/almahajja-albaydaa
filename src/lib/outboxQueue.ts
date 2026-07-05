/**
 * Offline outbox queue storage (V11 · B, split out to break a require-cycle:
 * `outbox.ts` needs `replayActivity` from `api/progress.ts`, which in turn needs
 * `enqueueActivity`/`localDay` — so those two primitives live here, with no
 * dependency back on `outbox.ts` or `api/progress.ts`, and both of those import
 * FROM this module instead of from each other.
 *
 * See `outbox.ts` for the flush/replay side (that's still the file to read for
 * how the queue is drained).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GoalMetric } from '@/api/types';

const KEY = 'offline-outbox-v1';

/** One coalesced listening entry per (lectureId, day). */
export type OutboxActivity = {
  kind: 'activity';
  lectureId: string;
  /** YYYY-MM-DD, device-local (streak days are device-local). */
  day: string;
  positionSec: number;
  durationSec: number;
  deltaSec: number;
  completed: boolean;
};
/** One entry per lectureId — last write wins. */
export type OutboxNote = { kind: 'note'; lectureId: string; body: string; updatedAt: string };
/** One entry total — last write wins. */
export type OutboxGoal = { kind: 'goal'; metric: GoalMetric; target: number };
export type OutboxEntry = OutboxActivity | OutboxNote | OutboxGoal;

/** Device-local YYYY-MM-DD (the day the activity is credited to). */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// In-memory mirror so enqueue/flush never race on the async read. Loaded lazily.
let queue: OutboxEntry[] = [];
let loaded = false;
let loadPromise: Promise<OutboxEntry[]> | null = null;

async function load(): Promise<OutboxEntry[]> {
  if (loaded) return queue;
  // Cache the in-flight read so concurrent callers share one AsyncStorage load
  // (two parallel reads would otherwise clobber each other's just-pushed entries).
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        queue = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
      } catch {
        queue = [];
      }
      loaded = true;
      return queue;
    })();
  }
  return loadPromise;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* best-effort; the in-memory mirror still drives this session */
  }
}

/** Whether anything is queued (drives the boot flush + the 60s heartbeat). */
export async function hasPending(): Promise<boolean> {
  return (await load()).length > 0;
}

/** Live queue snapshot, in enqueue order (flush side reorders as it needs). */
export async function loadQueue(): Promise<OutboxEntry[]> {
  return load();
}

/** Remove one entry (by reference) after the flush side has committed it. */
export async function removeQueueEntry(entry: OutboxEntry): Promise<void> {
  const q = await load();
  const i = q.indexOf(entry);
  if (i >= 0) q.splice(i, 1);
  await persist();
}

// Fired after every successful enqueue so the flush side (outbox.ts) can arm its
// retry heartbeat — set once via `setOnEnqueue` at that module's load time. Kept
// as a plain callback (not an import) so this module never depends on outbox.ts.
let onEnqueue: (() => void) | null = null;
export function setOnEnqueue(fn: () => void): void {
  onEnqueue = fn;
}

// ── Enqueue (coalescing keeps the queue tiny) ────────────────────────────────

// Activity entries coalesce per (lectureId, day), so the only way this queue
// grows unbounded is a device staying offline (or failing every replay) across
// many distinct lecture/day pairs. Cap it so a months-long dry spell can't turn
// the AsyncStorage-backed queue into an ever-growing blob — the oldest days are
// dropped first since the most recent activity is what still matters for an
// accurate resume/streak once the device reconnects.
const MAX_ACTIVITY_ENTRIES = 120;

function capActivityEntries(q: OutboxEntry[]): void {
  const activityEntries = q.filter((x): x is OutboxActivity => x.kind === 'activity');
  if (activityEntries.length <= MAX_ACTIVITY_ENTRIES) return;
  const oldestFirst = [...activityEntries].sort((a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
  );
  const toDrop = new Set(oldestFirst.slice(0, activityEntries.length - MAX_ACTIVITY_ENTRIES));
  for (let i = q.length - 1; i >= 0; i--) {
    if (toDrop.has(q[i] as OutboxActivity)) q.splice(i, 1);
  }
}

export async function enqueueActivity(e: Omit<OutboxActivity, 'kind'>): Promise<void> {
  const q = await load();
  const existing = q.find(
    (x): x is OutboxActivity =>
      x.kind === 'activity' && x.lectureId === e.lectureId && x.day === e.day,
  );
  if (existing) {
    existing.deltaSec += Math.max(0, e.deltaSec);
    existing.positionSec = Math.max(existing.positionSec, e.positionSec);
    if (e.durationSec > 0) existing.durationSec = e.durationSec;
    existing.completed = existing.completed || e.completed;
  } else {
    q.push({ kind: 'activity', ...e, deltaSec: Math.max(0, e.deltaSec) });
  }
  capActivityEntries(q);
  await persist();
  onEnqueue?.();
}

export async function enqueueNote(lectureId: string, body: string): Promise<void> {
  const q = await load();
  const existing = q.find((x): x is OutboxNote => x.kind === 'note' && x.lectureId === lectureId);
  const updatedAt = new Date().toISOString();
  if (existing) {
    existing.body = body;
    existing.updatedAt = updatedAt;
  } else {
    q.push({ kind: 'note', lectureId, body, updatedAt });
  }
  await persist();
  onEnqueue?.();
}

export async function enqueueGoal(metric: GoalMetric, target: number): Promise<void> {
  const q = await load();
  const existing = q.find((x): x is OutboxGoal => x.kind === 'goal');
  if (existing) {
    existing.metric = metric;
    existing.target = target;
  } else {
    q.push({ kind: 'goal', metric, target });
  }
  await persist();
  onEnqueue?.();
}
