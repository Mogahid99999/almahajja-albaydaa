/**
 * «الحلقة» presentation shell — the same Android peek-sheet as the full player
 * (app/player/[id].tsx): the route is a `transparentModal` (app/_layout.tsx),
 * so on Android this draws the dimmed backdrop + a rounded sheet inset from the
 * top, slides it up on open / down on collapse from ONE shared value, and lets
 * a downward swipe anywhere on the sheet minimise the room (the live keeps
 * playing — the mini-bar takes over). iOS's native `modal` does all of that
 * itself, so there the children render as is.
 *
 * `collapse` closes THIS screen, and only from the top. A link / notification /
 * share link to ANOTHER majlis while a room is open PUSHES a second room over it
 * (expo-router's Stack: same route, other id = a new screen). Once the new
 * session is joined, the room beneath sees it was left and closes — with
 * router.back() that popped the NEW room (device 2026-09-30: joined, nothing
 * shown). Pulling the covered room out from under the new one instead froze
 * react-native-screens on Android (nothing shown, nothing opened afterwards —
 * expo-router's own Stack warns about removing a non-top route). So a covered
 * screen only asks to close: it goes together with the room above it (popped
 * from the top), or on its own once uncovered (e.g. a lecture player closed).
 */
import { useCallback, useEffect, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useNavigation, useRoute, useRouter } from 'expo-router';
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

/** Route keys of room screens that asked to close while another screen covered them. */
const closeWhenUncovered = new Set<string>();

export function LivePeekSheet({ children }: { children: (collapse: () => void) => ReactNode }) {
  const router = useRouter();
  const navigation = useNavigation();
  const routeKey = useRoute().key;
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

  const collapse = useCallback(() => {
    const state = navigation.getState();
    const routes = state?.routes ?? [];
    const mine = routes.findIndex((r) => r.key === routeKey);
    if (state && mine === -1) return; // already gone: popping now would close another screen
    if (state && mine !== state.index) {
      // Covered: never pop the screen above, never pull this one out from under it.
      closeWhenUncovered.add(routeKey);
      return;
    }
    // Rooms left beneath this one go with it, popped from the top together.
    let count = 1;
    while (mine - count >= 0 && closeWhenUncovered.has(routes[mine - count].key)) count++;
    if (isAndroid) {
      translateY.value = withTiming(sheetTravel, { duration: 240, easing: Easing.in(Easing.cubic) });
    }
    if (count > 1) router.dismiss(count);
    // Opened as the entry screen (notification / share link) there's no history.
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [isAndroid, navigation, routeKey, router, sheetTravel, translateY]);

  // Uncovered while waiting to close (the screen above went some other way —
  // Android back, a lecture player dismissed): close now, once.
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (closeWhenUncovered.delete(routeKey)) collapse();
      }),
    [navigation, routeKey, collapse],
  );
  useEffect(
    () => () => {
      closeWhenUncovered.delete(routeKey);
    },
    [routeKey],
  );

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
