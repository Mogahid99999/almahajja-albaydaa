import { Stack } from 'expo-router';
import { View } from 'react-native';

import { MiniPlayer } from '@/components/MiniPlayer';

/**
 * Student app navigation stack (Home → Section → Section → …). The mini player
 * is mounted once here so it persists across navigation within the app.
 */
export default function StudentLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <MiniPlayer />
    </View>
  );
}
