import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';

import { MiniPlayer } from '@/components/MiniPlayer';
import { BottomNavBar, isTabRootPath } from '@/components/navigation/BottomNavBar';
import { useHydrateDownloads } from '@/hooks/useDownloads';

/**
 * Student app navigation stack (Home → Section → Section → …). The mini player
 * and bottom nav bar are mounted once here so they persist across navigation
 * within the app.
 */
export default function StudentLayout() {
  // Seed the downloads store from disk once, so the downloads page is correct
  // on a cold start (and offline) before any DownloadButton mounts.
  useHydrateDownloads();

  // ملاحظاتي replaces the mini player with its own bar above the editor (the
  // keyboard covers the bottom one) — hide the bottom bar on that screen only.
  const pathname = usePathname();
  const noteScreenOpen = pathname.startsWith('/lecture-note');

  // The bottom nav bar only shows on the 5 top-level tab screens — hidden on
  // every pushed detail screen (section pages, quizzes, player, etc.).
  const showNavBar = isTabRootPath(pathname) && !noteScreenOpen;

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      {noteScreenOpen ? null : <MiniPlayer liftAboveNavBar={showNavBar} />}
      {showNavBar ? <BottomNavBar /> : null}
    </View>
  );
}
