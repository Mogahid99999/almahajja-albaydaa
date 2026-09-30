/**
 * The room's bottom dock (PLAN_LIVE_V23 §7.3, prototype `DD.dock`).
 * RTL row: «مغادرة الحلقة» (start/right) · middle · «من في الحلقة» (end/left).
 *
 * The middle (P4):
 *  - guest            «طلب التحدث» → the «سجّل أولاً» sheet (`onRequest`; guests listen only)
 *  - listener         «طلب التحدث» ⇄ «بانتظار الإذن · إلغاء» (`speak.kind === 'hand'`),
 *                     disabled while in flight and for 5 s after each toggle (client
 *                     rate limit); disabled with a hint while moderators take no requests
 *  - speaker / staff  the microphone toggle (`speak.kind === 'mic'`). A SPEAKER also gets
 *                     «العودة إلى الاستماع» — a visible link under the row and a long-press
 *                     on the mic, both through a small confirm sheet.
 * Offline swaps the middle for the §15 reconnect note.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, platformShadow, shadows } from '@/constants/theme';
import { HandGlyph } from './LiveAvatar';
import type { LiveConn } from './liveTypes';
import { HAND_COOLDOWN_MS, LIVE_COPY, LIVE_P4_COPY } from './liveUi';
import { LiveSheet } from './sheets/LiveSheet';
import { SheetButton } from './sheets/sheetParts';

const SIDE = 50;

export type DockSpeak =
  | {
      kind: 'hand';
      /** My hand is up (a pending request). */
      up: boolean;
      /** raiseHand / lowerHand in flight. */
      busy: boolean;
      /** Moderators switched «استقبال طلبات التحدث» off. */
      closed: boolean;
      /** Not usable right now (e.g. reconnecting). */
      disabled?: boolean;
      onRaise: () => unknown;
      onLower: () => unknown;
    }
  | {
      kind: 'mic';
      on: boolean;
      busy: boolean;
      /** Not usable right now (e.g. reconnecting). */
      disabled?: boolean;
      onToggle: () => void;
      /** Set for a speaker only (D1: he steps himself down; staff don't). */
      onStepDown?: () => void;
    };

export function LiveDock({
  conn,
  bottomInset,
  onLeave,
  onPeople,
  onRequest,
  speak,
}: {
  conn: LiveConn;
  bottomInset: number;
  onLeave: () => void;
  onPeople: () => void;
  /**
   * Guests only: «طلب التحدث» → «سجّل أولاً» sheet (guests listen but never
   * speak — owner, 2026-09-28). Wins over `speak`.
   */
  onRequest?: () => void;
  /** Registered listener / speaker / staff controls; unset = the request button stays disabled. */
  speak?: DockSpeak;
}) {
  const [stepDownOpen, setStepDownOpen] = useState(false);
  const leave = <SideButton icon="log-out" label={LIVE_COPY.leave} onPress={onLeave} />;

  let middle: React.ReactNode;
  let below: React.ReactNode = null;
  if (onRequest) {
    middle = <RequestButton label={LIVE_COPY.request} onPress={onRequest} />;
  } else if (speak?.kind === 'hand') {
    middle = <HandButton speak={speak} />;
    if (speak.closed && !speak.up) {
      below = (
        <Txt size={12} color={colors.textFaint} align="center" style={{ alignSelf: 'stretch' }}>
          {LIVE_P4_COPY.requestsClosed}
        </Txt>
      );
    }
  } else if (speak?.kind === 'mic') {
    const stepDown = speak.onStepDown;
    middle = (
      <MicButton
        on={speak.on}
        busy={speak.busy}
        disabled={!!speak.disabled}
        onToggle={speak.onToggle}
        onLongPress={stepDown ? () => setStepDownOpen(true) : undefined}
      />
    );
    if (stepDown) {
      below = (
        <Pressable
          onPress={() => setStepDownOpen(true)}
          accessibilityRole="button"
          hitSlop={8}
          style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}
        >
          <Feather name="headphones" size={14} color={colors.primaryTeal} />
          <Txt size={12.5} weight="medium" color={colors.primaryTeal} style={{ textDecorationLine: 'underline' }}>
            {LIVE_P4_COPY.stepDown}
          </Txt>
        </Pressable>
      );
    }
  } else {
    middle = <RequestButton label={LIVE_COPY.request} />;
  }

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
          gap: 10,
        },
        platformShadow(colors.primaryTealDeep, { width: 0, height: -12 }, 0.12, 20, 6),
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
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
            {middle}
            <SideButton icon="users" label="من في الحلقة" onPress={onPeople} />
          </>
        )}
      </View>
      {conn !== 'offline' ? below : null}

      {speak?.kind === 'mic' && speak.onStepDown ? (
        <StepDownSheet
          visible={stepDownOpen}
          onClose={() => setStepDownOpen(false)}
          onConfirm={() => {
            setStepDownOpen(false);
            speak.onStepDown?.();
          }}
        />
      ) : null}
    </View>
  );
}

