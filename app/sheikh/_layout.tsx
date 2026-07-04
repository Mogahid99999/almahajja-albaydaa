import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';

/** Sheikh group — the questions inbox. AuthGate steers sheikh-role users here. */
export default function SheikhLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgSand },
      }}
    />
  );
}
