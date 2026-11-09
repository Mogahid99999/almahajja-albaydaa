/**
 * A quiz attempt kept on the device (0174), so it can be finished with no
 * connection. Three keys per attempt, so that typing never rewrites the
 * questions and the clock never rewrites the answers:
 *   :meta     the questions (no answer key ever reaches the app)
 *   :answers  the answers and whether the attempt is locked
 *   :clock    the time used
 *
 * Keys carry the account id. Sign-out does not touch them: nothing is removed
 * until the server has confirmed the attempt, and only its owner can send it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { QuizAttemptData, QuizQuestionView } from '@/api/types';
import { type ClockSample, type QuizClock, createClock } from '@/lib/quizClock';

const PREFIX = 'quiz-offline-v1:';

export type QuizFinishReason = 'timeout' | 'manual';

export type LocalQuizAttempt = {
  userId: string;
  attemptId: string;
  quizId: string;
  quizTitle: string;
  timeLimitSec: number | null;
  questions: QuizQuestionView[];
  phase: 'active' | 'locked';
  finishReason: QuizFinishReason | null;
  finishedAtWall: number | null;
  options: Record<string, string>;
  texts: Record<string, string>;
  clock: QuizClock;
};

type Meta = Pick<LocalQuizAttempt, 'userId' | 'attemptId' | 'quizId' | 'quizTitle' | 'timeLimitSec' | 'questions'>;
type Answers = Pick<LocalQuizAttempt, 'phase' | 'finishReason' | 'finishedAtWall' | 'options' | 'texts'>;

const base = (userId: string, attemptId: string) => `${PREFIX}${userId}:${attemptId}`;

// One object per attempt, so the solver and the background recovery share state.
const live = new Map<string, LocalQuizAttempt>();

async function writeAnswers(a: LocalQuizAttempt): Promise<boolean> {
  const doc: Answers = {
    phase: a.phase,
    finishReason: a.finishReason,
    finishedAtWall: a.finishedAtWall,
    options: a.options,
    texts: a.texts,
  };
  try {
    await AsyncStorage.setItem(`${base(a.userId, a.attemptId)}:answers`, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export async function persistClock(a: LocalQuizAttempt): Promise<void> {
  try {
    await AsyncStorage.setItem(`${base(a.userId, a.attemptId)}:clock`, JSON.stringify(a.clock));
  } catch {
    /* the in-memory clock still drives this session */
  }
}

export async function getLocalAttempt(
  userId: string,
  attemptId: string,
): Promise<LocalQuizAttempt | null> {
  const key = base(userId, attemptId);
  const cached = live.get(key);
  if (cached) return cached;
  try {
    const [m, an, c] = await Promise.all([
      AsyncStorage.getItem(`${key}:meta`),
      AsyncStorage.getItem(`${key}:answers`),
      AsyncStorage.getItem(`${key}:clock`),
    ]);
    if (!m || !an || !c) return null;
    const racing = live.get(key);
    if (racing) return racing;
    const attempt: LocalQuizAttempt = {
      ...(JSON.parse(m) as Meta),
      ...(JSON.parse(an) as Answers),
      clock: JSON.parse(c) as QuizClock,
    };
    live.set(key, attempt);
    return attempt;
  } catch {
    return null;
  }
}

/** Store a freshly downloaded attempt, seeded with what the server already holds. */
export async function createLocalAttempt(
  userId: string,
  data: QuizAttemptData,
  sample: ClockSample,
): Promise<LocalQuizAttempt> {
  const options: Record<string, string> = {};
  const texts: Record<string, string> = {};
  for (const q of data.questions) {
    if (q.selectedOptionId) options[q.id] = q.selectedOptionId;
    if (q.kind === 'text' && q.textAnswer) texts[q.id] = q.textAnswer;
  }
  const attempt: LocalQuizAttempt = {
    userId,
    attemptId: data.attemptId,
    quizId: data.quizId,
    quizTitle: data.quizTitle,
    timeLimitSec: data.timeLimitSec,
    questions: data.questions,
    phase: 'active',
    finishReason: null,
    finishedAtWall: null,
    options,
    texts,
    clock: createClock(data.timeLimitSec, data.remainingSec, sample),
  };
  const key = base(userId, data.attemptId);
  live.set(key, attempt);
  const meta: Meta = {
    userId,
    attemptId: data.attemptId,
    quizId: data.quizId,
    quizTitle: data.quizTitle,
    timeLimitSec: data.timeLimitSec,
    questions: data.questions,
  };
  try {
    await AsyncStorage.setItem(`${key}:meta`, JSON.stringify(meta));
  } catch {
    /* this session can still finish from memory */
  }
  await writeAnswers(attempt);
  await persistClock(attempt);
  return attempt;
}

/** Record a choice and write it to disk at once. A locked attempt refuses it. */
export async function setLocalOption(
  a: LocalQuizAttempt,
  questionId: string,
  optionId: string,
): Promise<boolean> {
  if (a.phase !== 'active') return false;
  a.options = { ...a.options, [questionId]: optionId };
  return writeAnswers(a);
}

/** Record a written draft in memory; persistAnswers puts it on disk. */
export function setLocalText(a: LocalQuizAttempt, questionId: string, text: string): boolean {
  if (a.phase !== 'active') return false;
  a.texts = { ...a.texts, [questionId]: text };
  return true;
}

export function persistAnswers(a: LocalQuizAttempt): Promise<boolean> {
  return writeAnswers(a);
}

/** The answers held right now become final. Locking twice keeps the first reason. */
export async function lockLocalAttempt(
  a: LocalQuizAttempt,
  reason: QuizFinishReason,
  wall: number,
): Promise<void> {
  if (a.phase === 'locked') return;
  a.phase = 'locked';
  a.finishReason = reason;
  a.finishedAtWall = wall;
  await writeAnswers(a);
  await persistClock(a);
}

/** Only after the server has confirmed the attempt, or no longer has it. */
export async function removeLocalAttempt(a: LocalQuizAttempt): Promise<void> {
  const key = base(a.userId, a.attemptId);
  live.delete(key);
  await AsyncStorage.multiRemove([`${key}:meta`, `${key}:answers`, `${key}:clock`]);
}

export async function listLocalAttempts(userId: string): Promise<LocalQuizAttempt[]> {
  const prefix = `${PREFIX}${userId}:`;
  const keys = await AsyncStorage.getAllKeys();
  const ids = keys
    .filter((k) => k.startsWith(prefix) && k.endsWith(':meta'))
    .map((k) => k.slice(prefix.length, -':meta'.length));
  const found = await Promise.all(ids.map((id) => getLocalAttempt(userId, id)));
  return found.filter((a): a is LocalQuizAttempt => a !== null);
}

/** Every answer as the server expects it; an emptied written answer clears it there. */
export function answersForServer(
  a: LocalQuizAttempt,
): { questionId: string; optionId?: string; text?: string }[] {
  return a.questions.flatMap((q): { questionId: string; optionId?: string; text?: string }[] => {
    if (q.kind === 'text') return [{ questionId: q.id, text: a.texts[q.id] ?? '' }];
    const optionId = a.options[q.id];
    return optionId ? [{ questionId: q.id, optionId }] : [];
  });
}
