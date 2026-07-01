/**
 * Lecture data access for playback (player + downloads).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import { resolveAttachmentRows } from './attachments';
import type { LectureCard, LecturePlayback } from './types';

export type { LectureCard, LecturePlayback } from './types';

async function audioUrl(path: string | null): Promise<string> {
  if (!path) return '';
  const { data, error } = await supabase.storage
    .from('lectures')
    .createSignedUrl(path, 3600);
  if (error || !data) return '';
  return data.signedUrl;
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
    };
  });
}
