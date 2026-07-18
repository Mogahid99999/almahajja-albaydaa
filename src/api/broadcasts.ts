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
import { deleteFromR2, getReadUrl, uploadToR2, type PickedFile } from './storage';

/** One broadcast reminder (admin list + detail page share the shape). */
export type Broadcast = {
  id: string;
  title: string;
  body: string;
  showOnHome: boolean;
  publishedAt: string;
  updatedAt: string;
  /** R2 object key (bucket-relative) — resolve via `getBroadcastImageUrl`. */
  imagePath: string | null;
  /** R2 audio key (bucket-relative) — resolve via `getBroadcastAudioUrl`. */
  audioPath: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  /** Distinct users who opened this reminder (admin list only). */
  viewCount?: number;
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
  /** R2 object key already uploaded via `uploadBroadcastImage`, or null to clear it. */
  imagePath?: string | null;
  /** R2 audio key already uploaded via `uploadBroadcastAudio`, or null to clear it. */
  audioPath?: string | null;
  linkUrl?: string | null;
  linkLabel?: string | null;
};

/** Admin/publisher list — every non-deleted broadcast, newest first. */
export async function listBroadcasts(): Promise<Broadcast[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase
    .from('broadcasts')
    .select('id, title, body, show_on_home, published_at, updated_at, image_path, audio_path, link_url, link_label')
    .order('published_at', { ascending: false });
  if (error) throw error;
  const counts = await getBroadcastViewCounts();
  return (data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    body: b.body,
    showOnHome: b.show_on_home,
    publishedAt: b.published_at ?? b.updated_at,
    updatedAt: b.updated_at,
    imagePath: b.image_path ?? null,
    audioPath: b.audio_path ?? null,
    linkUrl: b.link_url ?? null,
    linkLabel: b.link_label ?? null,
    viewCount: counts[b.id] ?? 0,
  }));
}

/**
 * Record that the current user opened a reminder (best-effort; a view-track must
 * never break the detail screen). Guests/anon are skipped server-side, so a
 * failure here is silently swallowed.
 */
export async function recordBroadcastView(id: string): Promise<void> {
  if (USE_MOCK) return;
  try {
    // ignore the returned { error } too — this is a fire-and-forget track.
    // Cast: the RPC lives in migration 0083, not (yet) in database.generated.ts.
    await (supabase.rpc as unknown as (fn: string, args: object) => Promise<unknown>)(
      'record_broadcast_view',
      { p_id: id },
    );
  } catch {
    // best-effort — never surface a view-tracking failure to the reader
  }
}

/** Admin-only reach counts, reduced to a `{ broadcastId: viewCount }` map. */
export async function getBroadcastViewCounts(): Promise<Record<string, number>> {
  if (USE_MOCK) return {};
  // Cast: the RPC lives in migration 0083, not (yet) in database.generated.ts.
  const { data, error } = await (
    supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown; error: unknown }>
  )('get_broadcast_view_counts');
  if (error) throw error;
  return ((data ?? []) as { broadcast_id: string; view_count: number }[]).reduce<
    Record<string, number>
  >((acc, row) => {
    acc[row.broadcast_id] = row.view_count;
    return acc;
  }, {});
}

/** Upload a picked image to R2 for a reminder; returns its object key. */
export async function uploadBroadcastImage(file: PickedFile): Promise<string> {
  if (USE_MOCK) return 'mock-broadcast-image';
  return uploadToR2('broadcast', file);
}

/** Resolve a broadcast's image key → a short-lived signed URL, or null. */
export async function getBroadcastImageUrl(imagePath: string): Promise<string | null> {
  if (USE_MOCK) return null;
  return getReadUrl(imagePath);
}

/** Upload a picked audio clip to R2 for a reminder; returns its object key. */
export async function uploadBroadcastAudio(file: PickedFile): Promise<string> {
  if (USE_MOCK) return 'mock-broadcast-audio';
  return uploadToR2('broadcast', file);
}

/** Resolve a broadcast's audio key → a short-lived signed URL, or null. */
export async function getBroadcastAudioUrl(audioPath: string): Promise<string | null> {
  if (USE_MOCK) return null;
  return getReadUrl(audioPath);
}

/** Create + immediately fan out the push to every student. Returns the id. */
export async function createBroadcast(input: BroadcastInput): Promise<string> {
  if (USE_MOCK) return 'mock-broadcast';
  // `as never`: the new p_audio_path arg isn't in database.generated.ts until
  // types are regenerated post-0096. Runtime is unaffected.
  const { data, error } = await supabase.rpc('create_broadcast', {
    p_title: input.title,
    p_body: input.body,
    p_show_on_home: input.showOnHome,
    p_image_path: input.imagePath ?? undefined,
    p_link_url: input.linkUrl ?? undefined,
    p_link_label: input.linkLabel ?? undefined,
    p_audio_path: input.audioPath ?? undefined,
  } as never);
  if (error) throw error;
  return data as string;
}

/**
 * Edit a broadcast (already-sent inbox rows keep their original wording).
 * If the image was replaced or removed, the old R2 object is cleaned up
 * (best-effort, mirrors deleteLecture/deleteAttachment).
 */
export async function updateBroadcast(id: string, input: BroadcastInput): Promise<void> {
  if (USE_MOCK) return;
  const { data: prev } = await supabase
    .from('broadcasts')
    .select('image_path, audio_path')
    .eq('id', id)
    .single();
  const { error } = await supabase.rpc('update_broadcast', {
    p_id: id,
    p_title: input.title,
    p_body: input.body,
    p_show_on_home: input.showOnHome,
    p_image_path: input.imagePath ?? undefined,
    p_link_url: input.linkUrl ?? undefined,
    p_link_label: input.linkLabel ?? undefined,
    p_audio_path: input.audioPath ?? undefined,
  } as never);
  if (error) throw error;
  if (prev?.image_path && prev.image_path !== input.imagePath) {
    await deleteFromR2(prev.image_path);
  }
  // Clean up a replaced/removed audio clip too (best-effort).
  const prevAudio = (prev as { audio_path?: string | null } | null)?.audio_path;
  if (prevAudio && prevAudio !== input.audioPath) {
    await deleteFromR2(prevAudio);
  }
}

/**
 * Soft-delete a broadcast (also clears its inbox rows server-side) and clean
 * up its image from R2, if it had one (best-effort).
 */
export async function deleteBroadcast(id: string): Promise<void> {
  if (USE_MOCK) return;
  const { data: prev } = await supabase
    .from('broadcasts')
    .select('image_path, audio_path')
    .eq('id', id)
    .single();
  const { error } = await supabase.rpc('delete_broadcast', { p_id: id });
  if (error) throw error;
  if (prev?.image_path) {
    await deleteFromR2(prev.image_path);
  }
  const prevAudio = (prev as { audio_path?: string | null } | null)?.audio_path;
  if (prevAudio) {
    await deleteFromR2(prevAudio);
  }
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
    image_path: string | null;
    audio_path: string | null;
    link_url: string | null;
    link_label: string | null;
  }[] | null)?.[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    showOnHome: row.show_on_home,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    imagePath: row.image_path ?? null,
    audioPath: row.audio_path ?? null,
    linkUrl: row.link_url ?? null,
    linkLabel: row.link_label ?? null,
  };
}
