/**
 * «خريطة رحلتي» — the full journey map (V20 · §6). Every series the student has
 * touched, most-recently-active first. Linked from the compact section on رحلتي
 * العلمية via «عرض الرحلة كاملة».
 *
 * Route: /(student)/journey-map
 */
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useJourneyMap } from '@/hooks/useJourney';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { JourneyGate } from '@/components/journey/JourneyGate';
import { JourneyMap } from '@/components/journey/JourneyMap';

export default function JourneyMapScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: entries, isLoading, refetch } = useJourneyMap({ enabled: !isGuest });
  const miniPad = useMiniPlayerPad();
  const { refreshing, onRefresh } = usePullToRefresh([refetch]);

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded refreshing={refreshing} onRefresh={onRefresh}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
        <Txt size={22} weight="display" color={colors.primaryTeal} style={{ flex: 1 }}>
          خريطة رحلتي
        </Txt>
      </View>

      {isGuest ? (
        <JourneyGate />
      ) : isLoading || !entries ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : entries.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 30 }}>
          <Txt size={14} color={colors.textMuted} align="center">
            لم تبدأ أي سلسلة بعد — ابدأ الاستماع لتظهر رحلتك هنا
          </Txt>
        </Card>
      ) : (
        <JourneyMap entries={entries} />
      )}
    </Screen>
  );
}
