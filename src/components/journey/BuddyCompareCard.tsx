import { View } from 'react-native';

import type { BuddyStatus, WeekProgress } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import { useMyBuddies } from '@/hooks/useBuddy';
import { useStreakStatus } from '@/hooks/useStreak';
import { Card } from '@/components/ui/Card';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { Txt } from '@/components/ui/Txt';

/**
 * Journey buddy comparison (26.2) — side-by-side weekly progress bars with an
 * encouraging phrase, one card PER accepted buddy (up to 3). Deliberately NO
 * numeric ranking (CLAUDE.md calm tone): each bar is progress toward that
 * person's OWN goal, and the phrase never shames. Renders nothing when there
 * is no accepted buddy.
 */
export function BuddyCompareCard({ week }: { week: WeekProgress }) {
  const { data: user } = useCurrentUser();
  const { data: buddies } = useMyBuddies();
  const { data: streak } = useStreakStatus();

  if (!buddies || buddies.length === 0) return null;

  // Buddy matching is same-gender (0015), so a female user's buddy is female.
  const fem = user?.gender === 'female';
  const myPct =
    week.target > 0 ? Math.min(100, Math.round((week.current / week.target) * 100)) : 0;
  const myMet = week.current >= week.target && week.target > 0;
  const myStreak = streak?.current ?? 0;

  return (
    <View>
      <SectionTitle title={fem ? 'أنتِ ورفيقاتك' : 'أنت ورفقاؤك'} />
      {buddies.map((buddy) => (
        <View key={buddy.buddyId} style={{ marginBottom: 12 }}>
          <BuddyBars buddy={buddy} myPct={myPct} myMet={myMet} myStreak={myStreak} fem={fem} />
        </View>
      ))}
    </View>
  );
}

function BuddyBars({
  buddy,
  myPct,
  myMet,
  myStreak,
  fem,
}: {
  buddy: BuddyStatus;
  myPct: number;
  myMet: boolean;
  myStreak: number;
  fem: boolean;
}) {
  // Buddy pairing is same-gender (0015), so `g` genders BOTH sides of every
  // phrase — the buddy's mention and the imperative addressed to the user.
  const g = (masc: string, femPhrase: string) => (fem ? femPhrase : masc);
  const phrase =
    myMet && buddy.weeklyGoalMet
      ? g('كلاكما أكمل هدفه الأسبوعي، بارك الله فيكما',
          'كلتاكما أكملت هدفها الأسبوعي، بارك الله فيكما')
      : buddy.weeklyGoalMet
        ? g('رفيقك أكمل هدفه الأسبوعي، فاستعن بالله وواصل',
            'رفيقتك أكملت هدفها الأسبوعي، فاستعيني بالله وواصلي')
        : myMet
          ? g('أتممت هدفك الأسبوعي، فاثبت وواصل',
              'أتممتِ هدفك الأسبوعي، فاثبتي وواصلي')
          : buddy.currentStreak > myStreak
            ? g('رفيقك متقدم بخطوة، فامضِ أنت أيضًا',
                'رفيقتك متقدمة بخطوة، فامضي أنتِ أيضًا')
            : myStreak > buddy.currentStreak
              ? g('أنت متقدم بخطوة هذا الأسبوع، فاثبت وواصل',
                  'أنتِ متقدمة بخطوة هذا الأسبوع، فاثبتي وواصلي')
              : g('كلاكما مستمر، نسأل الله لكما الثبات',
                  'كلتاكما مستمرة، نسأل الله لكما الثبات');

  return (
    <Card>
      <ProgressRow label="أنت" pct={myPct} />
      <View style={{ height: 12 }} />
      <ProgressRow label={buddy.displayName} pct={buddy.weekProgressPct} />

      <Txt size={12.5} color={colors.accentBrassMuted} align="center" style={{ marginTop: 14 }}>
        {phrase}
      </Txt>
    </Card>
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
