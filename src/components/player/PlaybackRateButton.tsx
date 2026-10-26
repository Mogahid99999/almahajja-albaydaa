/**
 * Playback-speed pill — the familiar podcast-app control: a speedometer icon +
 * the current speed («١٫٠×»). Each tap steps to the next preset (1 → 1.2 →
 * 1.5 → 1.8 → 2 → 0.8 → 1 …); a long press goes straight back to ×1.
 * Replaced the inline slider (owner 2026-10-26: a bare slider didn't read as
 * "speed" to listeners).
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet } from 'react-native';

import { Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { formatRate } from './rateFormat';

/** Cycle order, starting from normal speed. */
export const RATE_PRESETS = [1.0, 1.2, 1.5, 1.8, 2.0, 0.8] as const;

/** The preset after `rate`; a non-preset rate (old slider value) jumps to the next faster preset. */
export function nextRate(rate: number): number {
  const i = RATE_PRESETS.findIndex((r) => Math.abs(r - rate) < 0.01);
  if (i >= 0) return RATE_PRESETS[(i + 1) % RATE_PRESETS.length];
  const faster = [...RATE_PRESETS].sort((a, b) => a - b).find((r) => r > rate);
  return faster ?? 0.8;
}

type Props = {
  rate: number;
  onChange: (rate: number) => void;
};

export function PlaybackRateButton({ rate, onChange }: Props) {
  const normal = Math.abs(rate - 1) < 0.01;
  const fg = normal ? colors.onTealPrimary : colors.primaryTealDeep;
  return (
    <Pressable
      onPress={() => onChange(nextRate(rate))}
      onLongPress={() => onChange(1.0)}
      accessibilityRole="button"
      accessibilityLabel={`سرعة التشغيل ${formatRate(rate)}`}
      accessibilityHint="اضغط لتغيير السرعة، واضغط مطولاً للعودة إلى السرعة العادية"
      hitSlop={8}
      style={({ pressed }) => [styles.pill, !normal && styles.pillActive, pressed && { opacity: 0.7 }]}
    >
      <MaterialCommunityIcons name="speedometer" size={18} color={fg} />
      <Txt size={13} weight="semibold" color={fg}>
        السرعة
      </Txt>
      <Txt size={14} weight="bold" color={fg} tabular>
        {formatRate(rate)}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(246,240,226,0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  // Not normal speed: brass, so a changed speed is noticeable at a glance.
  pillActive: {
    backgroundColor: colors.accentBrass,
    borderColor: colors.accentBrass,
  },
});
