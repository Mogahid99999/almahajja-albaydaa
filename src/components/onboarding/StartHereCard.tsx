/**
 * StartHereCard — the one-time «ابدأ من هنا» recommendation shown right after a
 * newly registered student finishes (or skips) the first-time tour: a small
 * centered popup suggesting they listen to the «كيف تبدأ الدراسة ؟» lecture
 * first. Mounted once at the app root next to TourCard; visibility comes from
 * tourStore (the tour's reset() hands off `suggestStartHere` → `startHereVisible`,
 * so the الحساب replay never triggers it).
 *
 * Which lecture to recommend lives in the world-readable `start_here_lecture_id`
 * app_config key (migration 0073, editable from لوحة الإدارة ← الإعدادات). If it
 * resolves to nothing — key empty, lecture deleted or unpublished — the popup
 * quietly never appears.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useStartHereLecture } from '@/hooks/useAppContent';
import { preloadLecture } from '@/lib/audioController';
import { useTourStore } from '@/stores/tourStore';

export function StartHereCard() {
  const router = useRouter();
  const visible = useTourStore((s) => s.startHereVisible);
  const dismiss = useTourStore((s) => s.dismissStartHere);
  const { data: lecture, isPending } = useStartHereLecture(visible);

  // Resolved to nothing — drop the flag so it can't linger into a later session
  // state (e.g. a sign-out) and pop up out of context.
  useEffect(() => {
    if (visible && !isPending && !lecture) dismiss();
  }, [visible, isPending, lecture, dismiss]);

  if (!visible || !lecture) return null;
  const { id, title } = lecture;

  function onPlay() {
    dismiss();
    // Same tap-to-play pattern as the Home rails: start loading immediately,
    // in parallel with the navigation.
    void preloadLecture(id);
    router.push(`/player/${id}`);
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <View style={styles.scrim} />
        <View style={[styles.card, shadows.raised]}>
          <View style={styles.iconWrap}>
            <Feather name="play-circle" size={22} color={colors.primaryTeal} />
          </View>

          <Txt weight="semibold" size={16} color={colors.textInk} align="center" style={{ marginTop: 10 }}>
            ابدأ من هنا
          </Txt>
          <Txt size={13} color={colors.textMuted} align="center" style={{ marginTop: 4, lineHeight: 20 }}>
            قبل أن تبدأ رحلتك في المنصة، نوصيك بالاستماع أولًا إلى هذه المحاضرة.
          </Txt>

          <Pressable
            onPress={onPlay}
            accessibilityRole="button"
            accessibilityLabel={`تشغيل: ${title}`}
            style={({ pressed }) => [styles.playBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Feather name="play" size={16} color={colors.onTealPrimary} />
            <Txt weight="semibold" size={14} color={colors.onTealPrimary} align="center">
              {`تشغيل محاضرة «${title}»`}
            </Txt>
          </Pressable>

          <Pressable
            onPress={dismiss}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
            style={{ alignItems: 'center', paddingTop: 12 }}
          >
            <Txt size={12.5} weight="medium" color={colors.textGhost}>
              إغلاق
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center' } as ViewStyle,

  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,40,36,0.18)',
  } as ViewStyle,

  card: {
    marginHorizontal: 26,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.feature,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 16,
    alignItems: 'center',
  } as ViewStyle,

  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(31,74,66,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  playBtn: {
    alignSelf: 'stretch',
    marginTop: 18,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    backgroundColor: colors.primaryTeal,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,
});
