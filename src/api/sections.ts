/**
 * Section / tree data access.
 *
 * Returns the UI DTOs in `src/api/types.ts`. While `USE_MOCK` is true everything
 * is served from `src/mock/*`; the live Supabase path (recursive-CTE rollups in
 * supabase/migrations) is wired when the flag flips. Components never import
 * supabase directly (CLAUDE.md › Stack conventions).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import type { HomeData, FlatSectionNode, SectionPageData, SectionCard, LectureRow } from './types';
import { resolveAttachmentRows } from './attachments';

export type { HomeData, FlatSectionNode, SectionPageData } from './types';

function coverLetter(stored: string, title: string): string {
  if (stored && stored.trim()) return stored.trim();
  // Strip leading ال before taking first char
  return title.replace(/^ال/, '')[0] ?? title[0] ?? '◆';
}

/** Home screen: resume card + newly-added rail + sections grid. */
export async function getHomeData(): Promise<HomeData> {
  if (USE_MOCK) return mock.getHomeData();

  const { data: rootData, error: rErr } = await supabase
    .from('sections')
    .select('id, title, cover_letter')
    .is('parent_id', null)
    .order('order');
  if (rErr) throw rErr;
  const rootRows = rootData ?? [];

  let sections: SectionCard[] = [];
  if (rootRows.length > 0) {
    const { data: rollupsData } = await supabase.rpc('get_children_rollups', {
      p_section_ids: rootRows.map((s) => s.id),
    });
    const rollups = rollupsData ?? [];
    const byId = Object.fromEntries(rollups.map((r) => [r.section_id, r]));
    sections = rootRows.map((s) => {
      const r = byId[s.id];
      const total = Number(r?.total_lectures ?? 0);
      const completed = Number(r?.completed_lectures ?? 0);
      return {
        id: s.id,
        title: s.title,
        coverLetter: coverLetter(s.cover_letter, s.title),
        lectureCount: total,
        progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });
  }

  const { data: newData } = await supabase
    .from('lectures')
    .select('id, title, duration_sec, sheikhs(name), sections(title)')
    .eq('status', 'published')
    .not('section_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);
  const newRows = newData ?? [];

  const newlyAdded = newRows.map((l) => {
    const sheikh = Array.isArray(l.sheikhs) ? l.sheikhs[0] : (l.sheikhs as any);
    const sec = Array.isArray(l.sections) ? l.sections[0] : (l.sections as any);
    return {
      id: l.id,
      title: l.title,
      sheikhName: sheikh?.name ?? null,
      durationSec: l.duration_sec ?? 0,
      coverLetter: (sec?.title?.[0]) ?? '◆',
    };
  });

  const { data: prog } = await supabase
    .from('user_lecture_progress')
    .select('position_sec, lectures(id, title, duration_sec, sheikhs(name), sections(title))')
    .eq('completed', false)
    .gt('position_sec', 0)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let continueListening: HomeData['continueListening'] = null;
  if (prog) {
    const lec = Array.isArray(prog.lectures) ? prog.lectures[0] : (prog.lectures as any);
    if (lec) {
      const sheikh = Array.isArray(lec.sheikhs) ? lec.sheikhs[0] : (lec.sheikhs as any);
      const sec = Array.isArray(lec.sections) ? lec.sections[0] : (lec.sections as any);
      continueListening = {
        id: lec.id,
        title: lec.title,
        sheikhName: sheikh?.name ?? null,
        eyebrow: sec?.title ?? '',
        positionSec: prog.position_sec,
        durationSec: lec.duration_sec ?? 0,
      };
    }
  }

  return { continueListening, newlyAdded, sections };
}

/** Generic section page (rendered at every level of the tree). Student view. */
export async function getSectionPage(sectionId: string): Promise<SectionPageData> {
  if (USE_MOCK) return mock.getSectionPage(sectionId);

  const [{ data: section, error: sErr }, rollupResult] = await Promise.all([
    supabase
      .from('sections')
      .select('id, title, description, cover_image, cover_letter, show_header, parent_id')
      .eq('id', sectionId)
      .single(),
    supabase.rpc('get_section_rollup', { p_section_id: sectionId }),
  ]);
  if (sErr || !section) throw sErr ?? new Error('section not found');

  const rollupRow = rollupResult.data?.[0];
  const total = Number(rollupRow?.total_lectures ?? 0);
  const completed = Number(rollupRow?.completed_lectures ?? 0);

  let parentTitle: string | null = null;
  if (section.parent_id) {
    const { data: parent } = await supabase
      .from('sections')
      .select('title')
      .eq('id', section.parent_id)
      .single();
    parentTitle = parent?.title ?? null;
  }

  const { data: subData } = await supabase
    .from('sections')
    .select('id, title, cover_letter')
    .eq('parent_id', sectionId)
    .order('order');
  const subRows = subData ?? [];

  let subsections: SectionCard[] = [];
  if (subRows.length > 0) {
    const { data: subRollupsData } = await supabase.rpc('get_children_rollups', {
      p_section_ids: subRows.map((s) => s.id),
    });
    const subRollups = subRollupsData ?? [];
    const byId = Object.fromEntries(subRollups.map((r) => [r.section_id, r]));
    subsections = subRows.map((s) => {
      const r = byId[s.id];
      const t = Number(r?.total_lectures ?? 0);
      const c = Number(r?.completed_lectures ?? 0);
      return {
        id: s.id,
        title: s.title,
        coverLetter: coverLetter(s.cover_letter, s.title),
        lectureCount: t,
        progressPct: t > 0 ? Math.round((c / t) * 100) : 0,
      };
    });
  }

  const { data: lectureData } = await supabase
    .from('lectures')
    .select('id, title, duration_sec, order, sheikhs(name), user_lecture_progress(position_sec, completed)')
    .eq('section_id', sectionId)
    .eq('status', 'published')
    .order('order');
  const lectureRows = lectureData ?? [];

  const lectures: LectureRow[] = lectureRows.map((l) => {
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
      order: l.order,
    };
  });

  const { data: attRows = [] } = await supabase
    .from('attachments')
    .select('id, type, title, description, storage_path, external_url, body, order')
    .eq('section_id', sectionId)
    .order('order');

  const attachments = await resolveAttachmentRows(attRows as any);

  return {
    section: {
      id: section.id,
      title: section.title,
      description: section.description,
      coverLetter: coverLetter(section.cover_letter, section.title),
      coverImage: section.cover_image,
      showHeader: section.show_header,
    },
    parentTitle,
    sheikhNames: (rollupRow?.sheikh_names as string[]) ?? [],
    rollup: {
      total,
      completed,
      progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    subsections,
    lectures,
    attachments,
  };
}

/** Whole tree flattened (depth + path) for the admin parent-section picker. */
export async function getSectionsFlat(): Promise<FlatSectionNode[]> {
  if (USE_MOCK) return mock.getSectionsFlat();
  const { data, error } = await supabase.rpc('get_sections_flat');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    parentId: r.parent_id ?? null,
    depth: r.depth,
    path: r.path,
  }));
}
