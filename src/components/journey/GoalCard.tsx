import { Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import type { WeekProgress } from '@/api/types';
import { colors } from '@/constants/theme';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Txt } from '@/components/ui/Txt';
import { formatGoalProgress } from './labels';

/**
 * Weekly goal card (Phase 2 · feature C): this week's progress toward the goal
 * the student set, with a quiet "edit" affordance. Calm tone — reaching the goal
 * shows a gentle thanks, never a celebration burst.
 */
export function GoalCard({ week, onEdit }: { week: WeekProgress; onEdit: () => void }) {
  const ratio = week.target > 0 ? Math.min(1, week.current / week.target) : 0;
  const reached = week.target > 0 && week.current >= week.target;

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

      <Txt size={13} color={colors.textMuted} style={{ marginTop: 8 }}>
        {`${formatGoalProgress(week.current, week.target, week.metric)} هذا الأسبوع`}
      </Txt>

      <ProgressBar value={ratio} style={{ marginTop: 12 }} />

      {reached ? (
        <Txt size={12} color={colors.stateSuccess} style={{ marginTop: 10 }}>
          أتممت هدف هذا الأسبوع — جزاك الله خيراً
        </Txt>
      ) : null}
    </Card>
  );
}
