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
    if (user?.role === 'publisher') router.replace('/admin/lectures');
  }, [user?.role, router]);

  return user?.role ?? null;
}
