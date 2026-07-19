import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { CelebrationEvent, CelebrationLevel } from '@/api/types';
import { badgeByKey } from '@/constants/badges';
import { colors, radius } from '@/constants/theme';
import { playCelebrationCue } from '@/lib/celebrationCue';
import { useCelebrationStore } from '@/stores/celebrationStore';
import { Rhombus } from '@/components/ui/Rhombus';
import { Txt } from '@/components/ui/Txt';

/**
 * Unified Achievement Celebration — الاحتفال بالإنجازات (V20 · §15).
 *
 * Mounted ONCE at the app root; it renders whatever the celebration store makes
 * `current`, one at a time (the store owns the queue + the quiz-suppression gate).
 * Three visual weights (source §15): a `simple` event is a small card near the top
 * of the screen; `medium`/`large` are a quiet centered modal, `large` with a bit
 * more gold glow and ornament. No confetti, no loud game effects (CLAUDE.md calm
 * tone) — a soft dim, a gentle scale-in, a «الحمد لله» button. Full RTL.
 *
 * Motion + the optional cue (quiet sound + light haptic) honor the OS "reduce
 * motion" setting and degrade to nothing if the native modules aren't present, so
 * this never needs a new native build to ship.
 */
export function AchievementCelebration() {
  const current = useCelebrationStore((s) => s.current);
  const dismiss = useCelebrationStore((s) => s.dismissCurrent);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => active && setReduceMotion(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  if (!current) return null;

  return (
    <CelebrationView
      key={current.key}
      event={current}
      reduceMotion={reduceMotion}
      onClose={dismiss}
    />
  );
}

/** A single celebration instance. Keyed on the event so each remounts fresh. */
function CelebrationView({
  event,
  reduceMotion,
  onClose,
}: {
  event: CelebrationEvent;
  reduceMotion: boolean;
  onClose: () => void;
}) {
  const scale = useSharedValue(reduceMotion ? 1 : 0.7);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const firedCue = useRef(false);

  useEffect(() => {
    if (!firedCue.current) {
      firedCue.current = true;
      // Quiet sound + light haptic (decision 2026-07-19: sound ON). Best-effort;
      // silent when the module/asset is missing or reduce-motion is on.
      void playCelebrationCue(event.level, reduceMotion);
    }
    if (reduceMotion) {
      scale.value = 1;
      opacity.value = 1;
      return;
    }
    opacity.value = withTiming(1, { duration: 180 });
    scale.value = withTiming(1, {
      duration: 340,
      easing: Easing.out(Easing.back(1.4)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const iconStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const badge = event.iconBadgeKey ? badgeByKey(event.iconBadgeKey) : undefined;

  // A `simple` event is a lightweight card near the top — it must never fully
  // cover the screen nor pause anything, so no dim backdrop and top alignment.
  const isSimple = event.level === 'simple';
  const isLarge = event.level === 'large';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="إغلاق"
        style={{
          flex: 1,
          // Simple = a soft veil only at the top; medium/large = a gentle full dim.
          backgroundColor: isSimple ? 'transparent' : 'rgba(22,53,47,0.42)',
          justifyContent: isSimple ? 'flex-start' : 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
          paddingTop: isSimple ? 64 : 0,
        }}
      >
        <Pressable
          onPress={() => {}}
          style={
            {
              width: '100%',
              maxWidth: 360,
              alignItems: 'center',
              gap: 14,
              paddingHorizontal: 22,
              paddingVertical: isSimple ? 18 : 30,
              borderRadius: radius.artwork,
              backgroundColor: colors.bgSandRaised,
              borderWidth: 1,
              borderColor: isLarge ? colors.accentBrassSoft : colors.borderSand,
            } as ViewStyle
          }
        >
          {/* Emblem — the shared "brass seal" identity, scaled up for large. */}
          <Animated.View style={iconStyle}>
            <Emblem level={event.level} />
          </Animated.View>

          <Txt
            weight="display"
            size={isSimple ? 16 : isLarge ? 21 : 19}
            color={colors.primaryTeal}
            align="center"
          >
            {event.titleAr}
          </Txt>
          <Txt
            size={13}
            color={colors.textMuted}
            align="center"
            style={{ lineHeight: 21 }}
          >
            {event.bodyAr}
          </Txt>

          {/* «الحمد لله» primary + optional «عرض الوسام» when a badge is attached. */}
          {!isSimple ? (
            <View style={{ width: '100%', gap: 8, marginTop: 4 }}>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                style={({ pressed }) =>
                  ({
                    paddingVertical: 13,
                    borderRadius: radius.input,
                    alignItems: 'center',
                    backgroundColor: colors.primaryTeal,
                    opacity: pressed ? 0.7 : 1,
                  }) as ViewStyle
                }
              >
                <Txt size={15} weight="semibold" color={colors.onTealPrimary}>
                  الحمد لله
                </Txt>
              </Pressable>
              {badge ? (
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    paddingVertical: 10,
                    alignItems: 'center',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Txt size={13} weight="medium" color={colors.accentBrassMuted}>
                    عرض الوسام
                  </Txt>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The gold seal emblem — the same rhombus motif as BadgeSeal, sized by level. */
function Emblem({ level }: { level: CelebrationLevel }) {
  const box = level === 'large' ? 84 : level === 'medium' ? 72 : 56;
  return (
    <View
      style={{
        width: box,
        height: box,
        borderRadius: box * 0.28,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.accentBrass,
      }}
    >
      <Rhombus size={box * 0.42} color={colors.primaryTealDeep} filled={false} />
      <Rhombus
        size={box * 0.18}
        color={colors.primaryTealDeep}
        filled
        style={{ position: 'absolute' }}
      />
    </View>
  );
}
