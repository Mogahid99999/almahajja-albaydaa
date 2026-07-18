import { Stack, usePathname } from 'expo-router';
import { View } from 'react-native';

import { MiniPlayer } from '@/components/MiniPlayer';
import { BottomNavBar } from '@/components/navigation/BottomNavBar';
import { RestoreDownloadsDialog } from '@/components/downloads/RestoreDownloadsDialog';
import { useHydrateDownloads, useRestorePromptTrigger } from '@/hooks/useDownloads';

/**
 * Student app navigation stack (Home → Section → Section → …). The mini player
 * and bottom nav bar are mounted once here so they persist across navigation
 * within the app.
 */
export default function StudentLayout() {
  // Seed the downloads store from disk once, so the downloads page is correct
  // on a cold start (and offline) before any DownloadButton mounts.
  useHydrateDownloads();

  // After a reinstall the audio files survive in the public folder but the
  // id→file manifest is gone — offer to relink them once, right after sign-in,
  // when this account looks like it had downloads (V19).
  const restorePrompt = useRestorePromptTrigger();

  // ملاحظاتي replaces the mini player with its own bar above the editor (the
  // keyboard covers the bottom one) — hide the bottom bar on that screen only.
  const pathname = usePathname();
  const noteScreenOpen = pathname.startsWith('/lecture-note');

  // The bottom nav bar is visible on every screen in the student app so
  // navigation is always reachable — hidden only on the notes editor, where
  // it would sit behind the keyboard-avoiding editor and its own bar.
  const showNavBar = !noteScreenOpen;

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      {noteScreenOpen ? null : <MiniPlayer liftAboveNavBar={showNavBar} />}
      {showNavBar ? <BottomNavBar /> : null}
      <RestoreDownloadsDialog visible={restorePrompt.visible} onClose={restorePrompt.dismiss} />
    </View>
  );
}
