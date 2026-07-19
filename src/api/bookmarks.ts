/**
 * «للمراجعة لاحقًا» bookmarks data access (V20 · §4).
 *
 * A student marks a minute inside a lesson to review later, with an optional short
 * note. Personal, cross-device, download-independent, and OFFLINE-CAPABLE — a mark
 * added with no connection is queued in the existing outbox (`enqueueBookmark`)
 * and replayed by the flush. All server work goes through the migration-0108 RPCs
 * (add_bookmark dedups within a few seconds); components never touch supabase.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import { enqueueBookmark } from '@/lib/outboxQueue';
import { isOnlineSync } from '@/lib/connectivity';

export type BookmarkStatus = 'pending' | 'reviewed';

export type Bookmark = {
  id: string;
  lectureId: string;
  lectureTitle: string;
  sectionId: string | null;
  sectionTitle: string | null;
  positionSec: number;
  note: string | null;
  status: BookmarkStatus;
  createdAt: string;
};

/**
 * Add a bookmark at `positionSec` (optional note). Offline → queued for replay and
 * resolves normally (the mark shows optimistically). The server dedups a same-
 * position mark within a few seconds, so a double-tap or a replay is harmless.
 */
export async function addBookmark(args: {
  lectureId: string;
  positionSec: number;
  note?: string | null;
}): Promise<void> {
  if (USE_MOCK) return;
  const positionSec = Math.max(0, Math.round(args.positionSec));
  const note = args.note?.trim() ? args.note.trim() : null;

  if (!isOnlineSync()) {
    await enqueueBookmark({ lectureId: args.lectureId, positionSec, note });
    return;
  }
  const { error } = await supabase.rpc('add_bookmark', {
    p_lecture_id: args.lectureId,
    p_position_sec: positionSec,
    p_note: note ?? undefined,
  });
  if (error) {
    // Thought we were online but the write failed — queue for replay, don't drop it.
    await enqueueBookmark({ lectureId: args.lectureId, positionSec, note });
  }
}

/** Replay one queued offline bookmark (called only by the outbox flush). */
export async function replayBookmark(e: {
  lectureId: string;
  positionSec: number;
  note: string | null;
}): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('add_bookmark', {
    p_lecture_id: e.lectureId,
    p_position_sec: Math.max(0, Math.round(e.positionSec)),
    p_note: e.note ?? undefined,
  });
  if (error) throw error;
}

/** All of my bookmarks with lesson + section context, newest first. */
export async function getBookmarks(): Promise<Bookmark[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_bookmarks');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    lectureId: r.lecture_id,
    lectureTitle: r.lecture_title ?? 'درسك',
    sectionId: r.section_id ?? null,
    sectionTitle: r.section_title ?? null,
    positionSec: r.position_sec ?? 0,
    note: r.note ?? null,
    status: (r.status as BookmarkStatus) ?? 'pending',
    createdAt: r.created_at,
  }));
}

/** Mark a bookmark reviewed (or return it to the review list). */
export async function setBookmarkReviewed(id: string, reviewed: boolean): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('set_bookmark_status', {
    p_id: id,
    p_reviewed: reviewed,
  });
  if (error) throw error;
}

/** Edit a bookmark's note (empty clears it). */
export async function updateBookmarkNote(id: string, note: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('update_bookmark_note', { p_id: id, p_note: note });
  if (error) throw error;
}

/** Delete a bookmark. */
export async function deleteBookmark(id: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.from('lecture_bookmarks').delete().eq('id', id);
  if (error) throw error;
}
