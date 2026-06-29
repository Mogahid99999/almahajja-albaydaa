import { Stack } from 'expo-router';
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

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <MiniPlayer />
    </View>
  );
}
