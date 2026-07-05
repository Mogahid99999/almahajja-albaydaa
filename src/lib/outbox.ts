/**
 * Offline outbox (V11 · B) — the write-side sync queue.
 *
 * When the device is offline (or a write fails), listening ticks, note edits and
 * weekly-goal changes are COALESCED into a tiny AsyncStorage-backed queue instead
 * of being dropped. On reconnect / app-foreground / post-boot / a 60s heartbeat
 * while non-empty, the queue is REPLAYED — activity entries in chronological day
 * order, each credited to the day it actually happened (save_activity's day-aware
 * replay), so المداومة (the streak) is never broken by having been offline.
 *
 * Accepted tradeoffs (by design, per the plan): a lost-ack retry can double-credit
 * a few seconds (bounded by the server's 6h/day clamp); a replayed completion
 * stamps midnight of its day; quizzes stay online-only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/constants/queryKeys';
import { isOnline, onReconnect } from '@/lib/connectivity';
import { replayActivity } from '@/api/progress';
import { saveMyNote } from '@/api/notes';
import { setWeeklyGoal } from '@/api/journey';
import type { GoalMetric } from '@/api/types';

const KEY = 'offline-outbox-v1';
// Prefix key: invalidating this refreshes every journey-* query (summary, streak,
// weekly goal, badges) — queryKeys.journey is only the summary leaf.
const JOURNEY_ROOT = ['journey'] as const;

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

// ── Enqueue (coalescing keeps the queue tiny) ────────────────────────────────

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
  await persist();
  scheduleHeartbeat();
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
  scheduleHeartbeat();
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
  scheduleHeartbeat();
}

// ── Flush ────────────────────────────────────────────────────────────────────

let flushing: Promise<void> | null = null;

/** Drain the queue (guarded by a single in-flight promise). Safe to call often. */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(): Promise<void> {
  const q = await load();
  if (q.length === 0) {
    stopHeartbeat();
    return;
  }
  if (!(await isOnline())) return;

  // Activity replays in chronological day order (the streak math needs
  // chronological inserts); notes/goals order is irrelevant, so keep them last.
  const ordered = [...q].sort((a, b) => {
    if (a.kind === 'activity' && b.kind === 'activity') {
      return a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
    }
    if (a.kind === 'activity') return -1;
    if (b.kind === 'activity') return 1;
    return 0;
  });

  let didActivity = false;
  let didGoal = false;
  const noteIds: string[] = [];
  for (const entry of ordered) {
    try {
      if (entry.kind === 'activity') {
        await replayActivity(entry);
        didActivity = true;
      } else if (entry.kind === 'note') {
        await saveMyNote(entry.lectureId, entry.body);
        noteIds.push(entry.lectureId);
      } else {
        await setWeeklyGoal(entry.metric, entry.target);
        didGoal = true;
      }
    } catch {
      // Stop on the first failure (the network likely dropped again) — retry later.
      break;
    }
    // Remove this exact entry only after its call succeeded.
    const i = queue.indexOf(entry);
    if (i >= 0) queue.splice(i, 1);
    await persist();
  }

  // Refresh exactly what the committed writes moved, so a reconnect refetch can't
  // flicker the UI back to the pre-edit server value. The JOURNEY ROOT (['journey'])
  // covers summary + streak + weekly goal + badges — the Home streak card
  // («واصلت اليوم») and رحلتي العلمية all live under it.
  if (didActivity || didGoal) {
    void queryClient.invalidateQueries({ queryKey: JOURNEY_ROOT });
    void queryClient.invalidateQueries({ queryKey: queryKeys.home });
  }
  for (const id of noteIds) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lectureNote(id) });
  }
  if (queue.length === 0) stopHeartbeat();
}

// ── Triggers ───────────────────────────────────────────────────────────────

let heartbeat: ReturnType<typeof setInterval> | null = null;

/** A 60s heartbeat that runs ONLY while the queue is non-empty. */
function scheduleHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    void (async () => {
      if (!(await hasPending())) {
        stopHeartbeat();
        return;
      }
      await flushOutbox();
    })();
  }, 60_000);
}

function stopHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

let started = false;

/**
 * Wire the outbox triggers once, after the session is ready: flush on reconnect,
 * a one-shot post-boot drain, and (re)arm the heartbeat if anything is pending.
 * AppState→active flushing is piggybacked on the existing onActive hook in
 * app/_layout.tsx. Idempotent.
 */
export function startOutbox(): void {
  if (started) return;
  started = true;
  onReconnect(() => {
    void flushOutbox();
  });
  void (async () => {
    if (await hasPending()) {
      scheduleHeartbeat();
      void flushOutbox();
    }
  })();
}
