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
import {
  EMPTY_COMMENTS_STATE,
  MAX_LIVE_COMMENTS,
  applyCommentsMessage,
  applyStateMessage,
  capComments,
  countUnseen,
} from '@/lib/liveCommentsCache';

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

// 0182 (owner 2026-11-19)
test('edit replaces the text in place, keeps mine and the time, marks «معدّل»; an unknown id is ignored', () => {
  const list = [c('a', T1, { mine: true }), c('b', T2)];
  const next = applyCommentsMessage(list, { t: 'edit', c: c('a', T1, { text: 'نص جديد', edited: true }) });
  expect(next[0]).toMatchObject({ id: 'a', text: 'نص جديد', edited: true, mine: true, at: T1 });
  expect(next[1]).toBe(list[1]);
  expect(applyCommentsMessage(list, { t: 'edit', c: c('zz', T3, { edited: true }) })).toBe(list);
});

test('closed is not a list change', () => {
  const list = [c('a', T1)];
  expect(applyCommentsMessage(list, { t: 'closed', closed: true })).toBe(list);
});

describe('0183: the room state — closed + the pinned comment', () => {
  const p = c('p1', T1, { text: 'رابط الكتاب' });

  test('pin / clear; closed keeps the pin', () => {
    const pinned = applyStateMessage(undefined, { t: 'pin', c: p });
    expect(pinned).toEqual({ closed: false, pinned: p });
    const closed = applyStateMessage(pinned, { t: 'closed', closed: true });
    expect(closed).toEqual({ closed: true, pinned: p });
    expect(applyStateMessage(closed, { t: 'pin', c: null })).toEqual({ closed: true, pinned: null });
  });

  test('deleting the pinned comment unpins it; another delete changes nothing (same object)', () => {
    const s = { closed: false, pinned: p };
    expect(applyStateMessage(s, { t: 'del', id: 'p1' })).toEqual({ closed: false, pinned: null });
    expect(applyStateMessage(s, { t: 'del', id: 'other' })).toBe(s);
  });

  test('editing the pinned comment updates its text («معدّل»); others leave it', () => {
    const s = { closed: false, pinned: p };
    expect(applyStateMessage(s, { t: 'edit', c: { ...p, text: 'الرابط الجديد', edited: true } }).pinned).toEqual({
      ...p,
      text: 'الرابط الجديد',
      edited: true,
    });
    expect(applyStateMessage(s, { t: 'edit', c: c('x', T2, { edited: true }) })).toBe(s);
  });

  test('no-ops return the same state; list messages never touch it', () => {
    expect(applyStateMessage(EMPTY_COMMENTS_STATE, { t: 'pin', c: null })).toBe(EMPTY_COMMENTS_STATE);
    expect(applyStateMessage(EMPTY_COMMENTS_STATE, { t: 'closed', closed: false })).toBe(EMPTY_COMMENTS_STATE);
    expect(applyStateMessage(EMPTY_COMMENTS_STATE, { t: 'add', c: p })).toBe(EMPTY_COMMENTS_STATE);
  });

  test('the list ignores pin messages', () => {
    const list = [p];
    expect(applyCommentsMessage(list, { t: 'pin', c: p })).toBe(list);
  });
});
