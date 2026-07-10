import { Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';

import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { useCurrentUser } from '@/hooks/useAuth';
import { useJourneySummary } from '@/hooks/useJourney';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';
import { formatGoalProgress } from './labels';

/**
 * Small Home entry into رحلتي العلمية (Phase 2 · feature C): a quiet streak chip
 * + this-week goal line. Tapping opens the full journey page. No numbers shouted,
 * no comparison — just a calm personal nudge.
 *
 * For guests (Task 3) it becomes a gentle register invitation instead — the
 * journey is the one feature gated behind registration. No progress is fetched.
 */
export function JourneyHomeCard() {
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const isGuest = user?.isGuest ?? true;
  const { data } = useJourneySummary({ enabled: !isGuest });

  const streak = data?.streak.current ?? 0;
  const subtitle = isGuest
    ? 'سجّل لفتح رحلتك العلمية'
    : data?.week
      ? `${formatGoalProgress(data.week.current, data.week.target, data.week.metric)} هذا الأسبوع`
      : 'تابع تقدمك الشخصي';

  return (
    <Pressable
      onPress={() => router.push('/(student)/journey')}
      accessibilityRole="button"
      accessibilityLabel="رحلتي العلمية"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginTop: 12 })}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          {/* Streak chip — a calm lock for guests (nothing to count yet) */}
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              borderWidth: 2,
              borderColor: colors.accentBrass,
              backgroundColor: colors.primaryTeal,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isGuest ? (
              <Feather name="compass" size={20} color={colors.onTealPrimary} />
            ) : (
              <Txt weight="display" size={18} color={colors.onTealPrimary} align="center" centerGlyph>
                {arNum(streak)}
              </Txt>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <Txt weight="display" size={17} color={colors.primaryTeal}>
              رحلتي العلمية
            </Txt>
            <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 2 }}>
              {subtitle}
            </Txt>
          </View>

          <Feather name="chevron-left" size={18} color={colors.textGhost} />
        </View>
      </Card>
    </Pressable>
  );
}
