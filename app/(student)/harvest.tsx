/**
 * «حصاد الرحلة» — the full harvest page (V20 · §8). All the fruit of the journey
 * with a range filter (هذا الأسبوع · هذا الشهر · منذ البداية). Linked from the
 * compact harvest card on رحلتي العلمية via «عرض الحصاد كاملًا».
 *
 * Route: /(student)/harvest
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { HarvestRange } from '@/api/harvest';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import { useHarvest } from '@/hooks/useHarvest';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { JourneyGate } from '@/components/journey/JourneyGate';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';

const RANGES: { range: HarvestRange; label: string }[] = [
  { range: 'week', label: 'هذا الأسبوع' },
  { range: 'month', label: 'هذا الشهر' },
  { range: 'all', label: 'منذ البداية' },
];

export default function HarvestScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const [range, setRange] = useState<HarvestRange>('all');
  const { data: h, isLoading } = useHarvest(range, { enabled: !isGuest });
  const miniPad = useMiniPlayerPad();

  return (
    <Screen bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE} padded>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          حصاد الرحلة
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      {isGuest ? (
        <JourneyGate />
      ) : (
        <>
          {/* Range picker */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {RANGES.map((r) => {
              const active = range === r.range;
              return (
                <Pressable
                  key={r.range}
                  onPress={() => setRange(r.range)}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    borderRadius: radius.pill,
                    alignItems: 'center',
                    backgroundColor: active ? colors.primaryTeal : colors.bgSandRaised,
                    borderWidth: 1,
                    borderColor: active ? colors.primaryTeal : colors.borderSand,
                  }}
                >
                  <Txt
                    size={12.5}
                    weight={active ? 'semibold' : 'medium'}
                    color={active ? colors.onTealPrimary : colors.textMuted}
                  >
                    {r.label}
                  </Txt>
                </Pressable>
              );
            })}
          </View>

          {isLoading || !h ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primaryTeal} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <HarvestTile value={arNum(h.completedLessons)} label="دروس مكتملة" />
              <HarvestTile value={arNum(Math.round(h.totalSeconds / 3600))} label="ساعات استماع" />
              <HarvestTile value={arNum(h.activeDays)} label="أيام النشاط" />
              <HarvestTile value={arNum(h.quizzesPassed)} label="اختبارات مجتازة" />
              <HarvestTile value={arNum(h.benefitsWritten)} label="فوائد مكتوبة" />
              {range === 'all' ? (
                <HarvestTile value={arNum(h.completedSeries)} label="سلاسل مكتملة" />
              ) : null}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function HarvestTile({ value, label }: { value: string; label: string }) {
  return (
    <Card style={{ width: '47%', alignItems: 'center', paddingVertical: 20 }}>
      <Txt weight="display" size={26} color={colors.primaryTeal} tabular align="center">
        {value}
      </Txt>
      <Txt size={12} color={colors.textMuted} align="center" style={{ marginTop: 4 }}>
        {label}
      </Txt>
    </Card>
  );
}
