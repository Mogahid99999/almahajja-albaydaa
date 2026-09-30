/**
 * «التعليقات والأسئلة أثناء البث» — the room's comments (V23, migration 0147),
 * TanStack hooks over src/api/liveComments.ts.
 *
 * Source of truth = the TanStack cache (queryKeys.liveComments — root 'live',
 * never persisted). It is filled by get_live_comments and then kept current by
 * the room's LiveKit data messages (topic "comments"), which liveStore forwards
 * (onLiveComments) — no polling. The read runs whenever the room (re)becomes
 * usable: `enabled` goes false while reconnecting / offline and back to true
 * afterwards, which refetches (staleTime 0) — updates missed while away are
 * picked up. Updates arriving WHILE a read is in flight are replayed on its
 * result, so a comment broadcast mid-read is never lost.
 *
 * The staff badge («n» new since the list was last opened) keeps the ids already
 * seen per session in a tiny module store — it survives minimising the room.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

import {
  blockLiveCommentAuthor,
  deleteLiveComment,
  getLiveComments,
  postLiveComment,
  setLiveCommentAnswered,
  type LiveComment,
  type LiveCommentKind,
  type LiveCommentsMessage,
} from '@/api/liveComments';
import { queryKeys } from '@/constants/queryKeys';
import { applyCommentsMessage, capComments, countUnseen } from '@/lib/liveCommentsCache';
import { onLiveComments } from '@/stores/liveStore';

const EMPTY: readonly LiveComment[] = [];
const NONE: ReadonlySet<string> = new Set();

/** Updates received while a read of that session is in flight (replayed on its result). */
const inflight = new Map<string, Set<LiveCommentsMessage[]>>();

async function fetchComments(sessionId: string): Promise<LiveComment[]> {
  const buffer: LiveCommentsMessage[] = [];
  let set = inflight.get(sessionId);
  if (!set) inflight.set(sessionId, (set = new Set()));
  set.add(buffer);
  try {
    const list = await getLiveComments(sessionId);
    return buffer.reduce(applyCommentsMessage, capComments(list));
  } finally {
    set.delete(buffer);
    if (!set.size) inflight.delete(sessionId);
  }
}

/** One update → the room's cached list (and any read in flight). */
export function applyLiveCommentsMessage(qc: QueryClient, sessionId: string, msg: LiveCommentsMessage): void {
  inflight.get(sessionId)?.forEach((b) => b.push(msg));
  qc.setQueryData<LiveComment[]>(queryKeys.liveComments(sessionId), (old) =>
    old ? applyCommentsMessage(old, msg) : old,
  );
}

// ─── «seen» ids for the staff badge ────────────────────────────────────────────

type SeenState = {
  sessionId: string | null;
  ids: ReadonlySet<string>;
  mark: (sessionId: string, ids: readonly string[]) => void;
};

const useSeen = create<SeenState>((set, get) => ({
  sessionId: null,
  ids: NONE,
  mark: (sessionId, ids) => {
    const cur = get();
    const base = cur.sessionId === sessionId ? cur.ids : NONE;
    let next: Set<string> | null = null;
    for (const id of ids) {
      if (!base.has(id)) (next ??= new Set(base)).add(id);
    }
    if (next) set({ sessionId, ids: next });
    else if (cur.sessionId !== sessionId) set({ sessionId, ids: NONE });
  },
}));

/**
 * The room's list (oldest first) + the unseen count.
 * `enabled`: I'm in this room and it is connected. `open`: the sheet is showing
 * (everything in it counts as seen).
 */
export function useLiveComments(
  sessionId: string | null | undefined,
  opts: { enabled: boolean; open: boolean },
) {
  const qc = useQueryClient();
  const id = sessionId ?? '';

  useEffect(() => {
    if (!sessionId) return undefined;
    return onLiveComments((sid, msg) => {
      if (sid === sessionId) applyLiveCommentsMessage(qc, sid, msg);
    });
  }, [qc, sessionId]);

  const query = useQuery({
    queryKey: queryKeys.liveComments(id),
    queryFn: () => fetchComments(id),
    enabled: opts.enabled && !!sessionId,
    staleTime: 0,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const comments = query.data ?? EMPTY;

  const seenSession = useSeen((s) => s.sessionId);
  const seenIds = useSeen((s) => s.ids);
  const mark = useSeen((s) => s.mark);
  useEffect(() => {
    if (opts.open && sessionId && comments.length) mark(sessionId, comments.map((c) => c.id));
  }, [opts.open, sessionId, comments, mark]);

  const unseen = useMemo(
    () => (opts.open ? 0 : countUnseen(comments, seenSession === sessionId ? seenIds : NONE)),
    [opts.open, comments, seenSession, sessionId, seenIds],
  );

  return {
    comments,
    isLoading: query.isLoading,
    isError: query.isError && !query.data,
    refetch: query.refetch,
    unseen,
  };
}

/** Post a comment / question. The stored comment (mine) lands in the list at once. */
export function usePostLiveComment(sessionId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: LiveCommentKind; text: string; anonymous: boolean }) =>
      postLiveComment({ sessionId: sessionId as string, ...v }),
    networkMode: 'always',
    onSuccess: (c) => {
      if (sessionId) applyLiveCommentsMessage(qc, sessionId, { t: 'add', c });
    },
  });
}

export type LiveCommentAction =
  | { type: 'delete'; id: string }
  | { type: 'answered'; id: string; answered: boolean }
  | { type: 'block'; id: string };

/**
 * Delete (the author, or the room's moderators / content managers),
 * «تمت الإجابة», «منع من التعليق». Applied to the list on success (the room
 * broadcast repeats it — harmless).
 */
export function useLiveCommentAction(sessionId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: LiveCommentAction) => {
      const sid = sessionId as string;
      if (a.type === 'delete') await deleteLiveComment(sid, a.id);
      else if (a.type === 'answered') await setLiveCommentAnswered(sid, a.id, a.answered);
      else await blockLiveCommentAuthor(sid, a.id);
    },
    networkMode: 'always',
    onSuccess: (_d, a) => {
      if (!sessionId) return;
      applyLiveCommentsMessage(
        qc,
        sessionId,
        a.type === 'answered' ? { t: 'ans', id: a.id, answered: a.answered } : { t: 'del', id: a.id },
      );
    },
  });
}
