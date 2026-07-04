/**
 * التذكيرات النافعة data access (V7 feature).
 *
 * Admin/publisher broadcast reminders about virtuous seasons/sunan, sent to
 * every student as a `beneficial_reminder` push + inbox row (fan-out happens
 * inside the migration-0034 create_broadcast DEFINER RPC). Writes are RPCs
 * gated on is_content_manager(); reads go through the broadcasts RLS (any
 * authenticated user, non-deleted rows). While `USE_MOCK` is true everything
 * returns inert empty shapes (quiz/Q&A pattern).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

/** One broadcast reminder (admin list + detail page share the shape). */
export type Broadcast = {
  id: string;
  title: string;
  body: string;
  showOnHome: boolean;
  publishedAt: string;
  updatedAt: string;
};

/** A Home-card row (the 1-day show_on_home window, server-filtered). */
export type HomeBroadcast = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
};

export type BroadcastInput = {
  title: string;
  body: string;
  showOnHome: boolean;
};

/** Admin/publisher list — every non-deleted broadcast, newest first. */
export async function listBroadcasts(): Promise<Broadcast[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase
    .from('broadcasts')
    .select('id, title, body, show_on_home, published_at, updated_at')
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    body: b.body,
    showOnHome: b.show_on_home,
    publishedAt: b.published_at ?? b.updated_at,
    updatedAt: b.updated_at,
  }));
}

/** Create + immediately fan out the push to every student. Returns the id. */
export async function createBroadcast(input: BroadcastInput): Promise<string> {
  if (USE_MOCK) return 'mock-broadcast';
  const { data, error } = await supabase.rpc('create_broadcast', {
    p_title: input.title,
    p_body: input.body,
    p_show_on_home: input.showOnHome,
  });
  if (error) throw error;
  return data as string;
}

/** Edit a broadcast (already-sent inbox rows keep their original wording). */
export async function updateBroadcast(id: string, input: BroadcastInput): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('update_broadcast', {
    p_id: id,
    p_title: input.title,
    p_body: input.body,
    p_show_on_home: input.showOnHome,
  });
  if (error) throw error;
}

/** Soft-delete a broadcast (also clears its inbox rows server-side). */
export async function deleteBroadcast(id: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('delete_broadcast', { p_id: id });
  if (error) throw error;
}

/** Active Home cards (show_on_home + published within the last day). */
export async function getHomeBroadcasts(): Promise<HomeBroadcast[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_home_broadcasts');
  if (error) throw error;
  return ((data ?? []) as {
    id: string;
    title: string;
    body: string;
    published_at: string;
  }[]).map((b) => ({
    id: b.id,
    title: b.title,
    body: b.body,
    publishedAt: b.published_at,
  }));
}

/** The full reminder for the detail page; null when deleted/unknown. */
export async function getBroadcast(id: string): Promise<Broadcast | null> {
  if (USE_MOCK) return null;
  const { data, error } = await supabase.rpc('get_broadcast', { p_id: id });
  if (error) throw error;
  const row = (data as {
    id: string;
    title: string;
    body: string;
    show_on_home: boolean;
    published_at: string;
    updated_at: string;
  }[] | null)?.[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    showOnHome: row.show_on_home,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}
