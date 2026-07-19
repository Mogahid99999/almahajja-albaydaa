import { Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import type { WeekProgress } from '@/api/types';
import { colors } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Txt } from '@/components/ui/Txt';
import {
  formatDailyNeeded,
  formatDaysLeft,
  formatGoalProgress,
  weekGoalStats,
} from './labels';

/**
 * Weekly goal card (Phase 2 · feature C; upgraded V20 · §5): this week's progress
 * toward the goal the student set, now with the percentage, days left in the
 * Sat→Fri week, the required daily rate, and an over-target line (progress does
 * NOT stop at 100%). Calm tone — reaching the goal shows a gentle thanks, never a
 * celebration burst (the unified celebration modal owns any celebration).
 */
export function GoalCard({ week, onEdit }: { week: WeekProgress; onEdit: () => void }) {
  const s = weekGoalStats(week.current, week.target);
  // Bar fills to 100% max even when over-target; the over line carries the >100%.
  const barRatio = Math.min(1, s.ratio);

  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Txt weight="semibold" size={15} color={colors.textInk}>
          هدف الأسبوع
        </Txt>
        <Pressable
          onPress={onEdit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="تعديل هدف الأسبوع"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="edit-2" size={13} color={colors.accentBrassMuted} />
          <Txt size={12.5} weight="medium" color={colors.accentBrassMuted}>
            تعديل
          </Txt>
        </Pressable>
      </View>

      {/* Progress + percentage row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
        }}
      >
        <Txt size={13} color={colors.textMuted}>
          {`${formatGoalProgress(week.current, week.target, week.metric)} هذا الأسبوع`}
        </Txt>
        <Txt size={13} weight="semibold" color={colors.primaryTeal600} tabular>
          {`${arNum(s.percent)}%`}
        </Txt>
      </View>

      <ProgressBar value={barRatio} style={{ marginTop: 12 }} />

      {s.reached ? (
        // Reached (incl. over-target): gentle thanks + the over-target figure.
        <View style={{ marginTop: 10, gap: 4 }}>
          <Txt size={12.5} color={colors.stateSuccess}>
            أتممت هدف هذا الأسبوع — جزاك الله خيراً
          </Txt>
          {s.overTarget ? (
            <Txt size={12} color={colors.textMuted} tabular>
              {`${formatGoalProgress(week.current, week.target, week.metric)} — ${arNum(
                s.percent,
              )}%`}
            </Txt>
          ) : null}
        </View>
      ) : (
        // In progress: days left + required daily rate.
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 10,
          }}
        >
          <Txt size={12} color={colors.textMuted}>
            {formatDaysLeft(s.daysLeft)}
          </Txt>
          <Txt size={12} color={colors.accentBrassMuted}>
            {formatDailyNeeded(s.dailyNeeded, week.metric)}
          </Txt>
        </View>
      )}
    </Card>
  );
}
