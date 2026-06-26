/**
 * ProgressCard — "تقدّمك في القسم" card for the section page.
 *
 * Shows:
 *   - Title "تقدّمك في القسم" + current percentage (teal, 700)
 *   - 7px teal gradient ProgressBar (value = progressPct / 100)
 *   - Caption "أكملت {n} من {total} محاضرة"
 *
 * Design ref: screens/صفحة القسم.dc.html › progress div.
 */
import { View } from 'react-native';

import { arNum, arPercent } from '@/lib/format';
import { colors } from '@/constants/theme';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Txt } from '@/components/ui/Txt';

type Props = {
  progressPct: number;
  completed: number;
  total: number;
};

export function ProgressCard({ progressPct, completed, total }: Props) {
  return (
    <Card style={{ marginTop: 14, padding: 14 }}>
      {/* Title row */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 9,
        }}
      >
        <Txt size={12} weight="medium" color={colors.textMuted}>
          تقدّمك في القسم
        </Txt>
        <Txt
          size={13}
          weight="bold"
          color={colors.primaryTeal}
          tabular
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {arPercent(progressPct)}
        </Txt>
      </View>

      {/* 7px teal track */}
      <ProgressBar value={progressPct / 100} height={7} tint="teal" />

      {/* Caption */}
      <Txt size={11} color={colors.textGhost} style={{ marginTop: 8 }}>
        {`أكملت ${arNum(completed)} من ${arNum(total)} محاضرة`}
      </Txt>
    </Card>
  );
}
