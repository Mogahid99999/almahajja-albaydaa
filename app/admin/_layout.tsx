import { Stack } from 'expo-router';

import { useCurrentUser } from '@/hooks/useAuth';

/**
 * Admin web dashboard stack (upload lectures, manage the section tree, etc.).
 * Same RTL identity as the student app; denser layout. Web-first but renders
 * on any target.
 */
export default function AdminLayout() {
  const { data: user } = useCurrentUser();

  // Hold the shell until the role is known. A student/guest deep-linking to an
  // /admin/... URL is redirected by the root AuthGate one render later — render
  // nothing in the meantime so the admin UI never flashes. (Data was always
  // protected by RLS; this is the cosmetic layer.)
  const isStaff =
    !user?.isGuest && (user?.role === 'admin' || user?.role === 'publisher');
  if (!isStaff) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}
