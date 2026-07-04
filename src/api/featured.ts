/**
 * المختارات (curated Home picks) data access — V8 Feature B.
 *
 * Staff (admin OR publisher) hand-pick existing published lectures into an
 * ordered list that renders on Home as «مختارات». Reads go through the
 * is_content_manager-gated get_featured_lectures_admin RPC (drafts/unclassified
 * stay visible so staff can manage a since-unpublished pick); all writes are
 * DEFINER RPCs gated on the same is_content_manager() check — never a raw table
 * write. While `USE_MOCK` is true everything returns inert empty shapes.
 */
import { USE_MOCK } from '@/config';
import type { AppLectureStatus } from '@/config';
import { supabase } from '@/lib/supabase';
import type { AdminFeaturedRow } from './types';

export type { AdminFeaturedRow } from './types';

/** Admin/publisher list — every curated pick in its chosen order. */
export async function listAdminFeatured(): Promise<AdminFeaturedRow[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_featured_lectures_admin');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    lectureId: r.lecture_id,
    title: r.title,
    status: r.status as AppLectureStatus,
    sectionTitle: r.section_title ?? null,
    sheikhName: r.sheikh_name ?? null,
    durationSec: r.duration_sec ?? 0,
    order: r.order ?? 0,
  }));
}

/** Append a published lecture to the curated list (idempotent per lecture). */
export async function addFeaturedLecture(lectureId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('add_featured_lecture', { p_lecture_id: lectureId });
  if (error) throw error;
}

/** Remove a lecture from the curated list. */
export async function removeFeaturedLecture(lectureId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('remove_featured_lecture', { p_lecture_id: lectureId });
  if (error) throw error;
}

/** Persist a whole new order (the ▲/▼ buttons pass the reordered id list). */
export async function reorderFeaturedLectures(lectureIds: string[]): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('reorder_featured_lectures', { p_lecture_ids: lectureIds });
  if (error) throw error;
}
