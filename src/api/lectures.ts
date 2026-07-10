/**
 * Lecture data access for playback (player + downloads).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import { resolveAttachmentRows } from './attachments';
import { getReadUrl } from './storage';
import type { LectureCard, LecturePlayback, LectureRow } from './types';

export type { LectureCard, LecturePlayback, LectureRow } from './types';

async function audioUrl(path: string | null): Promise<string> {
  if (!path) return '';
  return (await getReadUrl(path)) ?? '';
}

/** Everything the player needs for one lecture (incl. resume position + audio URL). */
export async function getLecturePlayback(lectureId: string): Promise<LecturePlayback> {
  if (USE_MOCK) return mock.getLecturePlayback(lectureId);

  const { data: l, error } = await supabase
    .from('lectures')
    .select(`
      id, title, duration_sec, audio_path, section_id, order,
      sheikhs(name),
      sections(title),
      user_lecture_progress(position_sec)
    `)
    .eq('id', lectureId)
    .single();
  if (error || !l) throw error ?? new Error('lecture not found');

  const sheikh = Array.isArray(l.sheikhs) ? l.sheikhs[0] : (l.sheikhs as any);
  const sec = Array.isArray(l.sections) ? l.sections[0] : (l.sections as any);
  const prog = Array.isArray(l.user_lecture_progress)
    ? l.user_lecture_progress[0]
    : (l.user_lecture_progress as any);

  const { data: attRows = [] } = await supabase
    .from('attachments')
    .select('id, type, title, description, storage_path, external_url, body, order')
    .eq('lecture_id', lectureId)
    .order('order');

  return {
    id: l.id,
    title: l.title,
    sheikhName: sheikh?.name ?? null,
    eyebrow: sec?.title ?? '',
    sectionTitle: sec?.title ?? null,
    sectionId: l.section_id ?? null,
    order: l.order ?? 0,
    durationSec: l.duration_sec ?? 0,
    audioUrl: await audioUrl(l.audio_path),
    positionSec: prog?.position_sec ?? 0,
    attachments: await resolveAttachmentRows(attRows as any),
  };
}

/**
 * The next published lecture in the same section (the immediately-higher
 * `order`). Drives the player's "next" button + auto-advance. Returns null at
 * the end of a section, or for an unclassified lecture (no section). We sort by
 * order and pick the first row past `currentOrder` client-side — filtering on
 * the column literally named "order" collides with PostgREST's reserved `order`
 * query param, and a section's lecture list is small.
 */
export async function getNextLecture(
  sectionId: string | null,
  currentOrder: number,
): Promise<{ id: string } | null> {
  if (USE_MOCK) return mock.getNextLecture(sectionId, currentOrder);
  if (!sectionId) return null;
  const { data, error } = await supabase
    .from('lectures')
    .select('id, order')
    .eq('section_id', sectionId)
    .eq('status', 'published')
    .order('order', { ascending: true });
  if (error) throw error;
  const next = (data ?? []).find((l) => l.order > currentOrder);
  return next ? { id: next.id } : null;
}

/**
 * The previous published lecture in the same section (the immediately-lower
 * `order`). Mirror of {@link getNextLecture} — drives the player's "previous"
 * button. Returns null at the start of a section, or for an unclassified lecture
 * (no section). Sort by order descending and pick the first row below
 * `currentOrder` client-side (same reserved-`order` PostgREST caveat).
 */
export async function getPreviousLecture(
  sectionId: string | null,
  currentOrder: number,
): Promise<{ id: string } | null> {
  if (USE_MOCK) return mock.getPreviousLecture(sectionId, currentOrder);
  if (!sectionId) return null;
  const { data, error } = await supabase
    .from('lectures')
    .select('id, order')
    .eq('section_id', sectionId)
    .eq('status', 'published')
    .order('order', { ascending: false });
  if (error) throw error;
  const prev = (data ?? []).find((l) => l.order < currentOrder);
  return prev ? { id: prev.id } : null;
}

