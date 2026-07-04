import { View } from 'react-native';

import type { WeekProgress } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useBuddy } from '@/hooks/useBuddy';
import { useStreakStatus } from '@/hooks/useStreak';
import { Card } from '@/components/ui/Card';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';

/**
 * Journey buddy comparison (26.2) — side-by-side weekly progress bars with an
 * encouraging phrase. Deliberately NO numeric ranking (CLAUDE.md calm tone):
 * each bar is progress toward that person's OWN goal, and the phrase never
 * shames. Renders nothing when there is no accepted buddy.
 */
export function BuddyCompareCard({ week }: { week: WeekProgress }) {
  const { data: user } = useCurrentUser();
  const { data: buddy } = useBuddy();
  const { data: streak } = useStreakStatus();

  if (!buddy) return null;

  // Buddy matching is same-gender (0015), so a female user's buddy is female.
  const fem = user?.gender === 'female';
  const myPct =
    week.target > 0 ? Math.min(100, Math.round((week.current / week.target) * 100)) : 0;
  const myMet = week.current >= week.target && week.target > 0;
  const myStreak = streak?.current ?? 0;

  const phrase =
    myMet && buddy.weeklyGoalMet
      ? 'كلاكما أكمل هدفه الأسبوعي، بارك الله فيكما'
      : buddy.weeklyGoalMet
        ? fem
          ? 'رفيقتك أكملت هدفها الأسبوعي، فاستعن بالله وواصل'
          : 'رفيقك أكمل هدفه الأسبوعي، فاستعن بالله وواصل'
        : myMet
          ? 'أتممت هدفك الأسبوعي، فاثبت وواصل'
          : buddy.currentStreak > myStreak
            ? fem
              ? 'رفيقتك متقدمة بخطوة، فامضي أنت أيضًا'
              : 'رفيقك متقدم بخطوة، فامضِ أنت أيضًا'
            : myStreak > buddy.currentStreak
              ? 'أنت متقدم بخطوة هذا الأسبوع، فاثبت وواصل'
              : 'كلاكما مستمر، نسأل الله لكما الثبات';

  return (
    <View>
      <SectionTitle title={fem ? 'أنت ورفيقتك' : 'أنت ورفيقك'} />
      <Card>
        <ProgressRow label="أنت" pct={myPct} />
        <View style={{ height: 12 }} />
        <ProgressRow label={buddy.displayName} pct={buddy.weekProgressPct} />

        <Txt size={12.5} color={colors.accentBrassMuted} align="center" style={{ marginTop: 14 }}>
          {phrase}
        </Txt>
      </Card>
    </View>
  );
}

function ProgressRow({ label, pct }: { label: string; pct: number }) {
  return (
    <View>
      <Txt size={12.5} weight="medium" color={colors.textSlate} style={{ marginBottom: 6 }}>
        {label}
      </Txt>
      <View
        style={{
          height: 8,
          borderRadius: radius.pill,
          backgroundColor: 'rgba(31,74,66,0.09)',
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            height: '100%',
            borderRadius: radius.pill,
            backgroundColor: colors.primaryTeal,
          }}
        />
      </View>
    </View>
  );
}
