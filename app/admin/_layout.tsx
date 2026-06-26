import { Stack } from 'expo-router';

/**
 * Admin web dashboard stack (upload lectures, manage the section tree, etc.).
 * Same RTL identity as the student app; denser layout. Web-first but renders
 * on any target.
 */
export default function AdminLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
