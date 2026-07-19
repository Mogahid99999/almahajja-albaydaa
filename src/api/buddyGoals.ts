/**
 * «أهداف الرفقة» buddy shared goals data access (V20 · §10).
 *
 * Each buddy pairing can have its own independent goal; each side has its own
 * share and neither completes for the other. All cross-user work goes through the
 * SECURITY DEFINER RPCs in migration 0112 (create/respond/cancel/get/settle);
 * components never touch supabase (CLAUDE.md).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type BuddyGoalMetric = 'lectures' | 'minutes' | 'active_days';

/** Server status, plus the display-only derived states the UI phrases (§10). */
export type BuddyGoalStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'expired'
  | 'declined'
  | 'cancelled';

export type BuddyGoal = {
  id: string;
  buddyId: string;
  buddyName: string;
  metric: BuddyGoalMetric;
  target: number;
  myProgress: number;
  buddyProgress: number;
  startsOn: string;
  endsOn: string;
  daysLeft: number;
  status: BuddyGoalStatus;
  iCreated: boolean;
};

export type IncomingBuddyGoal = {
  id: string;
  fromName: string;
  metric: BuddyGoalMetric;
  target: number;
  days: number;
  createdAt: string;
};

/** Create (invite) a shared goal with a buddy. */
export async function createBuddyGoal(args: {
  buddyId: string;
  metric: BuddyGoalMetric;
  target: number;
  days: number;
}): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('create_buddy_goal', {
    p_buddy_id: args.buddyId,
    p_metric: args.metric,
    p_target: args.target,
    p_days: args.days,
  });
  if (error) throw error;
}

/** Accept / decline an incoming shared-goal invitation. */
export async function respondBuddyGoal(goalId: string, accept: boolean): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('respond_buddy_goal', {
    p_goal_id: goalId,
    p_accept: accept,
  });
  if (error) throw error;
}

/** Cancel a pending/active shared goal (either side). */
export async function cancelBuddyGoal(goalId: string): Promise<void> {
  if (USE_MOCK) return;
  const { error } = await supabase.rpc('cancel_buddy_goal', { p_goal_id: goalId });
  if (error) throw error;
}

/** All my shared goals with live progress + buddy names. */
export async function getBuddyGoals(): Promise<BuddyGoal[]> {
  if (USE_MOCK) return [];
  // Settle any newly-finished goals first so the read reflects completion (cheap,
  // idempotent). Best-effort — a failure here never blocks the list.
  try {
    await supabase.rpc('settle_buddy_goals');
  } catch {
    /* ignore — the list still renders */
  }
  const { data, error } = await supabase.rpc('get_buddy_goals');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    buddyId: r.buddy_id,
    buddyName: r.buddy_name ?? 'رفيقك',
    metric: (r.metric as BuddyGoalMetric) ?? 'lectures',
    target: Number(r.target ?? 0),
    myProgress: Number(r.my_progress ?? 0),
    buddyProgress: Number(r.buddy_progress ?? 0),
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    daysLeft: Number(r.days_left ?? 0),
    status: (r.status as BuddyGoalStatus) ?? 'active',
    iCreated: !!r.i_created,
  }));
}

/** Incoming shared-goal invitations (for the invitations page). */
export async function getIncomingBuddyGoals(): Promise<IncomingBuddyGoal[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('get_incoming_buddy_goals');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    fromName: r.from_name ?? 'طالب علم',
    metric: (r.metric as BuddyGoalMetric) ?? 'lectures',
    target: Number(r.target ?? 0),
    days: Number(r.days ?? 0),
    createdAt: r.created_at,
  }));
}