/**
 * Newly-added published lectures across the whole app, newest first — backs the
 * "أحدث الدروس" screen behind Home's «عرض الكل» next to أُضيف حديثاً. Classified
 * only (section_id not null), with the caller's own progress folded in.
 */
export async function getRecentLectures(limit = 8): Promise<LectureRow[]> {
  if (USE_MOCK) return mock.getRecentLectures(limit);
  const { data, error } = await supabase
    .from('lectures')
    .select(
      'id, title, duration_sec, audio_size_bytes, order, sheikhs(name), user_lecture_progress(position_sec, completed)',
    )
    .eq('status', 'published')
    .not('section_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((l) => {
    const sheikh = Array.isArray(l.sheikhs) ? l.sheikhs[0] : (l.sheikhs as any);
    const prog = Array.isArray(l.user_lecture_progress)
      ? l.user_lecture_progress[0]
      : (l.user_lecture_progress as any);
    const isDone = prog?.completed ?? false;
    const pos = prog?.position_sec ?? 0;
    return {
      id: l.id,
      title: l.title,
      durationSec: l.duration_sec ?? 0,
      sheikhName: sheikh?.name ?? null,
      status: isDone ? 'completed' : pos > 0 ? 'in_progress' : 'new',
      positionSec: pos,
      order: l.order ?? 0,
      fileSizeBytes: l.audio_size_bytes ?? null,
    };
  });
}

/**
 * The curated «المختارات» list — staff-picked published lectures, in their
 * chosen order — backs the full-list screen behind Home's «عرض الكل». The
 * caller's own progress is folded in server-side (get_featured_lectures) so
 * each row shows its status. The whole curated set is returned (no limit).
 */
export async function getFeaturedLectures(): Promise<LectureRow[]> {
  if (USE_MOCK) return mock.getFeaturedLectures();
  const { data, error } = await supabase.rpc('get_featured_lectures');
  if (error) throw error;
  return (data ?? []).map((l) => {
    const isDone = l.completed ?? false;
    const pos = l.position_sec ?? 0;
    return {
      id: l.lecture_id,
      title: l.title,
      durationSec: l.duration_sec ?? 0,
      sheikhName: l.sheikh_name ?? null,
      status: isDone ? 'completed' : pos > 0 ? 'in_progress' : 'new',
      positionSec: pos,
      order: l.order ?? 0,
      fileSizeBytes: l.audio_size_bytes ?? null,
    };
  });
}

/**
 * Notification-open gender guard (owner-simplified: 0072). The push/inbox
 * itself broadcasts to everyone again — this single-purpose check runs ONLY
 * when a lecture is opened FROM a notification (push shade or inbox tap), so
 * normal browsing takes on no extra round trip. True for an unclassified
 * lecture (nothing to scope) or when the caller's gender matches the
 * section's (and its ancestors') visibility; false otherwise.
 */
export async function isLectureVisibleToViewer(lectureId: string): Promise<boolean> {
  if (USE_MOCK) return true;
  const { data, error } = await supabase.rpc('lecture_visible_to_viewer', {
    p_lecture_id: lectureId,
  });
  if (error) return true; // fail-open: never block a legitimate open on a network hiccup
  return data ?? true;
}

/** Lecture cards for a set of ids — used by the downloads page. */
export async function getLecturesByIds(ids: string[]): Promise<LectureCard[]> {
  if (USE_MOCK) return mock.getLecturesByIds(ids);
  if (ids.length === 0) return [];

  const { data: raw, error } = await supabase
    .from('lectures')
    .select('id, title, duration_sec, sheikhs(name), sections(title)')
    .in('id', ids);
  if (error) throw error;
  const data = raw ?? [];

  return data.map((l) => {
    const sheikh = Array.isArray(l.sheikhs) ? l.sheikhs[0] : (l.sheikhs as any);
    const sec = Array.isArray(l.sections) ? l.sections[0] : (l.sections as any);
    return {
      id: l.id,
      title: l.title,
      sheikhName: sheikh?.name ?? null,
      durationSec: l.duration_sec ?? 0,
      coverLetter: sec?.title?.[0] ?? '◆',
      sectionTitle: sec?.title ?? null,
    };
  });
}
