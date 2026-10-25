/**
 * Admin dashboard overview (Feature 2). One SECURITY DEFINER RPC
 * (admin_dashboard_stats, migration 0024) returns every tile + the two short
 * "top" lists in a single round-trip. Admin-only (the RPC raises otherwise).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type { AdminDashboardStats } from './types';

const EMPTY: AdminDashboardStats = {
  totalUsers: 0,
  registeredUsers: 0,
  newUsersMonth: 0,
  newUsersWeek: 0,
  activeToday: 0,
  sectionsCount: 0,
  lecturesPublished: 0,
  publishedQuizzes: 0,
  listenHoursTotal: 0,
  listenHoursMonth: 0,
  topSections: [],
  topQuizzes: [],
};

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  if (USE_MOCK) return EMPTY;
  const { data, error } = await supabase.rpc('admin_dashboard_stats');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, any>;
  return {
    totalUsers: d.total_users ?? 0,
    registeredUsers: d.registered_users ?? 0,
    newUsersMonth: d.new_users_month ?? 0,
    newUsersWeek: d.new_users_week ?? 0,
    activeToday: d.active_today ?? 0,
    sectionsCount: d.sections_count ?? 0,
    lecturesPublished: d.lectures_published ?? 0,
    publishedQuizzes: d.published_quizzes ?? 0,
    listenHoursTotal: Number(d.listen_hours_total ?? 0),
    listenHoursMonth: Number(d.listen_hours_month ?? 0),
    topSections: (d.top_sections ?? []).map((s: any) => ({
      title: s.title,
      hours: Number(s.hours ?? 0),
    })),
    topQuizzes: (d.top_quizzes ?? []).map((q: any) => ({
      title: q.title,
      attempts: q.attempts ?? 0,
    })),
  };
}

/** «استخدام المصحف» — unique users (guests included) who opened the mushaf (0161). */
export type MushafUsageStats = { today: number; d7: number; d30: number; total: number };

export async function getMushafUsageStats(): Promise<MushafUsageStats> {
  if (USE_MOCK) return { today: 0, d7: 0, d30: 0, total: 0 };
  // `as never`: not in database.generated.ts until 0161 is applied + types regenerated.
  const { data, error } = await supabase.rpc('admin_mushaf_usage_stats' as never);
  if (error) throw error;
  const r = (data ?? {}) as Partial<MushafUsageStats>;
  return { today: r.today ?? 0, d7: r.d7 ?? 0, d30: r.d30 ?? 0, total: r.total ?? 0 };
}
