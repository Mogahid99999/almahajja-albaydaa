/**
 * Database types.
 *
 * `database.generated.ts` is the source of truth — generated from the live
 * Supabase schema. Regenerate it after any schema change:
 *
 *   npx supabase gen types typescript --linked > src/types/database.generated.ts
 *   # (or via the Management API types endpoint)
 *
 * This file re-exports `Database` and adds ergonomic row / enum / rpc aliases
 * used across `src/api` and `src/hooks`.
 */
export type { Json, Database } from './database.generated';

import type { Database } from './database.generated';

// --- Enums -------------------------------------------------------------------
export type LectureStatus = Database['public']['Enums']['lecture_status'];
export type AppRole = Database['public']['Enums']['app_role'];

// --- Row aliases -------------------------------------------------------------
type Tables = Database['public']['Tables'];
export type Profile = Tables['profiles']['Row'];
export type Section = Tables['sections']['Row'];
export type Sheikh = Tables['sheikhs']['Row'];
export type Lecture = Tables['lectures']['Row'];
export type UserLectureProgress = Tables['user_lecture_progress']['Row'];

// --- RPC return aliases ------------------------------------------------------
type Functions = Database['public']['Functions'];
export type SectionRollup = Functions['get_section_rollup']['Returns'][number];
export type ChildRollup = Functions['get_children_rollups']['Returns'][number];
export type FlatSection = Functions['get_sections_flat']['Returns'][number];
