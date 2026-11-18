/**
 * Store update prompt (owner, 2026-11-18): replaces the old UpdateGate, which
 * closed the app below a version typed in the admin panel.
 *
 * Each time the app is opened (a cold start, or a return after
 * REOPEN_AFTER_MS away) it asks the store whether a newer version is published
 * (src/lib/storeUpdate.ts). If so, a calm popup offers it: «تحديث الآن» or
 * «لاحقًا». «لاحقًا» hides it until the next opening; it keeps coming back until
 * the person updates. It never blocks the app, never shows on web (the admin
 * dashboard), and waits while the first-time tour, the «ابدأ من هنا» card or a
 * live majlis is on screen.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect } from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { checkStoreUpdate, openStoreUpdate } from '@/lib/storeUpdate';
import { useLiveStore } from '@/stores/liveStore';
import { useStoreUpdateStore } from '@/stores/storeUpdateStore';
import { useTourStore } from '@/stores/tourStore';

export const REOPEN_AFTER_MS = 30 * 60 * 1000;

export function StoreUpdatePrompt() {
  const update = useStoreUpdateStore((s) => s.update);
  const dismissed = useStoreUpdateStore((s) => s.dismissed);
  const dismiss = useStoreUpdateStore((s) => s.dismiss);
  const tourActive = useTourStore((s) => s.isActive);
  const startHereVisible = useTourStore((s) => s.startHereVisible);
  const inLive = useLiveStore((s) => !!s.session);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const check = () => {
      void checkStoreUpdate().then((result) => useStoreUpdateStore.getState().setUpdate(result));
    };
    check();
    let awaySince: number | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        awaySince = Date.now();
      } else if (state === 'active' && awaySince != null) {
        const away = Date.now() - awaySince;
        awaySince = null;
        if (away >= REOPEN_AFTER_MS) {
          useStoreUpdateStore.getState().reopen();
          check();
        }
      }
    });
    return () => sub.remove();
  }, []);

  if (!update?.available || dismissed || tourActive || startHereVisible || inLive) return null;

  function onUpdate() {
    if (!update) return;
    dismiss();
    void openStoreUpdate(update);
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <View style={styles.scrim} />
        <View style={[styles.card, shadows.raised]}>
          <View style={styles.iconWrap}>
            <Feather name="download" size={22} color={colors.primaryTeal} />
          </View>

          <Txt weight="semibold" size={16} color={colors.textInk} align="center" style={{ marginTop: 10 }}>
            يتوفر إصدار جديد
          </Txt>
          <Txt size={13} color={colors.textMuted} align="center" style={{ marginTop: 4, lineHeight: 20 }}>
            حدّث التطبيق لتحصل على أحدث التحسينات والإصلاحات.
          </Txt>

          <Pressable
            onPress={onUpdate}
            accessibilityRole="button"
            style={({ pressed }) => [styles.updateBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary} align="center">
              تحديث الآن
            </Txt>
          </Pressable>

          <Pressable
            onPress={dismiss}
            hitSlop={8}
            accessibilityRole="button"
            style={{ alignItems: 'center', paddingTop: 12 }}
          >
            <Txt size={12.5} weight="medium" color={colors.textGhost}>
              لاحقًا
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

  updateBtn: {
    alignSelf: 'stretch',
    marginTop: 18,
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,
});