// ─── Middle buttons ──────────────────────────────────────────────────────────

const MAIN = {
  flex: 1,
  height: 52,
  borderRadius: 16,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 9,
} as const;

/** «طلب التحدث» — the guest path, or the disabled placeholder before I'm in the room. */
function RequestButton({ label, onPress }: { label: string; onPress?: () => void }) {
  const disabled = !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        MAIN,
        { backgroundColor: colors.primaryTeal, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        shadows.button,
      ]}
    >
      <HandGlyph size={19} color={colors.onTealPrimary} strokeWidth={1.9} />
      <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** «طلب التحدث» ⇄ «بانتظار الإذن · إلغاء» with the 5-second rest after each toggle. */
function HandButton({ speak }: { speak: Extract<DockSpeak, { kind: 'hand' }> }) {
  const [cooling, setCooling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const { up, busy, closed } = speak;
  const disabled = busy || cooling || !!speak.disabled || (!up && closed);
  const label = up ? LIVE_P4_COPY.requestPending : LIVE_COPY.request;

  const onPress = () => {
    if (disabled) return;
    // The rest counts from when the SERVER took the toggle (it stamps hand_at
    // then), not from the tap — on a slow network a tap-based rest would end
    // early and the next raise would meet «انتظر قليلاً».
    const done = up ? speak.onLower() : speak.onRaise();
    setCooling(true);
    if (timer.current) clearTimeout(timer.current);
    void Promise.resolve(done)
      .catch(() => undefined)
      .then(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          setCooling(false);
        }, HAND_COOLDOWN_MS);
      });
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      accessibilityLabel={label}
      accessibilityHint={up ? 'يلغي طلب التحدث' : closed ? LIVE_P4_COPY.requestsClosed : undefined}
      style={({ pressed }) => [
        MAIN,
        up
          ? { backgroundColor: colors.bgSandRaised, borderWidth: 1.5, borderColor: colors.accentBrassMuted }
          : [{ backgroundColor: colors.primaryTeal }, shadows.button],
        { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={up ? colors.accentBrassMuted : colors.onTealPrimary} />
      ) : (
        <HandGlyph size={19} color={up ? colors.accentBrassMuted : colors.onTealPrimary} strokeWidth={1.9} />
      )}
      <Txt size={up ? 14 : 15} weight="semibold" color={up ? colors.accentBrassMuted : colors.onTealPrimary}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** My microphone: teal + «الميكروفون مفتوح» when open, inset + «الميكروفون مغلق» when closed. */
function MicButton({
  on,
  busy,
  disabled,
  onToggle,
  onLongPress,
}: {
  on: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  onLongPress?: () => void;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={off ? undefined : onToggle}
      onLongPress={onLongPress}
      delayLongPress={450}
      accessibilityRole="button"
      accessibilityState={{ checked: on, busy, disabled: off }}
      accessibilityLabel={on ? LIVE_P4_COPY.micCloseA11y : LIVE_P4_COPY.micOpenA11y}
      accessibilityHint={onLongPress ? 'اضغط مطوّلاً للعودة إلى الاستماع' : undefined}
      style={({ pressed }) => [
        MAIN,
        on
          ? [{ backgroundColor: colors.primaryTeal }, shadows.button]
          : { backgroundColor: colors.surfaceInset, borderWidth: 1, borderColor: colors.borderSand2 },
        { opacity: disabled ? 0.45 : busy ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={on ? colors.onTealPrimary : colors.primaryTeal} />
      ) : (
        <Feather name={on ? 'mic' : 'mic-off'} size={19} color={on ? colors.onTealPrimary : colors.textSlate} />
      )}
      <Txt size={15} weight="semibold" color={on ? colors.onTealPrimary : colors.textSlate}>
        {on ? LIVE_P4_COPY.micOn : LIVE_P4_COPY.micOff}
      </Txt>
    </Pressable>
  );
}

/** A speaker returns himself to listening (D1). */
function StepDownSheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <LiveSheet
      visible={visible}
      onClose={onClose}
      title={`${LIVE_P4_COPY.stepDown}؟`}
      sub="يُغلق ميكروفونك وتعود إلى الاستماع، ويمكنك طلب التحدث من جديد متى شئت."
    >
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
        <SheetButton label={LIVE_P4_COPY.stepDown} tone="primary" onPress={onConfirm} />
        <SheetButton label="ليس الآن" onPress={onClose} />
      </View>
    </LiveSheet>
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
