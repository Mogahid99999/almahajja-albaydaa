import { View } from 'react-native';

import type { Badge, BadgeMetric } from '@/api/types';
import { colors, radius } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { Rhombus } from '@/components/ui/Rhombus';
import { Txt } from '@/components/ui/Txt';

/** Tier → seal fill colour (bronze → silver → gold → diamond → exceptional). */
const tierColor: Record<string, string> = {
  bronze: colors.accentBrassMuted,
  silver: colors.borderSand2,
  gold: colors.accentBrass,
  diamond: colors.primaryTeal600,
  exceptional: colors.primaryTeal,
};

/** Unit noun for a locked badge's remaining hint. */
function unitNoun(metric: BadgeMetric): string {
  switch (metric) {
    case 'hours':
      return 'ساعة';
    case 'streak':
    case 'active_days':
    case 'benefit_days':
      return 'يوماً';
    case 'series':
      return 'سلسلة';
    case 'quizzes':
      return 'اختباراً';
    case 'benefits':
      return 'فائدة';
    default:
      return 'درساً';
  }
}

/**
 * A tiered badge seal (V20 · §9). Earned = a quiet seal filled in its tier colour;
 * locked = a muted sand outline showing the condition + how much remains (never
 * nagging — calm tone, CLAUDE.md). Boolean badges (threshold 1, e.g. الإتقان) show
 * the plain condition text with no "remaining" count.
 */
export function BadgeSeal({ badge }: { badge: Badge }) {
  const earned = badge.earned;
  const seal = badge.tier ? tierColor[badge.tier] : colors.accentBrass;
  const isBoolean = badge.threshold <= 1;
  const remaining = Math.max(0, badge.threshold - badge.progress);

  const hint = earned
    ? badge.descAr
    : isBoolean
      ? badge.descAr
      : `بقي ${arNum(remaining)} ${unitNoun(badge.metric)}`;

  return (
    <View
      style={{
        width: '48%',
        alignItems: 'center',
        gap: 9,
        paddingVertical: 16,
        paddingHorizontal: 10,
        borderRadius: radius.card,
        backgroundColor: earned ? colors.surfaceCard : colors.bgSandRaised,
        borderWidth: 1,
        borderColor: earned ? colors.accentBrassSoft : colors.borderSand,
      }}
    >
      {/* Seal emblem */}
      <View
        style={{
          width: 58,
          height: 58,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: earned ? seal : colors.surfaceInset,
          borderWidth: earned ? 0 : 1,
          borderColor: colors.borderSand2,
        }}
      >
        <Rhombus size={26} color={earned ? colors.surfaceCard : colors.textGhost} filled={false} />
        <Rhombus
          size={11}
          color={earned ? colors.surfaceCard : colors.textGhost}
          filled={earned}
          style={{ position: 'absolute' }}
        />
      </View>

      <Txt
        weight="semibold"
        size={13}
        align="center"
        numberOfLines={2}
        color={earned ? colors.textInk : colors.textFaint}
      >
        {badge.titleAr}
      </Txt>
      <Txt size={11} align="center" color={colors.textMuted} numberOfLines={2}>
        {hint}
      </Txt>
    </View>
  );
}
