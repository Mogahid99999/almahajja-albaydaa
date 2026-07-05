/**
 * Offline outbox (V11 · B) — the write-side sync queue's FLUSH/REPLAY half.
 *
 * When the device is offline (or a write fails), listening ticks, note edits and
 * weekly-goal changes are COALESCED into a tiny AsyncStorage-backed queue instead
 * of being dropped (the queue storage + enqueue functions live in `outboxQueue.ts`
 * — split out to avoid a require-cycle, since `api/progress.ts` needs to enqueue
 * but this file needs `replayActivity` back from `api/progress.ts`). On reconnect
 * / app-foreground / post-boot / a 60s heartbeat while non-empty, the queue is
 * REPLAYED — activity entries in chronological day order, each credited to the
 * day it actually happened (save_activity's day-aware replay), so المداومة (the
 * streak) is never broken by having been offline.
 *
 * Accepted tradeoffs (by design, per the plan): a lost-ack retry can double-credit
 * a few seconds (bounded by the server's 6h/day clamp); a replayed completion
 * stamps midnight of its day; quizzes stay online-only.
 */
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/constants/queryKeys';
import { isOnline, onReconnect } from '@/lib/connectivity';
import { replayActivity } from '@/api/progress';
import { saveMyNote } from '@/api/notes';
import { setWeeklyGoal } from '@/api/journey';
import { hasPending, loadQueue, removeQueueEntry, setOnEnqueue } from '@/lib/outboxQueue';

export type { OutboxActivity, OutboxEntry, OutboxGoal, OutboxNote } from '@/lib/outboxQueue';
export { enqueueActivity, enqueueGoal, enqueueNote, hasPending, localDay } from '@/lib/outboxQueue';

// Prefix key: invalidating this refreshes every journey-* query (summary, streak,
// weekly goal, badges) — queryKeys.journey is only the summary leaf.
const JOURNEY_ROOT = ['journey'] as const;

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
  const q = await loadQueue();
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
    await removeQueueEntry(entry);
  }

  // Refresh exactly what the committed writes moved, so a reconnect refetch can't
  // flicker the UI back to the pre-edit server value. The JOURNEY ROOT (['journey'])
  // covers summary + streak + weekly goal + badges — the Home streak card
  // («واصلت اليوم») and رحلتي العلمية all live under it.
  //
  // Phase 3.6 fix: a replayed ACTIVITY entry can complete/advance a lecture whose
  // SECTION detail page (`queryKeys.section`) is cached from before this replay —
  // e.g. a completion recorded while offline, replayed here on reconnect. Without
  // this, `home`'s rollup card refreshes but the section's own drill-down page
  // keeps showing the pre-replay percentage indefinitely (this is what produced
  // the "guest completion lost" symptom: not a dropped DB row — `save_activity`
  // OR-merges `completed` and never un-sets it — but a section page that was never
  // told to refetch). The replay doesn't know which section(s) it touched, so
  // invalidate the whole `['section']` root (partial match) — cheap and rare
  // (only runs when the outbox actually had something queued).
  if (didActivity || didGoal) {
    void queryClient.invalidateQueries({ queryKey: JOURNEY_ROOT });
    void queryClient.invalidateQueries({ queryKey: queryKeys.home });
  }
  if (didActivity) {
    void queryClient.invalidateQueries({ queryKey: ['section'] });
  }
  for (const id of noteIds) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.lectureNote(id) });
  }
  if (!(await hasPending())) stopHeartbeat();
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

// Arm the heartbeat the instant something new is enqueued (rather than waiting
// for the next foreground/reconnect trigger) — matches the pre-split behavior
// where enqueue and the heartbeat lived in the same module.
setOnEnqueue(scheduleHeartbeat);

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
