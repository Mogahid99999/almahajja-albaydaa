/**
 * The state of the quiz solver (0174). The device copy is the source of truth
 * during an attempt: every answer lands there first, the server is told only
 * when reachable, and nothing here waits for a connection.
 */
import { onlineManager } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import {
  getAttemptQuestions,
  getSessionUserId,
  saveAnswer,
  saveTextAnswer,
} from '@/api/quizzes';
import type { QuizQuestionView } from '@/api/types';
import { isOnline } from '@/lib/connectivity';
import { flushOutbox } from '@/lib/outbox';
import { enqueueQuizSubmit } from '@/lib/outboxQueue';
import {
  type LocalQuizAttempt,
  type QuizFinishReason,
  createLocalAttempt,
  getLocalAttempt,
  lockLocalAttempt,
  persistAnswers,
  persistClock,
  removeLocalAttempt,
  setLocalOption,
  setLocalText,
} from '@/lib/quizAttemptStore';
import { advanceClock, clockSample, reanchorClock, remainingSeconds } from '@/lib/quizClock';
import { armQuizExpiryWatcher, attachQuizScreen, onQuizSynced } from '@/lib/quizSync';

/** Disk write while typing: short, so a crash loses almost nothing. */
const TEXT_DISK_DEBOUNCE_MS = 300;
/** Best-effort server copy while typing. */
const TEXT_SERVER_DEBOUNCE_MS = 900;
const CLOCK_PERSIST_EVERY_TICKS = 5;

export type QuizSessionStatus = 'loading' | 'error' | 'active' | 'locked' | 'submitted';

export const LOCAL_SAVE_WARNING = 'تعذّر حفظ الإجابة على الجهاز — تأكد من توفر مساحة كافية.';

const subscribeOnline = (notify: () => void) => onlineManager.subscribe(notify);
const readOnline = () => onlineManager.isOnline();

