/**
 * Content search — بحث (bottom nav). Server-side full-text search (Postgres
 * tsvector, prefix-matched) over published content only, across six
 * categories: sections, lectures, sheikhs, attachments, lecture_benefits
 * (فوائد), and questions — via the search_content() RPC (migration 0068).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type { SearchResults } from './types';

const EMPTY_RESULTS: SearchResults = {
  lectures: [],
  sections: [],
  sheikhs: [],
  attachments: [],
  benefits: [],
  questions: [],
};

/** The jsonb document shape returned by the search_content RPC (migration 0068). */
type SearchContentRpc = {
  lectures: Array<{
    id: string;
    title: string;
    duration_sec: number;
    sheikh_name: string | null;
    section_title: string | null;
  }>;
  sections: Array<{
    id: string;
    title: string;
    cover_letter: string | null;
  }>;
  sheikhs: Array<{
    id: string;
    name: string;
  }>;
  attachments: Array<{
    id: string;
    type: string;
    title: string;
    section_id: string | null;
    lecture_id: string | null;
    section_title: string | null;
    lecture_title: string | null;
  }>;
  benefits: Array<{
    id: string;
    lecture_id: string;
    lecture_title: string;
    snippet: string;
  }>;
  questions: Array<{
    id: string;
    scope: 'general' | 'lecture';
    lecture_id: string | null;
    lecture_title: string | null;
    body_snippet: string;
    answer_snippet: string;
  }>;
};

export async function searchContent(query: string): Promise<SearchResults> {
  if (USE_MOCK) return EMPTY_RESULTS;
  if (query.trim() === '') return EMPTY_RESULTS;

  const { data, error } = await supabase.rpc('search_content', { p_search: query });
  if (error) throw error;

  const page = (data ?? EMPTY_RESULTS) as unknown as SearchContentRpc;

  return {
    lectures: (page.lectures ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      durationSec: l.duration_sec ?? 0,
      sheikhName: l.sheikh_name,
      sectionTitle: l.section_title,
    })),
    sections: (page.sections ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      coverLetter: s.cover_letter,
    })),
    sheikhs: (page.sheikhs ?? []).map((sh) => ({
      id: sh.id,
      name: sh.name,
    })),
    attachments: (page.attachments ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      sectionId: a.section_id,
      lectureId: a.lecture_id,
      sectionTitle: a.section_title,
      lectureTitle: a.lecture_title,
    })),
    benefits: (page.benefits ?? []).map((b) => ({
      id: b.id,
      lectureId: b.lecture_id,
      lectureTitle: b.lecture_title,
      snippet: b.snippet,
    })),
    questions: (page.questions ?? []).map((q) => ({
      id: q.id,
      scope: q.scope,
      lectureId: q.lecture_id,
      lectureTitle: q.lecture_title,
      bodySnippet: q.body_snippet,
      answerSnippet: q.answer_snippet,
    })),
  };
}
