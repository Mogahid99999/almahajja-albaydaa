/**
 * App rating (not lecture ratings) — a star + optional message, one per user,
 * submitted through the DEFINER RPC submit_rating (migration 0065). Guest
 * sessions may rate too, same as feedback/reports.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export async function submitRating(stars: number, message?: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('submit_rating', {
    p_stars: stars,
    p_message: message?.trim() || undefined,
  });
  if (error) throw error;
}

export type AdminRatingsSummary = {
  avgStars: number;
  totalRatings: number;
};

export async function getAdminRatingsSummary(): Promise<AdminRatingsSummary> {
  if (USE_MOCK) return { avgStars: 0, totalRatings: 0 };
  const { data, error } = await supabase.rpc('admin_ratings_summary');
  if (error) throw error;
  const row = (data ?? [])[0] as { avg_stars?: number; total_ratings?: number } | undefined;
  return {
    avgStars: Number(row?.avg_stars ?? 0),
    totalRatings: Number(row?.total_ratings ?? 0),
  };
}

export type AdminRatingRow = {
  id: string;
  stars: number;
  message: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: string;
};

export async function adminListRatings(): Promise<AdminRatingRow[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('admin_list_ratings');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    stars: r.stars,
    message: r.message ?? null,
    userId: r.user_id ?? null,
    userName: r.user_name ?? null,
    createdAt: r.created_at,
  }));
}

export async function adminDeleteRating(ratingId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('admin_delete_rating', { p_rating_id: ratingId });
  if (error) throw error;
}