export function useQuizSession(attemptId: string) {
  const [status, setStatus] = useState<QuizSessionStatus>('loading');
  const [questions, setQuestions] = useState<QuizQuestionView[]>([]);
  const [options, setOptions] = useState<Record<string, string>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [finishReason, setFinishReason] = useState<QuizFinishReason | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const online = useSyncExternalStore(subscribeOnline, readOnline, readOnline);

  const attemptRef = useRef<LocalQuizAttempt | null>(null);
  const finishingRef = useRef(false);
  const ticksRef = useRef(0);
  const diskTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearTimers = useCallback(() => {
    if (diskTimerRef.current) clearTimeout(diskTimerRef.current);
    diskTimerRef.current = null;
    for (const t of Object.values(serverTimersRef.current)) clearTimeout(t);
    serverTimersRef.current = {};
  }, []);

  const deliver = useCallback(async () => {
    setSyncFailed(false);
    const attempt = attemptRef.current;
    if (!attempt) return;
    await flushOutbox();
    // A flush already running works from an older snapshot of the queue.
    if (await getLocalAttempt(attempt.userId, attempt.attemptId)) await flushOutbox();
    if ((await getLocalAttempt(attempt.userId, attempt.attemptId)) && (await isOnline())) {
      setSyncFailed(true);
    }
  }, []);

  const finish = useCallback(
    async (reason: QuizFinishReason) => {
      const attempt = attemptRef.current;
      if (!attempt || finishingRef.current || attempt.phase !== 'active') return;
      finishingRef.current = true;
      clearTimers();
      // setLocalText has already put the last typed words on the attempt.
      await lockLocalAttempt(attempt, reason, Date.now());
      await enqueueQuizSubmit(attempt.attemptId);
      setFinishReason(reason);
      setRemaining(remainingSeconds(attempt.clock));
      setStatus('locked');
      await deliver();
    },
    [clearTimers, deliver],
  );

  const tick = useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt || attempt.phase !== 'active' || attempt.timeLimitSec == null) return;
    attempt.clock = advanceClock(attempt.clock, clockSample());
    const left = remainingSeconds(attempt.clock);
    setRemaining(left);
    ticksRef.current += 1;
    if (ticksRef.current % CLOCK_PERSIST_EVERY_TICKS === 0) void persistClock(attempt);
    if (left === 0) void finish('timeout');
  }, [finish]);

  /** While reachable, the server says whether the attempt ended and how long is left. */
  const reconcile = useCallback(async () => {
    const attempt = attemptRef.current;
    if (!attempt || !(await isOnline())) return;
    try {
      const data = await getAttemptQuestions(attempt.attemptId);
      if (data.submittedAt) {
        await removeLocalAttempt(attempt);
        setStatus('submitted');
        return;
      }
      if (attempt.phase === 'active' && data.remainingSec != null) {
        attempt.clock = reanchorClock(attempt.clock, data.remainingSec, clockSample());
        await persistClock(attempt);
        setRemaining(remainingSeconds(attempt.clock));
      }
    } catch {
      /* the local copy carries on */
    }
  }, []);

  useEffect(() => {
    if (!attemptId) return undefined;
    let cancelled = false;
    let detach: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const unsubscribeSynced = onQuizSynced((id) => {
      if (id === attemptId) setStatus('submitted');
    });

    void (async () => {
      try {
        const userId = await getSessionUserId();
        if (!userId) throw new Error('no session');
        let attempt = await getLocalAttempt(userId, attemptId);
        const existed = attempt !== null;
        if (!attempt) {
          const data = await getAttemptQuestions(attemptId);
          if (cancelled) return;
          if (data.submittedAt) {
            setStatus('submitted');
            return;
          }
          attempt = await createLocalAttempt(userId, data, clockSample());
        }
        if (cancelled) return;
        attemptRef.current = attempt;
        setQuestions(attempt.questions);
        setOptions(attempt.options);
        setTexts(attempt.texts);
        if (attempt.phase === 'locked') {
          setFinishReason(attempt.finishReason);
          setRemaining(remainingSeconds(attempt.clock));
          setStatus('locked');
          void enqueueQuizSubmit(attempt.attemptId).then(deliver);
          return;
        }
        detach = attachQuizScreen(attemptId);
        armQuizExpiryWatcher();
        setStatus('active');
        tick();
        timer = setInterval(tick, 1000);
        if (existed) void reconcile();
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    const appState = AppState.addEventListener('change', (next) => {
      const attempt = attemptRef.current;
      if (!attempt) return;
      if (next === 'active') {
        tick();
        void reconcile();
      } else if (attempt.phase === 'active') {
        void persistAnswers(attempt);
        void persistClock(attempt);
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      appState.remove();
      unsubscribeSynced();
      detach?.();
      clearTimers();
      const attempt = attemptRef.current;
      if (attempt?.phase === 'active') {
        void persistAnswers(attempt);
        void persistClock(attempt);
      }
    };
  }, [attemptId, clearTimers, deliver, reconcile, tick]);

  const pickOption = useCallback((questionId: string, optionId: string) => {
    const attempt = attemptRef.current;
    if (!attempt || attempt.phase !== 'active') return;
    const write = setLocalOption(attempt, questionId, optionId);
    setOptions(attempt.options);
    void write.then((ok) => setSaveWarning(ok ? null : LOCAL_SAVE_WARNING));
    if (onlineManager.isOnline()) {
      void saveAnswer(attempt.attemptId, questionId, optionId).catch(() => undefined);
    }
  }, []);

  const changeText = useCallback((questionId: string, text: string) => {
    const attempt = attemptRef.current;
    if (!attempt || !setLocalText(attempt, questionId, text)) return;
    setTexts(attempt.texts);
    if (diskTimerRef.current) clearTimeout(diskTimerRef.current);
    diskTimerRef.current = setTimeout(() => {
      void persistAnswers(attempt).then((ok) => setSaveWarning(ok ? null : LOCAL_SAVE_WARNING));
    }, TEXT_DISK_DEBOUNCE_MS);
    const pending = serverTimersRef.current[questionId];
    if (pending) clearTimeout(pending);
    serverTimersRef.current[questionId] = setTimeout(() => {
      delete serverTimersRef.current[questionId];
      if (attempt.phase === 'active' && onlineManager.isOnline()) {
        void saveTextAnswer(attempt.attemptId, questionId, text.trim()).catch(() => undefined);
      }
    }, TEXT_SERVER_DEBOUNCE_MS);
  }, []);

  const flushDrafts = useCallback(() => {
    const attempt = attemptRef.current;
    if (attempt?.phase === 'active') void persistAnswers(attempt);
  }, []);

  return {
    status,
    questions,
    options,
    texts,
    remaining,
    finishReason,
    saveWarning,
    syncFailed,
    online,
    pickOption,
    changeText,
    flushDrafts,
    submit: useCallback(() => finish('manual'), [finish]),
    retrySync: deliver,
  };
}
