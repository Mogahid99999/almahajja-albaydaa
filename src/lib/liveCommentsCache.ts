/**
 * «التعليقات والأسئلة أثناء البث» — the PURE list logic behind the room's
 * comments cache (src/hooks/useLiveComments.ts). No React, no TanStack: the
 * hook feeds every server read and every LiveKit data message (topic
 * "comments", src/api/liveComments.ts parseCommentsMessage) through
 * {@link applyCommentsMessage}.
 *
 * The list is kept OLDEST FIRST (as get_live_comments returns it) and never
 * longer than {@link MAX_LIVE_COMMENTS} (the newest are kept — the server's own
 * read window).
 */
import type { LiveComment, LiveCommentsMessage } from '@/api/liveComments';

/** Same window as get_live_comments (the 500 newest). */
export const MAX_LIVE_COMMENTS = 500;

/** The newest {@link MAX_LIVE_COMMENTS}; the same array when already short enough. */
export function capComments(list: readonly LiveComment[]): LiveComment[] {
  const arr = list as LiveComment[];
  return arr.length > MAX_LIVE_COMMENTS ? arr.slice(arr.length - MAX_LIVE_COMMENTS) : arr;
}

const time = (c: LiveComment) => {
  const t = Date.parse(c.at);
  return Number.isFinite(t) ? t : 0;
};

/**
 * One update → the next list. Returns the SAME array when nothing changed (a
 * repeated delete, an unknown id), so the room doesn't re-render for nothing.
 *  - add: dedupe by id — the author receives his own comment twice (the POST
 *    response with `mine: true`, and the room broadcast without it): the copies
 *    merge and `mine` is kept. A new one lands in time order (normally last).
 *  - del: removed.
 *  - ans: «تمت الإجابة» on / off.
 */
export function applyCommentsMessage(list: readonly LiveComment[], msg: LiveCommentsMessage): LiveComment[] {
  const arr = list as LiveComment[];
  switch (msg.t) {
    case 'add': {
      const c = msg.c;
      const i = arr.findIndex((x) => x.id === c.id);
      if (i >= 0) {
        const old = arr[i];
        const merged: LiveComment = { ...old, ...c };
        if (old.mine || c.mine) merged.mine = true;
        const next = arr.slice();
        next[i] = merged;
        return next;
      }
      const t = time(c);
      let at = arr.length;
      while (at > 0 && time(arr[at - 1]) > t) at--;
      const next = arr.slice();
      next.splice(at, 0, c);
      return capComments(next);
    }
    case 'del': {
      if (!arr.some((x) => x.id === msg.id)) return arr;
      return arr.filter((x) => x.id !== msg.id);
    }
    case 'ans': {
      const i = arr.findIndex((x) => x.id === msg.id);
      if (i < 0 || arr[i].answered === msg.answered) return arr;
      const next = arr.slice();
      next[i] = { ...arr[i], answered: msg.answered };
      return next;
    }
    default:
      return arr;
  }
}

/**
 * The staff badge: comments nobody opened the list for yet — neither my own,
 * nor any id already seen. A deleted comment simply leaves the list (and the count).
 */
export function countUnseen(list: readonly LiveComment[], seen: ReadonlySet<string>): number {
  let n = 0;
  for (const c of list) if (!c.mine && !seen.has(c.id)) n++;
  return n;
}
