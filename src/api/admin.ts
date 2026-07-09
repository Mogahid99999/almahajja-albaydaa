/**
 * Admin data access — lecture upload, the section tree, and the unclassified
 * review queue (PRD §14, §15). The Telegram bot (deferred) will feed the same
 * unclassified queue, so nothing here changes when it lands.
 *
 * "Unclassified" maps to lectures with section_id IS NULL at the DB level.
 * The DB status enum only has 'draft' | 'published'; `unclassified` is an
 * app-layer concept (section_id null + status draft).
 */

import { USE_MOCK } from '@/config';
import type { AppLectureStatus } from '@/config';
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import { deleteFromR2, uploadToR2 } from './storage';
import type { AdminLectureRow, SectionEditData, SectionVisibility, UnclassifiedItem } from './types';

export type { AdminLectureRow, SectionEditData, UnclassifiedItem } from './types';

/** A picked audio file (from expo-document-picker) ready to upload. */
export type PickedAudio = {
  uri: string;
  name: string;
  mimeType?: string | null;
};

/**
 * Upload a picked audio file to R2 and return its object key (what
 * `lectures.audio_path` stores). The player mints a signed URL from this key
 * at playback time (src/api/lectures.ts → audioUrl). The object lands at
 * `lectures/<section title>/<lecture title>.<ext>` (or `lectures/_unclassified/`
 * when uploaded before classification) — the admin's own names, not a
 * timestamp+slug — so the R2 bucket mirrors the app's section/lesson structure.
 */
async function uploadLectureAudio(
  file: PickedAudio,
  sectionId: string | null,
  title: string,
): Promise<string> {
  let folder: string | null = null;
  if (sectionId) {
    const { data } = await supabase.from('sections').select('title').eq('id', sectionId).single();
    folder = data?.title ?? null;
  }
  return uploadToR2('lecture', file, { folder, displayName: title });
}

