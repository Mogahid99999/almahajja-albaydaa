/**
 * Section / tree data access.
 *
 * Returns the UI DTOs in `src/api/types.ts`. While `USE_MOCK` is true everything
 * is served from `src/mock/*`; the live Supabase path (recursive-CTE rollups in
 * supabase/migrations) is wired when the flag flips. Components never import
 * supabase directly (CLAUDE.md › Stack conventions).
 */
import { USE_MOCK } from '@/config';
import * as mock from '@/mock/api';
import type { HomeData, FlatSectionNode, SectionPageData } from './types';

export type { HomeData, FlatSectionNode, SectionPageData } from './types';

const NOT_LIVE = (fn: string) =>
  new Error(`[live mode] ${fn} not wired yet — set USE_MOCK=false work pending`);

/** Home screen: resume card + newly-added rail + sections grid. */
export async function getHomeData(): Promise<HomeData> {
  if (USE_MOCK) return mock.getHomeData();
  throw NOT_LIVE('getHomeData');
}

/** Generic section page (rendered at every level of the tree). Student view. */
export async function getSectionPage(sectionId: string): Promise<SectionPageData> {
  if (USE_MOCK) return mock.getSectionPage(sectionId);
  throw NOT_LIVE('getSectionPage');
}

/** Whole tree flattened (depth + path) for the admin parent-section picker. */
export async function getSectionsFlat(): Promise<FlatSectionNode[]> {
  if (USE_MOCK) return mock.getSectionsFlat();
  throw NOT_LIVE('getSectionsFlat');
}
