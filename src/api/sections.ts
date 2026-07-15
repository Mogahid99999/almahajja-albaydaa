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
import { filterVisibleLectures, getLecturePlayback } from './lectures';
import { mapCard, type RawStatusRow } from './quizzes';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/constants/queryKeys';

export type { HomeData, FlatSectionNode, SectionPageData } from './types';

function coverLetter(stored: string, title: string): string {
  if (stored && stored.trim()) return stored.trim();
  // Strip leading ال before taking first char
  return title.replace(/^ال/, '')[0] ?? title[0] ?? '◆';
}

/** The jsonb document shape returned by the get_home_page RPC (migration 0047). */
type HomePageRpc = {
  sections: { id: string; title: string; cover_letter: string; total: number; completed: number }[];
  newly_added: {
    id: string;
    title: string;
    duration_sec: number;
    sheikh_name: string | null;
    section_title: string | null;
  }[];
  featured: {
    lecture_id: string;
    title: string;
    duration_sec: number;
    sheikh_name: string | null;
    section_title: string | null;
  }[];
  continue_listening: {
    lecture_id: string;
    title: string;
    sheikh_name: string | null;
    section_title: string | null;
    position_sec: number;
    duration_sec: number;
  } | null;
};

/**
 * Home screen: resume card + أُضيف حديثاً rail + مختارات rail + sections grid.
 *
 * V11 · D: one `get_home_page` RPC (migration 0047) replaces the 5 sequential
 * round-trips — the whole payload arrives as a single jsonb document, mapped to
 * HomeData here (the cover-letter fallback logic stays client-side). When a resume
 * lecture is present, its playback metadata is prefetched so «تابع الاستماع» opens
 * with no wait. Mock path untouched.
 */
export async function getHomeData(): Promise<HomeData> {
  if (USE_MOCK) return mock.getHomeData();

  const { data, error } = await supabase.rpc('get_home_page');
  if (error) throw error;
  const page = (data ?? {}) as unknown as HomePageRpc;

  const sections: SectionCard[] = (page.sections ?? []).map((s) => {
    const total = Number(s.total ?? 0);
    const completed = Number(s.completed ?? 0);
    return {
      id: s.id,
      title: s.title,
      coverLetter: coverLetter(s.cover_letter, s.title),
      lectureCount: total,
      progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  });

  const newlyAdded: LectureCard[] = (page.newly_added ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    sheikhName: l.sheikh_name ?? null,
    durationSec: l.duration_sec ?? 0,
    coverLetter: l.section_title?.[0] ?? '◆',
    sectionTitle: l.section_title ?? null,
  }));

  // get_home_page's featured leg delegates to get_featured_lectures(), the one
  // list 0049 left WITHOUT gender scoping (its own comment flags the gap) — the
  // other legs (sections/newest/resume) are filtered server-side. Until Phase 2
  // fixes the SQL, scope it here exactly like the standalone featured screen
  // (see filterVisibleLectures in api/lectures.ts — parallel, fail-open).
  const featured: LectureCard[] = await filterVisibleLectures(
    (page.featured ?? []).map((l) => ({
      id: l.lecture_id,
      title: l.title,
      sheikhName: l.sheikh_name ?? null,
      durationSec: l.duration_sec ?? 0,
      coverLetter: l.section_title?.[0] ?? '◆',
      sectionTitle: l.section_title ?? null,
    })),
  );

  const cl = page.continue_listening;
  const continueListening: HomeData['continueListening'] = cl
    ? {
        id: cl.lecture_id,
        title: cl.title,
        sheikhName: cl.sheikh_name ?? null,
        eyebrow: cl.section_title ?? '',
        positionSec: cl.position_sec ?? 0,
        durationSec: cl.duration_sec ?? 0,
      }
    : null;

  // Warm the resume lecture's playback metadata so tapping «تابع الاستماع» opens
  // the player with zero wait (V11 · D). The signed audioUrl's 3600s TTL safely
  // exceeds this 30-min staleTime, and prefetchQuery no-ops while it's fresh.
  if (continueListening) {
    const id = continueListening.id;
    void queryClient.prefetchQuery({
      queryKey: queryKeys.lecture(id),
      queryFn: () => getLecturePlayback(id),
      staleTime: 30 * 60_000,
    });
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
    audio_size_bytes: number | null;
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
      fileSizeBytes: l.audio_size_bytes ?? null,
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
    order: (r as { ord?: number }).ord ?? 0,
  }));
}
