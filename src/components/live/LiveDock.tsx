/**
 * The room's bottom dock for a LISTENER (PLAN_LIVE_V23 §7.3, prototype `DD.dock`).
 * RTL row: «مغادرة الحلقة» (start/right) · «طلب الكلمة» · «من في الحلقة» (end/left).
 * Offline swaps the middle for the §15 reconnect note.
 */
import Feather from '@expo/vector-icons/Feather';
import { Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, platformShadow, shadows } from '@/constants/theme';
import { HandGlyph } from './LiveAvatar';
import type { LiveConn } from './liveTypes';
import { LIVE_COPY } from './liveUi';

const SIDE = 50;

export function LiveDock({
  conn,
  bottomInset,
  onLeave,
  onPeople,
  onRequest,
}: {
  conn: LiveConn;
  bottomInset: number;
  onLeave: () => void;
  onPeople: () => void;
  /**
   * «طلب الكلمة». Set only for a guest in P3 (→ «سجّل أولاً» sheet: guests
   * listen but never speak — owner, 2026-09-28); unset = disabled until P4.
   */
  onRequest?: () => void;
}) {
  const leave = (
    <SideButton icon="log-out" label={LIVE_COPY.leave} onPress={onLeave} />
  );

  return (
    <View
      style={[
        {
          backgroundColor: colors.surfaceCard,
          borderTopWidth: 1,
          borderColor: colors.borderSand,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          paddingTop: 14,
          paddingHorizontal: 16,
          paddingBottom: bottomInset + 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        },
        platformShadow(colors.primaryTealDeep, { width: 0, height: -12 }, 0.12, 20, 6),
      ]}
    >
      {conn === 'offline' ? (
        <>
          {leave}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Feather name="wifi-off" size={18} color={colors.accentBrassMuted} />
            <Txt size={12.5} color={colors.textSlate} style={{ flex: 1, lineHeight: 20 }}>
              {LIVE_COPY.offline}
            </Txt>
          </View>
        </>
      ) : (
        <>
          {leave}
          {/* TODO(P4): raise hand → `live-control` request / «بانتظار الإذن · إلغاء»;
              approved speakers get the mic toggle here. Listening only in P3. */}
          <Pressable
            onPress={onRequest}
            disabled={!onRequest}
            accessibilityRole="button"
            accessibilityState={{ disabled: !onRequest }}
            accessibilityLabel={LIVE_COPY.request}
            style={({ pressed }) => [
              {
                flex: 1,
                height: 52,
                borderRadius: 16,
                backgroundColor: colors.primaryTeal,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                opacity: !onRequest ? 0.45 : pressed ? 0.85 : 1,
              },
              shadows.button,
            ]}
          >
            <HandGlyph size={19} color={colors.onTealPrimary} strokeWidth={1.9} />
            <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
              {LIVE_COPY.request}
            </Txt>
          </Pressable>
          <SideButton icon="users" label="من في الحلقة" onPress={onPeople} />
        </>
      )}
    </View>
  );
}

function SideButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: SIDE,
        height: SIDE,
        borderRadius: 16,
        backgroundColor: colors.surfaceInset,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Feather name={icon} size={19} color={colors.textSlate} />
    </Pressable>
  );
}
