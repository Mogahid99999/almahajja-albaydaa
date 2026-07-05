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
import type { HomeData, FlatSectionNode, SectionPageData, SectionCard, LectureRow, LectureCard, Attachment } from './types';
import { resolveAttachmentRows } from './attachments';
import { mapCard, type RawStatusRow } from './quizzes';

export type { HomeData, FlatSectionNode, SectionPageData } from './types';

function coverLetter(stored: string, title: string): string {
  if (stored && stored.trim()) return stored.trim();
  // Strip leading ال before taking first char
  return title.replace(/^ال/, '')[0] ?? title[0] ?? '◆';
}

/** Home screen: resume card + أُضيف حديثاً rail + مختارات rail + sections grid. */
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

  // «أُضيف حديثاً» — newest published lectures, auto-sorted by created_at.
  const { data: newData } = await supabase
    .from('lectures')
    .select('id, title, duration_sec, sheikhs(name), sections(title)')
    .eq('status', 'published')
    .not('section_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(8);
  const newlyAdded: LectureCard[] = (newData ?? []).map((l) => {
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

  // «مختارات» — the staff-curated ordered list.
  const { data: featuredData } = await supabase.rpc('get_featured_lectures');
  const featured: LectureCard[] = (featuredData ?? []).map((l) => ({
    id: l.lecture_id,
    title: l.title,
    sheikhName: l.sheikh_name ?? null,
    durationSec: l.duration_sec ?? 0,
    coverLetter: l.section_title?.[0] ?? '◆',
  }));

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

  return { continueListening, newlyAdded, featured, sections };
}

/** The jsonb document shape returned by the get_section_page RPC (migration 0045). */
type SectionPageRpc = {
  section: {
    id: string;
    title: string;
    description: string | null;
    cover_image: string | null;
    cover_letter: string;
    show_header: boolean;
    parent_id: string | null;
  };
  parent_title: string | null;
  rollup: { total: number; completed: number; sheikh_names: string[] };
  subsections: { id: string; title: string; cover_letter: string; total: number; completed: number }[];
  lectures: {
    id: string;
    title: string;
    duration_sec: number;
    order: number;
    sheikh_name: string | null;
    position_sec: number;
    completed: boolean;
  }[];
  attachments: {
    id: string;
    type: string;
    title: string;
    description: string | null;
    storage_path: string | null;
    external_url: string | null;
    body: string | null;
    order: number;
  }[];
  quizzes: RawStatusRow[];
};

/**
 * Generic section page (rendered at every level of the tree). Student view.
 *
 * One RPC (get_section_page, migration 0045) replaces the old ~6 sequential
 * round-trips — the whole page arrives as a single jsonb document, mapped to
 * SectionPageData here. Signed URLs for attachments are still minted client-side
 * (resolveAttachmentRows), keeping them out of the cached RPC payload.
 */
export async function getSectionPage(sectionId: string): Promise<SectionPageData> {
  if (USE_MOCK) return mock.getSectionPage(sectionId);

  const { data, error } = await supabase.rpc('get_section_page', {
    p_section_id: sectionId,
  });
  if (error) throw error;
  if (!data) throw new Error('section not found');
  const page = data as unknown as SectionPageRpc;

  const total = Number(page.rollup?.total ?? 0);
  const completed = Number(page.rollup?.completed ?? 0);

  const subsections: SectionCard[] = (page.subsections ?? []).map((s) => {
    const t = Number(s.total ?? 0);
    const c = Number(s.completed ?? 0);
    return {
      id: s.id,
      title: s.title,
      coverLetter: coverLetter(s.cover_letter, s.title),
      lectureCount: t,
      progressPct: t > 0 ? Math.round((c / t) * 100) : 0,
    };
  });

  const lectures: LectureRow[] = (page.lectures ?? []).map((l) => {
    const pos = l.position_sec ?? 0;
    return {
      id: l.id,
      title: l.title,
      durationSec: l.duration_sec ?? 0,
      sheikhName: l.sheikh_name ?? null,
      status: l.completed ? 'completed' : pos > 0 ? 'in_progress' : 'new',
      positionSec: pos,
      order: l.order,
    };
  });

  const attachments: Attachment[] = await resolveAttachmentRows((page.attachments ?? []) as any);
  const quizzes = (page.quizzes ?? []).map(mapCard);

  return {
    section: {
      id: page.section.id,
      title: page.section.title,
      description: page.section.description,
      coverLetter: coverLetter(page.section.cover_letter, page.section.title),
      coverImage: page.section.cover_image,
      showHeader: page.section.show_header,
    },
    parentTitle: page.parent_title ?? null,
    sheikhNames: page.rollup?.sheikh_names ?? [],
    rollup: {
      total,
      completed,
      progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    subsections,
    lectures,
    attachments,
    quizzes,
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
