/**
 * Study buddy data access — رفيق الدراسة (26.2).
 *
 * Gender-segregated, optional, ONE buddy per user, no chat in v1. Every
 * cross-user read/write goes through the SECURITY DEFINER RPCs in migration
 * 0015 — the gender filter and the one-buddy invariant live server-side, never
 * in this file. Components never call supabase directly (CLAUDE.md).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type { BuddyCandidate, BuddyRequest, BuddyStatus } from './types';

export type { BuddyCandidate, BuddyRequest, BuddyStatus } from './types';

/** Same-gender candidates matching the search term (server-side filter). */
export async function searchBuddyCandidates(query: string): Promise<BuddyCandidate[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('search_buddy_candidates', {
    p_search: query,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    displayName: r.display_name,
    currentStreak: r.current_streak ?? 0,
  }));
}

/** Send an invitation. Invariants (gender, one buddy, no dup) enforced in SQL. */
export async function sendBuddyRequest(toUserId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('send_buddy_request', {
    p_to_user_id: toUserId,
  });
  if (error) throw error;
}

/** Accept / decline an incoming invitation. */
export async function respondToRequest(requestId: string, accept: boolean): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('respond_buddy_request', {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) throw error;
}

/** End the buddy relationship (and withdraw my outgoing pendings). */
export async function cancelBuddy(): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('cancel_buddy');
  if (error) throw error;
}

/** The accepted buddy's card data, or null when there is no buddy. */
export async function getMyBuddyStatus(): Promise<BuddyStatus | null> {
  if (USE_MOCK) return null;
  const { data, error } = await supabase.rpc('get_buddy_status');
  if (error) throw error;
  const row = data?.[0];
  if (!row?.buddy_id) return null;
  return {
    buddyId: row.buddy_id,
    displayName: row.display_name ?? 'رفيقك',
    currentStreak: row.current_streak ?? 0,
    todayCounted: row.today_counted ?? false,
    weekProgressPct: row.week_progress_pct ?? 0,
    weeklyGoalMet: row.weekly_goal_met ?? false,
  };
}

/** Incoming pending invitations (sender names resolved server-side). */
export async function getPendingIncomingRequests(): Promise<BuddyRequest[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_incoming_buddy_requests');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    fromDisplayName: r.from_display_name,
    createdAt: r.created_at,
  }));
}

// ─── Admin overview (V14 · migration 0079) ────────────────────────────────────

export type AdminBuddyPair = {
  aName: string;
  bName: string;
  since: string | null;
};

export type AdminBuddyOverview = {
  /** Students who enabled the feature = set profiles.gender. */
  enabledCount: number;
  activePairsCount: number;
  pendingCount: number;
  pairs: AdminBuddyPair[];
};

const EMPTY_OVERVIEW: AdminBuddyOverview = {
  enabledCount: 0,
  activePairsCount: 0,
  pendingCount: 0,
  pairs: [],
};

/** Admin-only counts + active pair list (names resolved server-side). */
export async function getAdminBuddyOverview(): Promise<AdminBuddyOverview> {
  if (USE_MOCK) return EMPTY_OVERVIEW;
  const { data, error } = await supabase.rpc('admin_buddy_overview');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, any>;
  return {
    enabledCount: d.enabled_count ?? 0,
    activePairsCount: d.active_pairs_count ?? 0,
    pendingCount: d.pending_count ?? 0,
    pairs: (d.pairs ?? []).map((p: any) => ({
      aName: p.a_name ?? 'طالب علم',
      bName: p.b_name ?? 'طالب علم',
      since: p.since ?? null,
    })),
  };
}

/** Whether I have an outgoing invitation still pending (own rows via RLS). */
export async function hasOutgoingPendingRequest(): Promise<boolean> {
  if (USE_MOCK) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from('buddy_requests')
    .select('id')
    .eq('from_user_id', user.id)
    .eq('status', 'pending')
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
