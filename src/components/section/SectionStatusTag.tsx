/**
 * «مستمر» / «منتهي» — the section's series status (0164), set by the admin in
 * the section editor. Renders nothing when the admin left it unset, so the
 * badge only appears where someone actually said whether the lessons go on.
 *
 * Calm, not a call to action: a soft teal tint for «مستمر», a sand tint with a
 * check for «منتهي». Used on the section page meta row and on section cards.
 */
import Feather from '@expo/vector-icons/Feather';
import { View } from 'react-native';

import type { SectionSeriesStatus } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { Txt } from '@/components/ui/Txt';

export const SERIES_STATUS_LABEL: Record<SectionSeriesStatus, string> = {
  ongoing: 'مستمر',
  completed: 'منتهي',
};

export function SectionStatusTag({
  status,
  size = 'md',
}: {
  status: SectionSeriesStatus | null | undefined;
  /** 'sm' on the 2-column cards, 'md' on the section page. */
  size?: 'sm' | 'md';
}) {
  if (!status) return null;
  const done = status === 'completed';
  const sm = size === 'sm';
  return (
    <View
      accessibilityLabel={`حالة القسم: ${SERIES_STATUS_LABEL[status]}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: done ? colors.surfaceInset : 'rgba(31, 74, 66, 0.09)',
        borderRadius: radius.pill,
        paddingHorizontal: sm ? 7 : 10,
        paddingVertical: sm ? 2 : 5,
      }}
    >
      {done ? (
        <Feather name="check" size={sm ? 10 : 12} color={colors.textSlate} />
      ) : (
        <View
          style={{
            width: sm ? 5 : 6,
            height: sm ? 5 : 6,
            borderRadius: 3,
            backgroundColor: colors.primaryTeal600,
          }}
        />
      )}
      <Txt
        size={sm ? 10.5 : 12}
        weight="semibold"
        color={done ? colors.textSlate : colors.primaryTeal}
      >
        {SERIES_STATUS_LABEL[status]}
      </Txt>
    </View>
  );
}
