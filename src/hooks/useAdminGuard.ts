import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useCurrentUser } from '@/hooks/useAuth';
import type { AppRole } from '@/api/auth';

/**
 * Guard for admin-ONLY screens (dashboard, analytics, users, settings). A ناشر
 * (publisher) reaching one of these — by deep-link or a stale tab — is bounced
 * to /admin/lectures, their landing. RLS already blocks the underlying data;
 * this is the UX layer. Returns the current role for convenience.
 */
export function useAdminOnly(): AppRole | null {
  const { data: user } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    // Publisher → their landing; sheikh → the dashboard (a sheikh may reach the
    // shared staff screens but never these admin-only ones, e.g. via a stale tab).
    if (user?.role === 'publisher') router.replace('/admin/lectures');
    else if (user?.role === 'sheikh') router.replace('/admin');
  }, [user?.role, router]);

  return user?.role ?? null;
}

/**
 * Guard for screens shared by admin + sheikh (لوحة المعلومات · تحليلات التقدم ·
 * الاختبارات · مشاركات الدارسين). A publisher — content staff without student
 * insight — is bounced to /admin/lectures. RLS/RPC gates (is_staff_viewer, 0081)
 * are the real protection; this is the UX layer. Returns the current role.
 */
export function useStaffOnly(): AppRole | null {
  const { data: user } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (user?.role === 'publisher') router.replace('/admin/lectures');
  }, [user?.role, router]);

  return user?.role ?? null;
}
