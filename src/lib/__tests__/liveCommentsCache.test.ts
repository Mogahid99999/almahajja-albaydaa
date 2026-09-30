/**
 * src/lib/liveCommentsCache.ts — the room's comments list reducer
 * («التعليقات والأسئلة أثناء البث», 0147).
 *
 * Invariants: the list stays oldest-first; the author's own comment, received
 * twice (POST response with `mine`, then the room broadcast without it), is ONE
 * row that stays «mine»; delete / «تمت الإجابة» apply by id and are no-ops for
 * unknown ids (same array — no re-render); the list never exceeds 500 (the
 * newest kept); the staff badge counts neither my own nor already-seen ones.
 */
import type { LiveComment } from '@/api/liveComments';
import { MAX_LIVE_COMMENTS, applyCommentsMessage, capComments, countUnseen } from '@/lib/liveCommentsCache';

function c(id: string, at: string, over: Partial<LiveComment> = {}): LiveComment {
  return { id, kind: 'comment', text: 'جزاكم الله خيراً', name: 'أحمد', gender: 'm', answered: false, at, ...over };
}

const T1 = '2026-09-30T18:00:01.000Z';
const T2 = '2026-09-30T18:00:02.000Z';
const T3 = '2026-09-30T18:00:03.000Z';

test('add appends a new comment at the end (oldest first)', () => {
  const list = [c('a', T1)];
  const next = applyCommentsMessage(list, { t: 'add', c: c('b', T2) });
  expect(next.map((x) => x.id)).toEqual(['a', 'b']);
  expect(list.map((x) => x.id)).toEqual(['a']); // never mutated
});

test('an add that arrives late is placed in time order', () => {
  const list = [c('a', T1), c('c', T3)];
  const next = applyCommentsMessage(list, { t: 'add', c: c('b', T2) });
  expect(next.map((x) => x.id)).toEqual(['a', 'b', 'c']);
});

test('dedupe: my POST (mine) then the room broadcast → one row, still mine', () => {
  const mine = c('m', T2, { mine: true });
  const afterPost = applyCommentsMessage([c('a', T1)], { t: 'add', c: mine });
  const afterBroadcast = applyCommentsMessage(afterPost, { t: 'add', c: c('m', T2) });
  expect(afterBroadcast).toHaveLength(2);
  expect(afterBroadcast[1]).toMatchObject({ id: 'm', mine: true });
});

test('dedupe: the broadcast first, then my POST response → one row, mine', () => {
  const afterBroadcast = applyCommentsMessage([], { t: 'add', c: c('m', T2) });
  const afterPost = applyCommentsMessage(afterBroadcast, { t: 'add', c: c('m', T2, { mine: true }) });
  expect(afterPost).toHaveLength(1);
  expect(afterPost[0].mine).toBe(true);
});

test('del removes by id; an unknown id returns the same array', () => {
  const list = [c('a', T1), c('b', T2)];
  expect(applyCommentsMessage(list, { t: 'del', id: 'a' }).map((x) => x.id)).toEqual(['b']);
  expect(applyCommentsMessage(list, { t: 'del', id: 'zzz' })).toBe(list);
});

test('ans marks / unmarks «تمت الإجابة»; unknown or unchanged → same array', () => {
  const list = [c('q', T1, { kind: 'question' })];
  const on = applyCommentsMessage(list, { t: 'ans', id: 'q', answered: true });
  expect(on[0].answered).toBe(true);
  expect(applyCommentsMessage(on, { t: 'ans', id: 'q', answered: false })[0].answered).toBe(false);
  expect(applyCommentsMessage(on, { t: 'ans', id: 'q', answered: true })).toBe(on);
  expect(applyCommentsMessage(list, { t: 'ans', id: 'nope', answered: true })).toBe(list);
});

test('the list is capped at 500 — the newest kept', () => {
  const base = Array.from({ length: MAX_LIVE_COMMENTS }, (_, i) =>
    c(`id${i}`, new Date(Date.UTC(2026, 8, 30, 18, 0, 0, i)).toISOString()),
  );
  const next = applyCommentsMessage(base, { t: 'add', c: c('newest', '2026-09-30T19:00:00.000Z') });
  expect(next).toHaveLength(MAX_LIVE_COMMENTS);
  expect(next[0].id).toBe('id1');
  expect(next[next.length - 1].id).toBe('newest');
  expect(capComments(base)).toBe(base);
});

test('the staff badge counts unseen comments that are not mine', () => {
  const list = [c('a', T1), c('b', T2, { mine: true }), c('c', T3)];
  expect(countUnseen(list, new Set())).toBe(2);
  expect(countUnseen(list, new Set(['a']))).toBe(1);
  expect(countUnseen(list, new Set(['a', 'c']))).toBe(0);
});
