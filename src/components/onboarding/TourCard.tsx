/**
 * TourCard — the first-time "How it works" guided tour. A small floating card
 * (not a full-screen block) walks a newly-registered student through Home → a
 * section → the player → رفيق → الأسئلة, then returns to Home. Mounted once at
 * the app root; started from useRegister's onSuccess or replayed from الحساب.
 *
 * "Next" hides the card, resolves the next step's route, and lets the effect
 * below react to the ACTUAL navigated-to pathname before showing the next
 * card — so it never shows a step's explanation before that screen exists.
 * router.replace (not push) is used throughout so the tour never bloats the
 * back stack and so leaving the player step actually closes its modal screen.
 */
import Feather from '@expo/vector-icons/Feather';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { TOUR_STEPS } from '@/constants/tourSteps';
import { useTourStore } from '@/stores/tourStore';

export function TourCard() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { isActive, stepIndex, sectionId, lectureId, next, reset } = useTourStore();
  const [visible, setVisible] = useState(false);

  const step = TOUR_STEPS[stepIndex];
  const targetRoute = step?.route({ sectionId, lectureId }) ?? null;

  useEffect(() => {
    if (!isActive) {
      setVisible(false);
      return;
    }
    if (!step) {
      reset(); // past the last step — nothing left to show
      return;
    }
    if (!targetRoute) {
      next(); // this step can't be resolved right now (e.g. no lectures yet) — skip it quietly
      return;
    }
    if (pathname !== targetRoute) {
      setVisible(false);
      router.replace(targetRoute as Parameters<typeof router.replace>[0]);
      return;
    }
    const t = setTimeout(() => setVisible(true), 350);
    return () => clearTimeout(t);
  }, [isActive, step, targetRoute, pathname, next, reset, router]);

  if (!isActive || !step) return null;

  const isLast = stepIndex === TOUR_STEPS.length - 1;

  function onNext() {
    setVisible(false);
    if (isLast) {
      router.replace('/');
      reset();
    } else {
      next();
    }
  }

  function onSkip() {
    setVisible(false);
    router.replace('/');
    reset();
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={() => {}}>
      <View style={styles.overlay}>
        <View style={styles.scrim} />
        <View style={[styles.card, shadows.raised, { marginBottom: insets.bottom + 18 }]}>
          <View style={styles.dots}>
            {TOUR_STEPS.map((s, i) => (
              <View key={s.id} style={[styles.dot, i === stepIndex && styles.dotActive]} />
            ))}
          </View>

          <View style={styles.iconWrap}>
            <Feather name={step.icon} size={20} color={colors.primaryTeal} />
          </View>

          <Txt weight="semibold" size={16} color={colors.textInk} align="center" style={{ marginTop: 10 }}>
            {step.title}
          </Txt>
          <Txt size={13} color={colors.textMuted} align="center" style={{ marginTop: 4, lineHeight: 20 }}>
            {step.body}
          </Txt>

          <Pressable
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel={isLast ? 'إنهاء' : 'التالي'}
            style={({ pressed }) => [styles.nextBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              {isLast ? 'إنهاء' : 'التالي'}
            </Txt>
          </Pressable>

          <Pressable
            onPress={onSkip}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="تخطي الجولة"
            style={{ alignItems: 'center', paddingTop: 10 }}
          >
            <Txt size={12.5} weight="medium" color={colors.textGhost}>
              تخطي الجولة
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' } as ViewStyle,

  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,40,36,0.18)',
  } as ViewStyle,

  card: {
    marginHorizontal: 18,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.feature,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 18,
    alignItems: 'center',
  } as ViewStyle,

  dots: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  } as ViewStyle,

  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderSand2,
  } as ViewStyle,

  dotActive: {
    width: 16,
    backgroundColor: colors.accentBrass,
  } as ViewStyle,

  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(31,74,66,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  nextBtn: {
    alignSelf: 'stretch',
    marginTop: 18,
    height: 46,
    borderRadius: radius.input,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,
});
