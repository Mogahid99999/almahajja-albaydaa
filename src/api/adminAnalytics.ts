/**
 * تحليلات التقدم العلمي (Feature 3). One SECURITY DEFINER RPC
 * (admin_progress_analytics, migration 0024): aggregate completion counts,
 * per-section averages, and two admin-PRIVATE student lists (good progress /
 * started-then-stopped). Never surfaced student-vs-student in the app.
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import type { AdminProgressAnalytics, AdminStudentBrief } from './types';

const EMPTY: AdminProgressAnalytics = {
  completedFirst: 0,
  completed5: 0,
  completed10: 0,
  completedSection: 0,
  sections: [],
  goodProgress: [],
  startedStopped: [],
};

function mapBrief(row: any, countKey: string): AdminStudentBrief {
  return {
    userId: row.user_id,
    displayName: row.display_name ?? null,
    count: row[countKey] ?? 0,
    lastOpenedAt: row.last_opened_at ?? null,
  };
}

export async function getAdminProgressAnalytics(): Promise<AdminProgressAnalytics> {
  if (USE_MOCK) return EMPTY;
  const { data, error } = await supabase.rpc('admin_progress_analytics');
  if (error) throw error;
  const d = (data ?? {}) as Record<string, any>;
  return {
    completedFirst: d.completed_first ?? 0,
    completed5: d.completed_5 ?? 0,
    completed10: d.completed_10 ?? 0,
    completedSection: d.completed_section ?? 0,
    sections: (d.sections ?? []).map((s: any) => ({
      title: s.title,
      totalLectures: s.total_lectures ?? 0,
      studentsStarted: s.students_started ?? 0,
      avgCompletion: Number(s.avg_completion ?? 0),
    })),
    goodProgress: (d.good_progress ?? []).map((r: any) => mapBrief(r, 'completed')),
    startedStopped: (d.started_stopped ?? []).map((r: any) => mapBrief(r, 'in_progress')),
  };
}
