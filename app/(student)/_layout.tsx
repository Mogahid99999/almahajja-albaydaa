import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';

import { MiniPlayer } from '@/components/MiniPlayer';
import { useHydrateDownloads } from '@/hooks/useDownloads';

/**
 * Student app navigation stack (Home → Section → Section → …). The mini player
 * is mounted once here so it persists across navigation within the app.
 */
export default function StudentLayout() {
  // Seed the downloads store from disk once, so the downloads page is correct
  // on a cold start (and offline) before any DownloadButton mounts.
  useHydrateDownloads();

  // ملاحظاتي replaces the mini player with its own bar above the editor (the
  // keyboard covers the bottom one) — hide the bottom bar on that screen only.
  const pathname = usePathname();
  const noteScreenOpen = pathname.startsWith('/lecture-note');

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      {noteScreenOpen ? null : <MiniPlayer />}
    </View>
  );
}
