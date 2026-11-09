/**
 * Delivery of attempts finished on the device (0174). The outbox decides when
 * (reconnect, foreground, boot, the 60 s heartbeat); this file decides what.
 *
 * The local copy goes only after the server has confirmed it. A retry after a
 * lost response is harmless: finalize_quiz_attempt returns the existing result.
 */
import { finalizeAttempt, getSessionUserId } from '@/api/quizzes';
import type { QuizResult } from '@/api/types';
import { queryKeys } from '@/constants/queryKeys';
import { enqueueQuizSubmit } from '@/lib/outboxQueue';
import { queryClient } from '@/lib/queryClient';
import {
  type LocalQuizAttempt,
  answersForServer,
  getLocalAttempt,
  listLocalAttempts,
  lockLocalAttempt,
  persistClock,
  removeLocalAttempt,
} from '@/lib/quizAttemptStore';
import { advanceClock, clockSample, remainingSeconds } from '@/lib/quizClock';

/** The server's own wording when the attempt no longer exists. */
const GONE = 'المحاولة غير موجودة';

const syncedListeners = new Set<(attemptId: string) => void>();

export function onQuizSynced(listener: (attemptId: string) => void): () => void {
  syncedListeners.add(listener);
  return () => {
    syncedListeners.delete(listener);
  };
}

function refreshQuizViews(): void {
  void queryClient.invalidateQueries({ queryKey: ['quizzes'] });
  void queryClient.invalidateQueries({ queryKey: ['section'] });
  void queryClient.invalidateQueries({ queryKey: ['certificates'] });
}

/** Resolves when there is nothing left to send; throws so the outbox retries. */
export async function syncQuizAttempt(attemptId: string): Promise<void> {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('no session');
  const attempt = await getLocalAttempt(userId, attemptId);
  // Another account's attempt stays on disk; recovery queues it again for its owner.
  if (!attempt || attempt.phase !== 'locked') return;

  let result: QuizResult | null = null;
  try {
    result = await finalizeAttempt(
      attemptId,
      answersForServer(attempt),
      attempt.finishedAtWall == null ? null : new Date(attempt.finishedAtWall).toISOString(),
    );
  } catch (err) {
    if (!(err instanceof Object && (err as { message?: string }).message === GONE)) throw err;
  }
  if (result) queryClient.setQueryData(queryKeys.quizResult(attemptId), result);
  await removeLocalAttempt(attempt);
  refreshQuizViews();
  for (const listener of syncedListeners) listener(attemptId);
}

// The open solver finishes its own attempt, after saving the last typed words.
const onScreen = new Set<string>();

export function attachQuizScreen(attemptId: string): () => void {
  onScreen.add(attemptId);
  return () => {
    onScreen.delete(attemptId);
  };
}

let requestFlush: (() => void) | null = null;

/** Set once by outbox.ts, which imports this module. */
export function setQuizFlushTrigger(fn: () => void): void {
  requestFlush = fn;
}

async function lockIfExpired(a: LocalQuizAttempt): Promise<void> {
  if (a.phase !== 'active' || a.timeLimitSec == null || onScreen.has(a.attemptId)) return;
  a.clock = advanceClock(a.clock, clockSample());
  if (remainingSeconds(a.clock) === 0) await lockLocalAttempt(a, 'timeout', Date.now());
  else await persistClock(a);
}

let watcher: ReturnType<typeof setInterval> | null = null;

function stopWatcher(): void {
  if (watcher) clearInterval(watcher);
  watcher = null;
}

/**
 * Locks every attempt whose time ran out with no solver open, including while
 * the app was closed, and queues all locked attempts for delivery.
 * Returns whether something new was locked.
 */
export async function recoverQuizAttempts(): Promise<boolean> {
  const userId = await getSessionUserId();
  if (!userId) {
    stopWatcher();
    return false;
  }
  const attempts = await listLocalAttempts(userId);
  let locked = false;
  for (const a of attempts) {
    const wasActive = a.phase === 'active';
    await lockIfExpired(a);
    if (a.phase === 'locked') {
      locked = locked || wasActive;
      await enqueueQuizSubmit(a.attemptId);
    }
  }
  if (attempts.some((a) => a.phase === 'active' && a.timeLimitSec != null)) armQuizExpiryWatcher();
  else stopWatcher();
  return locked;
}

/** Catches the deadline while the app is open on another screen. */
export function armQuizExpiryWatcher(): void {
  if (watcher) return;
  watcher = setInterval(() => {
    void recoverQuizAttempts()
      .then((locked) => {
        if (locked) requestFlush?.();
      })
      .catch(() => undefined);
  }, 5_000);
}
