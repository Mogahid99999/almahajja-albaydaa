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
import type { AdminLectureRow, UnclassifiedItem } from './types';

export type { AdminLectureRow, UnclassifiedItem } from './types';

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
    .select('id, title, status, duration_sec, order, sections(title), sheikhs(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const data = raw ?? [];
  return data.map((l) => {
    const sec = Array.isArray(l.sections) ? l.sections[0] : (l.sections as any);
    const sheikh = Array.isArray(l.sheikhs) ? l.sheikhs[0] : (l.sheikhs as any);
    const dbStatus = l.status as 'draft' | 'published';
    const appStatus: AppLectureStatus =
      sec === null ? 'unclassified' : dbStatus;
    return {
      id: l.id,
      title: l.title,
      sectionTitle: sec?.title ?? null,
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
}): Promise<{ id: string }> {
  if (USE_MOCK) return mock.createLecture(input);
  const dbStatus = input.status === 'unclassified' ? 'draft' : input.status;
  const { data, error } = await supabase
    .from('lectures')
    .insert({
      title: input.title,
      section_id: input.sectionId,
      sheikh_id: input.sheikhId,
      order: input.order,
      duration_sec: input.durationSec ?? null,
      status: dbStatus,
      audio_path: null,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('create lecture failed');
  return { id: data.id };
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

/** Create a section / inner item under a parent (null = top-level). */
export async function createSection(input: {
  title: string;
  parentId: string | null;
  description?: string | null;
  coverLetter?: string;
  showHeader?: boolean;
}): Promise<{ id: string }> {
  if (USE_MOCK) return mock.createSection(input);
  // Derive cover_letter: first char of title after stripping leading ال
  const cl = input.coverLetter?.trim() ||
    input.title.replace(/^ال/, '')[0] ||
    input.title[0] ||
    '';
  const { data, error } = await supabase
    .from('sections')
    .insert({
      title: input.title,
      parent_id: input.parentId,
      description: input.description ?? null,
      cover_letter: cl,
      show_header: input.showHeader ?? true,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('create section failed');
  return { id: data.id };
}
