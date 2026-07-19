/**
 * الأوسمة — the full tiered badge page (V20 · §9).
 *
 * Tabs (الكل · التعلّم · المداومة · الإتقان · التدوين · الرفقة), a "N of M earned"
 * summary, the nearest locked badge, then the seal grid for the active tab. Locked
 * seals show their condition + remaining. Strictly personal, calm — no comparison.
 *
 * Route: /(student)/badges  (linked from the الأوسمة section on رحلتي العلمية).
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { BadgeCategory } from '@/api/types';
import { BADGE_TABS, nearestBadge } from '@/constants/badges';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import { useBadges } from '@/hooks/useJourney';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';

import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { BadgeSeal } from '@/components/journey/BadgeSeal';
import { JourneyGate } from '@/components/journey/JourneyGate';

type Tab = BadgeCategory | 'all';

export default function BadgesScreen() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data: badges, isLoading, refetch } = useBadges({ enabled: !isGuest });
  const miniPad = useMiniPlayerPad();
  const { refreshing, onRefresh } = usePullToRefresh([refetch]);

  const [tab, setTab] = useState<Tab>('all');

  const earnedCount = badges?.filter((b) => b.earned).length ?? 0;
  const total = badges?.length ?? 0;
  const nearest = useMemo(() => (badges ? nearestBadge(badges) : null), [badges]);

  const shown = useMemo(
    () => (badges ?? []).filter((b) => tab === 'all' || b.category === tab),
    [badges, tab],
  );

  return (
    <Screen
      bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}
      padded
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* Nav row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          الأوسمة
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      {isGuest ? (
        <JourneyGate />
      ) : isLoading || !badges ? (
        <View style={{ paddingVertical: 80, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primaryTeal} />
        </View>
      ) : (
        <>
          {/* Summary + nearest badge */}
          <Card style={{ gap: 8, marginBottom: 14 }}>
            <Txt size={14} weight="semibold" color={colors.textInk} tabular>
              {`حصلت على ${arNum(earnedCount)} من ${arNum(total)} وساماً`}
            </Txt>
            {nearest ? (
              <Txt size={12.5} color={colors.textMuted} tabular>
                {`أقرب وسام: ${nearest.titleAr} — بقي ${arNum(
                  Math.max(0, nearest.threshold - nearest.progress),
                )}`}
              </Txt>
            ) : null}
          </Card>

          {/* Tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 16 }}
            contentContainerStyle={{ gap: 8, flexDirection: 'row' }}
          >
            {BADGE_TABS.map((t) => {
              const active = tab === t.category;
              return (
                <Pressable
                  key={t.category}
                  onPress={() => setTab(t.category as Tab)}
                  accessibilityRole="button"
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 16,
                    borderRadius: radius.pill,
                    backgroundColor: active ? colors.primaryTeal : colors.bgSandRaised,
                    borderWidth: 1,
                    borderColor: active ? colors.primaryTeal : colors.borderSand,
                  }}
                >
                  <Txt
                    size={13}
                    weight={active ? 'semibold' : 'medium'}
                    color={active ? colors.onTealPrimary : colors.textMuted}
                  >
                    {t.label}
                  </Txt>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Seal grid */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {shown.map((b) => (
              <BadgeSeal key={b.key} badge={b} />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