/** Lectures awaiting classification (manual upload or, later, the bot). */
export async function getUnclassifiedLectures(): Promise<UnclassifiedItem[]> {
  if (USE_MOCK) return mock.getUnclassifiedLectures();
  const { data: raw, error } = await supabase
    .from('lectures')
    .select('id, title, duration_sec, created_at, sheikhs(name)')
    .is('section_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const data = raw ?? [];
  return data.map((l) => {
    const sheikh = Array.isArray(l.sheikhs) ? l.sheikhs[0] : (l.sheikhs as any);
    return {
      id: l.id,
      title: l.title,
      sheikhName: sheikh?.name ?? null,
      durationSec: l.duration_sec ?? 0,
      createdAt: l.created_at,
    };
  });
}

/** All lectures (any status) for the admin lectures table. */
export async function getAdminLectures(): Promise<AdminLectureRow[]> {
  if (USE_MOCK) return mock.getAdminLectures();
  const { data: raw, error } = await supabase
    .from('lectures')
    .select('id, title, status, duration_sec, order, section_id, sheikh_id, sections(title), sheikhs(name)')
    .order('created_at', { ascending: false })
    // Guard only — the library is small today (client-side filtered below).
    // pagination TODO: switch to server paging once the count nears this cap.
    .limit(1000);
  if (error) throw error;
  const data = raw ?? [];
  return data.map((l) => {
    const sec = Array.isArray(l.sections) ? l.sections[0] : (l.sections as any);
    const sheikh = Array.isArray(l.sheikhs) ? l.sheikhs[0] : (l.sheikhs as any);
    const dbStatus = l.status as 'draft' | 'published';
    const appStatus: AppLectureStatus =
      l.section_id === null ? 'unclassified' : dbStatus;
    return {
      id: l.id,
      title: l.title,
      sectionTitle: sec?.title ?? null,
      sectionId: l.section_id ?? null,
      sheikhId: l.sheikh_id ?? null,
      sheikhName: sheikh?.name ?? null,
      status: appStatus,
      durationSec: l.duration_sec ?? 0,
      order: l.order,
    };
  });
}

/** Create a lecture (direct upload). Defaults to draft until published. */
export async function createLecture(input: {
  title: string;
  sectionId: string | null;
  sheikhId: string | null;
  order: number;
  durationSec?: number | null;
  status: AppLectureStatus;
  /** Audio file picked in the upload form; uploaded to the `lectures` bucket. */
  audioFile?: PickedAudio | null;
}): Promise<{ id: string }> {
  if (USE_MOCK) return mock.createLecture(input);
  const dbStatus = input.status === 'unclassified' ? 'draft' : input.status;
  const audioPath = input.audioFile
    ? await uploadLectureAudio(input.audioFile, input.sectionId, input.title)
    : null;
  const { data, error } = await supabase
    .from('lectures')
    .insert({
      title: input.title,
      section_id: input.sectionId,
      sheikh_id: input.sheikhId,
      order: input.order,
      duration_sec: input.durationSec ?? null,
      status: dbStatus,
      audio_path: audioPath,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('create lecture failed');
  return { id: data.id };
}

/**
 * The order number a NEW lecture should take in a section = (highest existing
 * `order` in that section) + 1, so lessons auto-append in sequence and the admin
 * never has to hand-pick a number (which previously left everything at 0). An
 * empty section returns 1. Counts drafts too — every classified lecture occupies
 * an order slot regardless of publish state.
 */
export async function getNextLectureOrder(sectionId: string): Promise<number> {
  if (USE_MOCK) return mock.getNextLectureOrder(sectionId);
  const { data, error } = await supabase
    .from('lectures')
    .select('order')
    .eq('section_id', sectionId);
  if (error) throw error;
  const maxOrder = (data ?? []).reduce((m, r) => Math.max(m, r.order ?? 0), 0);
  return maxOrder + 1;
}

/** Toggle publish state (draft ↔ published) or send back to unclassified. */
export async function setLectureStatus(id: string, status: AppLectureStatus) {
  if (USE_MOCK) return mock.setLectureStatus(id, status);
  if (status === 'unclassified') {
    // Move back to queue: clear section + reset to draft
    const { error } = await supabase
      .from('lectures')
      .update({ section_id: null, status: 'draft' })
      .eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('lectures')
      .update({ status })
      .eq('id', id);
    if (error) throw error;
  }
}

/** Assign an unclassified lecture to a section with an order number. */
export async function classifyLecture(id: string, sectionId: string, order: number) {
  if (USE_MOCK) return mock.classifyLecture(id, sectionId, order);
  const { error } = await supabase
    .from('lectures')
    .update({ section_id: sectionId, order })
    .eq('id', id);
  if (error) throw error;
}

/** Edit a lecture's metadata (title/section/sheikh/order/status). */
export async function updateLecture(
  id: string,
  input: {
    title?: string;
    sectionId?: string | null;
    sheikhId?: string | null;
    order?: number;
    status?: AppLectureStatus;
  },
): Promise<void> {
  if (USE_MOCK) return mock.updateLecture(id, input);
  const patch: {
    title?: string;
    section_id?: string | null;
    sheikh_id?: string | null;
    order?: number;
    status?: 'draft' | 'published';
  } = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.sectionId !== undefined) patch.section_id = input.sectionId;
  if (input.sheikhId !== undefined) patch.sheikh_id = input.sheikhId;
  if (input.order !== undefined) patch.order = input.order;
  if (input.status !== undefined) {
    // `unclassified` is the app-level "draft + no section" state (see config).
    if (input.status === 'unclassified') {
      patch.status = 'draft';
      patch.section_id = null;
    } else {
      patch.status = input.status;
    }
  }
  const { error } = await supabase.from('lectures').update(patch).eq('id', id);
  if (error) throw error;
}

/**
 * Persist a drag-and-drop reorder: `ids` are SIBLING lecture ids (same
 * section_id) in their new order; the RPC (migration 0067) rewrites their
 * "order" to 1..n. The server rejects a mixed-section list, so a drag can
 * never move a lecture into another section by accident.
 */
export async function reorderLectures(ids: string[]): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('admin_reorder_lectures', { p_ids: ids });
  if (error) throw error;
}

/**
 * Delete a lecture: remove the DB row (progress + attachments cascade via FK)
 * then best-effort delete its audio object from the `lectures` bucket.
 */
export async function deleteLecture(id: string): Promise<void> {
  if (USE_MOCK) return mock.deleteLecture(id);
  const { data: row } = await supabase
    .from('lectures')
    .select('audio_path')
    .eq('id', id)
    .single();
  const { error } = await supabase.from('lectures').delete().eq('id', id);
  if (error) throw error;
  if (row?.audio_path) {
    await deleteFromR2(row.audio_path);
  }
}

/**
 * Editable fields for every section (description/order/show_header/parent),
 * keyed by id by the caller. The flat-tree RPC (get_sections_flat) intentionally
 * returns only display fields, so the admin editor reads these separately.
 */
export async function getSectionsEditData(): Promise<SectionEditData[]> {
  if (USE_MOCK) return mock.getSectionsEditData();
  const { data, error } = await supabase.from('sections')
    .select('id, title, description, order, show_header, parent_id, visibility');
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description ?? null,
    parentId: s.parent_id ?? null,
    order: s.order,
    showHeader: s.show_header,
    visibility: s.visibility as SectionVisibility,
  }));
}

