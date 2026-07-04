import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { colors } from '@/constants/theme';
import { arDayCount } from '@/lib/format';
import { useStreakStatus } from '@/hooks/useStreak';
import { Card } from '@/components/ui/Card';
import { Txt } from '@/components/ui/Txt';

/**
 * Journey-page streak detail (26.1) — sits under the weekly-goal card: the
 * current streak, a واصلت اليوم / لم تواصل بعد line, and (only when the 3-day
 * window is open) a quiet recovery note. Personal, never compared.
 */
export function StreakDetailCard() {
  const { data: status } = useStreakStatus();
  if (!status) return null;

  const { current, todayCounted, recoveryAvailable, recoveryDaysLeft } = status;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Feather
          name={todayCounted ? 'check-circle' : 'circle'}
          size={17}
          color={todayCounted ? colors.primaryTeal : colors.textGhost}
        />
        <View style={{ flex: 1 }}>
          <Txt size={14} weight="medium" color={colors.textInk}>
            {current > 0 ? `مداومتك: ${arDayCount(current)}` : 'لا مداومة بعد'}
          </Txt>
          <Txt
            size={12}
            color={todayCounted ? colors.primaryTeal : colors.textMuted}
            style={{ marginTop: 2 }}
          >
            {todayCounted ? 'واصلت اليوم ✓' : 'لم تواصل بعد'}
          </Txt>
        </View>
      </View>

      {recoveryAvailable ? (
        <Txt size={12} color={colors.accentBrassMuted} style={{ marginTop: 10 }}>
          {`يمكنك استعادة مداومتك خلال ${arDayCount(recoveryDaysLeft)} — درسان أو أربع دقائق استماع اليوم`}
        </Txt>
      ) : null}
    </Card>
  );
}
