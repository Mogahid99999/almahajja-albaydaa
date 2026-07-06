/**
 * Content search — بحث (bottom nav). Server-side ilike search over published
 * lectures and sections via the search_content() RPC (migration 0058). The
 * gender/role filtering conventions from buddy search don't apply here; this
 * is public published content, same as Home.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type { SearchResults } from './types';

/** The jsonb document shape returned by the search_content RPC (migration 0058). */
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
};

export async function searchContent(query: string): Promise<SearchResults> {
  if (USE_MOCK) return { lectures: [], sections: [] };
  if (query.trim() === '') return { lectures: [], sections: [] };

  const { data, error } = await supabase.rpc('search_content', { p_search: query });
  if (error) throw error;

  const page = (data ?? { lectures: [], sections: [] }) as unknown as SearchContentRpc;
  const lectures = page.lectures ?? [];
  const sections = page.sections ?? [];

  return {
    lectures: lectures.map((l) => ({
      id: l.id,
      title: l.title,
      durationSec: l.duration_sec ?? 0,
      sheikhName: l.sheikh_name,
      sectionTitle: l.section_title,
    })),
    sections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      coverLetter: s.cover_letter,
    })),
  };
}