/** Create a section / inner item under a parent (null = top-level). */
export async function createSection(input: {
  title: string;
  parentId: string | null;
  description?: string | null;
  coverLetter?: string;
  showHeader?: boolean;
  visibility?: SectionVisibility;
}): Promise<{ id: string }> {
  if (USE_MOCK) return mock.createSection(input);
  // Derive cover_letter: first char of title after stripping leading ال
  const cl = input.coverLetter?.trim() ||
    input.title.replace(/^ال/, '')[0] ||
    input.title[0] ||
    '';
  const { data, error } = await supabase.from('sections')
    .insert({
      title: input.title,
      parent_id: input.parentId,
      description: input.description ?? null,
      cover_letter: cl,
      show_header: input.showHeader ?? true,
      visibility: input.visibility ?? 'all',
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('create section failed');
  return { id: data.id };
}

/** Edit a section node (title/description/parent/order/show_header/visibility). */
export async function updateSection(
  id: string,
  input: {
    title?: string;
    description?: string | null;
    parentId?: string | null;
    order?: number;
    showHeader?: boolean;
    visibility?: SectionVisibility;
  },
): Promise<void> {
  if (USE_MOCK) return mock.updateSection(id, input);
  const patch: {
    title?: string;
    description?: string | null;
    parent_id?: string | null;
    order?: number;
    show_header?: boolean;
    visibility?: SectionVisibility;
  } = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.parentId !== undefined) patch.parent_id = input.parentId;
  if (input.order !== undefined) patch.order = input.order;
  if (input.showHeader !== undefined) patch.show_header = input.showHeader;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  const { error } = await supabase.from('sections').update(patch).eq('id', id);
  if (error) throw error;
}

/**
 * Persist a drag-and-drop reorder: `ids` are SIBLING section ids in their new
 * order; the RPC (migration 0059) rewrites their "order" to 1..n. The server
 * rejects a mixed-parent list, so a drag can never re-parent by accident.
 */
export async function reorderSections(ids: string[]): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('admin_reorder_sections', { p_ids: ids });
  if (error) throw error;
}

/**
 * Delete a section. ⚠️ The `parent_id` and `lectures.section_id` FKs are
 * `ON DELETE CASCADE`, so this removes ALL descendant sections AND their
 * lectures (and those lectures' progress/attachments). The caller must confirm.
 * Orphaned audio objects in storage are left behind (harmless); per-lecture
 * deletes clean storage, but a subtree cascade does not walk it.
 */
export async function deleteSection(id: string): Promise<void> {
  if (USE_MOCK) return mock.deleteSection(id);
  const { error } = await supabase.from('sections').delete().eq('id', id);
  if (error) throw error;
}
