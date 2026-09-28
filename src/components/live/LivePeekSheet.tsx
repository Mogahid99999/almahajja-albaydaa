/**
 * «الحلقة» presentation shell — the same Android peek-sheet as the full player
 * (app/player/[id].tsx): the route is a `transparentModal` (app/_layout.tsx),
 * so on Android this draws the dimmed backdrop + a rounded sheet inset from the
 * top, slides it up on open / down on collapse from ONE shared value, and lets
 * a downward swipe anywhere on the sheet minimise the room (the live keeps
 * playing — the mini-bar takes over). iOS's native `modal` does all of that
 * itself, so there the children render as is.
 */
import { useCallback, useEffect, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/theme';

const PEEK_TOP_RATIO = 0.1;
const DRAG_ACTIVATION_PX = 12;

export function LivePeekSheet({ children }: { children: (collapse: () => void) => ReactNode }) {
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const isAndroid = Platform.OS === 'android';
  const topGap = Math.round(windowHeight * PEEK_TOP_RATIO);
  const sheetTravel = windowHeight - topGap;
  const translateY = useSharedValue(isAndroid ? sheetTravel : 0);

  useEffect(() => {
    if (isAndroid) {
      translateY.value = withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened as the entry screen (notification / share link) there's no history.
  const collapse = useCallback(() => {
    if (isAndroid) {
      translateY.value = withTiming(sheetTravel, { duration: 240, easing: Easing.in(Easing.cubic) });
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [isAndroid, router, sheetTravel, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.max(0, translateY.value / sheetTravel)),
  }));

  if (!isAndroid) return <>{children(collapse)}</>;

  const dragGesture = Gesture.Pan()
    .activeOffsetY(DRAG_ACTIVATION_PX)
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY - DRAG_ACTIVATION_PX);
    })
    .onEnd((e) => {
      if (e.translationY > windowHeight * 0.22 || e.velocityY > 800) {
        runOnJS(collapse)();
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 220 });
      }
    });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={collapse}
          accessibilityRole="button"
          accessibilityLabel="تصغير الحلقة"
        />
      </Animated.View>
      <GestureDetector gesture={dragGesture}>
        <Animated.View style={[styles.sheet, { top: topGap }, sheetStyle]}>
          <View style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
          <View style={{ flex: 1 }}>{children(collapse)}</View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgSand,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  grabberZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderSand },
});
