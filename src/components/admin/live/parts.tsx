/**
 * Small shared pieces of the staff live screens: the state pill, the action
 * buttons (same look as the admin screens' teal / outline buttons) and the
 * group heading.
 */
import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';

import { ProgressBar, Rhombus, Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { arNum } from '@/lib/format';
import { PILL_COLORS, type PillTone } from './liveAdminUi';

export function StatePill({ tone, label }: { tone: PillTone; label: string }) {
  const c = PILL_COLORS[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        backgroundColor: c.bg,
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      {tone === 'live' ? (
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.fg }} />
      ) : null}
      <Txt size={11.5} weight="semibold" color={c.fg} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/** «من بث مباشر» — the live-source chip of «الواردة». */
export function LiveSourceChip({ label }: { label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(44,97,87,0.08)',
        borderRadius: radius.pill,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <Feather name="radio" size={12} color={colors.primaryTeal600} />
      <Txt size={11.5} weight="semibold" color={colors.primaryTeal600}>
        {label}
      </Txt>
    </View>
  );
}

export function JobProgress({ value }: { value: number }) {
  return <ProgressBar value={value} height={6} tint="teal" style={{ marginTop: 10 }} />;
}

type Tone = 'primary' | 'outline' | 'ghost' | 'danger';

export function ActionButton({
  label,
  icon,
  tone = 'outline',
  onPress,
  disabled = false,
  busy = false,
  compact = false,
  accessibilityLabel,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  tone?: Tone;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  accessibilityLabel?: string;
}) {
  const off = disabled || busy;
  const fg =
    tone === 'primary'
      ? colors.onTealPrimary
      : tone === 'danger'
        ? colors.stateDanger
        : tone === 'ghost'
          ? colors.primaryTeal600
          : colors.primaryTeal;
  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: compact ? 36 : 44,
    paddingHorizontal: tone === 'ghost' ? 6 : compact ? 12 : 18,
    borderRadius: radius.sm,
  };
  const look: ViewStyle =
    tone === 'primary'
      ? { backgroundColor: colors.primaryTeal, ...shadows.button }
      : tone === 'ghost'
        ? {}
        : {
            backgroundColor: colors.surfaceWhite,
            borderWidth: 1.5,
            borderColor: tone === 'danger' ? 'rgba(184,92,74,0.35)' : colors.borderSand2,
          };
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy }}
      style={({ pressed }) => [base, look, { opacity: off ? 0.5 : pressed ? 0.75 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Feather name={icon} size={compact ? 14 : 15} color={fg} />
      ) : null}
      <Txt size={compact ? 12.5 : 13} weight="semibold" color={fg}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function GroupHeading({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 26, marginBottom: 12 }}>
      <Rhombus size={8} color={colors.accentBrass} />
      <Txt weight="semibold" size={15} color={colors.textInk} style={{ flexShrink: 1 }}>
        {title}
      </Txt>
      {count !== undefined && count > 0 ? (
        <Txt size={12} color={colors.textGhost} tabular>
          ({arNum(count)})
        </Txt>
      ) : null}
      <View style={{ flex: 1 }} />
      {children}
    </View>
  );
}

export function EmptyLine({ text }: { text: string }) {
  return (
    <View
      style={{
        paddingVertical: 18,
        paddingHorizontal: 16,
        borderRadius: radius.card,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.borderSand2,
      }}
    >
      <Txt size={13} color={colors.textGhost} align="center">
        {text}
      </Txt>
    </View>
  );
}

/** Inline error / notice line under a card's actions. */
export function InlineNote({ text, tone = 'danger' }: { text: string | null; tone?: 'danger' | 'ok' | 'muted' }) {
  if (!text) return null;
  const color = tone === 'danger' ? colors.stateDanger : tone === 'ok' ? colors.stateSuccess : colors.textMuted;
  return (
    <Txt size={12.5} color={color} style={{ marginTop: 10, lineHeight: 20 }} accessibilityLiveRegion="polite">
      {text}
    </Txt>
  );
}
