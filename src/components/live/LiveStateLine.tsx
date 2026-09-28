/**
 * The room's state lines (PLAN_LIVE_V23 §7.5, copy exactly per §15), placed as
 * in the approved prototype:
 *  - `LiveStateLine`    under the title: «يتحدث الآن: …» / «تتحدث الآن: …» /
 *                       «أنت تتحدث الآن» / «لا أحد يتحدث الآن», or the poor-link warning
 *  - `LiveStageMessage` over the board: «جارٍ الدخول إلى الحلقة…», «جارٍ إعادة الاتصال…»,
 *                       offline, and the «تعذّر الدخول إلى الحلقة» card with a retry
 *  - `LiveHoldNote`     the host-drop note between the title and the board
 */
import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { VoiceBars } from './LiveAvatar';
import type { LiveConn } from './liveTypes';
import { LIVE_COPY, nowSpeakingLine, type Sex } from './liveUi';

export type NowSpeaker = { name: string; gender: Sex; isMe: boolean } | null;

export function LiveStateLine({
  conn,
  paused,
  speaker,
  sheikhName,
  onResume,
}: {
  conn: LiveConn;
  paused: boolean;
  speaker: NowSpeaker;
  sheikhName: string;
  onResume?: () => void;
}) {
  if (conn === 'poor') {
    return <Line text={LIVE_COPY.poor} tone="warn" />;
  }
  if (conn === 'hostdrop') {
    return <Line text="ننتظر عودة الشيخ" tone="warn" icon="pause-circle" />;
  }
  if (conn !== 'ok') {
    // Connecting / reconnecting / offline / failed: the stage says it; the line stays quiet.
    return <Line text={sheikhName} tone="quiet" />;
  }
  if (paused) {
    return (
      <Pressable onPress={onResume} accessibilityRole="button">
        <Line text="الاستماع متوقف · اضغط للعودة إلى اللحظة المباشرة" tone="quiet" />
      </Pressable>
    );
  }
  return <Line text={nowSpeakingLine(speaker)} tone="now" bars={!!speaker} />;
}

function Line({
  text,
  tone,
  icon,
  bars = false,
}: {
  text: string;
  tone: 'now' | 'warn' | 'quiet';
  icon?: keyof typeof Feather.glyphMap;
  bars?: boolean;
}) {
  const color = tone === 'warn' ? colors.accentBrassMuted : tone === 'now' ? colors.textInk : colors.textSlate;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 6,
        minHeight: 20,
      }}
    >
      {bars ? <VoiceBars color={colors.accentBrassMuted} /> : null}
      {icon ? <Feather name={icon} size={14} color={color} /> : null}
      <Txt
        size={12.5}
        weight={tone === 'now' ? 'semibold' : 'regular'}
        color={color}
        align="center"
        numberOfLines={1}
        style={{ flexShrink: 1 }}
      >
        {text}
      </Txt>
    </View>
  );
}

/** Centred over the board (`.stage-msg`); null when the room is fine. */
export function LiveStageMessage({
  conn,
  failedSub,
  onRetry,
}: {
  conn: LiveConn;
  /** Sub-line under «تعذّر الدخول إلى الحلقة». */
  failedSub?: string;
  /** Shown as «إعادة المحاولة» when set. */
  onRetry?: () => void;
}) {
  if (conn === 'failed') {
    return (
      <Overlay>
        <View
          style={[
            {
              width: 260,
              backgroundColor: colors.surfaceCard,
              borderWidth: 1,
              borderColor: colors.borderSand,
              borderRadius: 14,
              paddingVertical: 18,
              paddingHorizontal: 22,
              alignItems: 'center',
              gap: 8,
            },
            shadows.raised,
          ]}
        >
          <Feather name="refresh-cw" size={22} color={colors.primaryTeal} />
          {/* alignSelf stretch: a fit-content Arabic line clips its last word under RTL. */}
          <Txt size={15} weight="semibold" color={colors.primaryTeal} align="center" style={{ alignSelf: 'stretch' }}>
            {LIVE_COPY.failed}
          </Txt>
          <Txt size={12.5} color={colors.textFaint} align="center" style={{ lineHeight: 20, alignSelf: 'stretch' }}>
            {failedSub ?? 'تحقّق من اتصالك ثم حاول مرة أخرى.'}
          </Txt>
          {onRetry ? (
            <Pressable
              onPress={onRetry}
              accessibilityRole="button"
              style={({ pressed }) => [
                {
                  marginTop: 4,
                  backgroundColor: colors.primaryTeal,
                  borderRadius: radius.input,
                  paddingVertical: 9,
                  paddingHorizontal: 18,
                  opacity: pressed ? 0.85 : 1,
                },
                shadows.button,
              ]}
            >
              <Txt size={13.5} weight="semibold" color={colors.onTealPrimary} align="center">
                إعادة المحاولة
              </Txt>
            </Pressable>
          ) : null}
        </View>
      </Overlay>
    );
  }
  if (conn === 'connecting' || conn === 'reconnecting' || conn === 'offline') {
    const offline = conn === 'offline';
    return (
      <Overlay>
        <View
          style={[
            {
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: colors.surfaceCard,
              borderWidth: 1,
              borderColor: colors.borderSand,
              borderRadius: 14,
              paddingVertical: 10,
              paddingHorizontal: 16,
            },
            shadows.raised,
          ]}
        >
          {offline ? (
            <Feather name="wifi-off" size={16} color={colors.stateDanger} />
          ) : (
            <ActivityIndicator size="small" color={colors.primaryTeal} />
          )}
          <Txt size={13} weight="semibold" color={offline ? colors.stateDanger : colors.primaryTeal}>
            {conn === 'connecting'
              ? LIVE_COPY.connecting
              : conn === 'reconnecting'
                ? LIVE_COPY.reconnecting
                : 'لا يوجد اتصال بالإنترنت'}
          </Txt>
        </View>
      </Overlay>
    );
  }
  return null;
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 3,
      }}
    >
      {children}
    </View>
  );
}

/** «انقطع اتصال الشيخ مؤقتاً…» (`.hold-note`). */
export function LiveHoldNote() {
  return (
    <View
      style={{
        marginTop: 12,
        marginHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        backgroundColor: 'rgba(201,164,99,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(176,137,79,0.35)',
        borderRadius: 16,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Feather name="pause-circle" size={16} color={colors.accentBrassMuted} style={{ marginTop: 3 }} />
      <Txt size={12.5} color={colors.textSlate} style={{ flex: 1, lineHeight: 21 }}>
        {LIVE_COPY.hostdrop}
      </Txt>
    </View>
  );
}
