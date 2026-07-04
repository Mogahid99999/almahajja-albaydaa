/**
 * إدارة المستخدمين (Feature 4).
 *
 * READS go through admin-only SECURITY DEFINER RPCs (admin_user_list /
 * admin_user_detail, migration 0025) that may read auth.users.
 *
 * MUTATIONS that need the service role (ban/unban, set password with no old,
 * edit email/name, change role) go through the `admin-users` Edge Function
 * (verify_jwt=true; confirms the caller is admin inside). The service-role key
 * never ships in the client bundle.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type { AppRole } from './auth';
import type { AdminUserDetail, AdminUserRow } from './types';

function mapRow(r: any): AdminUserRow {
  return {
    id: r.id,
    displayName: r.display_name ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    gender: r.gender ?? null,
    role: (r.role ?? 'student') as AppRole,
    createdAt: r.created_at,
    lastOpenedAt: r.last_opened_at ?? null,
    lastSignInAt: r.last_sign_in_at ?? null,
    bannedUntil: r.banned_until ?? null,
    status: r.status,
    completedLectures: Number(r.completed_lectures ?? 0),
    passedQuizzes: Number(r.passed_quizzes ?? 0),
    currentStreak: r.current_streak ?? 0,
    weeklyGoalTarget: r.weekly_goal_target ?? null,
    weeklyGoalMetric: r.weekly_goal_metric ?? null,
  };
}

export async function getAdminUserList(search?: string): Promise<AdminUserRow[]> {
  if (USE_MOCK) return [];
  const { data, error } = await supabase.rpc('admin_user_list', {
    p_search: search && search.trim() ? search.trim() : undefined,
    p_limit: 300,
    p_offset: 0,
  });
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const { data, error } = await supabase.rpc('admin_user_detail', { p_user_id: userId });
  if (error) throw error;
  const d = (data ?? {}) as Record<string, any>;
  const p = d.profile ?? {};
  return {
    profile: {
      id: p.id,
      displayName: p.display_name ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      gender: p.gender ?? null,
      role: (p.role ?? 'student') as AppRole,
      createdAt: p.created_at,
      lastOpenedAt: p.last_opened_at ?? null,
      lastSignInAt: p.last_sign_in_at ?? null,
      bannedUntil: p.banned_until ?? null,
      status: p.status,
      currentStreak: p.current_streak ?? 0,
      weeklyGoalTarget: p.weekly_goal_target ?? null,
      weeklyGoalMetric: p.weekly_goal_metric ?? null,
    },
    totals: {
      completedLectures: d.totals?.completed_lectures ?? 0,
      inProgressLectures: d.totals?.in_progress_lectures ?? 0,
      passedQuizzes: d.totals?.passed_quizzes ?? 0,
    },
    progress: (d.progress ?? []).map((r: any) => ({
      lectureId: r.lecture_id,
      lectureTitle: r.lecture_title,
      sectionTitle: r.section_title ?? null,
      completed: !!r.completed,
      positionSec: r.position_sec ?? 0,
      durationSec: r.duration_sec ?? null,
      updatedAt: r.updated_at,
    })),
    quizResults: (d.quiz_results ?? []).map((r: any) => ({
      quizTitle: r.quiz_title,
      score: r.score ?? null,
      passed: r.passed ?? null,
      attemptNo: r.attempt_no ?? 1,
      submittedAt: r.submitted_at ?? null,
    })),
  };
}

// ─── Privileged mutations via the admin-users Edge Function ───────────────────

async function invokeAdmin(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // FunctionsHttpError carries the non-2xx Response in `context`; surface the
    // function's `{ error }` message rather than the generic status text.
    let msg = error.message;
    try {
      const j = await (error as any).context?.json?.();
      if (j?.error) msg = j.error;
    } catch {
      // keep the generic message
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const createUser = (input: {
  email: string;
  password: string;
  displayName: string;
  role: AppRole;
}) =>
  invokeAdmin({
    action: 'createUser',
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    role: input.role,
  });

export const banUser = (userId: string) => invokeAdmin({ action: 'ban', userId });
export const unbanUser = (userId: string) => invokeAdmin({ action: 'unban', userId });
export const setUserPassword = (userId: string, password: string) =>
  invokeAdmin({ action: 'setPassword', userId, password });
export const updateUserEmail = (userId: string, email: string) =>
  invokeAdmin({ action: 'updateEmail', userId, email });
export const updateUserName = (userId: string, displayName: string) =>
  invokeAdmin({ action: 'updateProfile', userId, displayName });
export const setUserRole = (userId: string, role: AppRole) =>
  invokeAdmin({ action: 'setRole', userId, role });
