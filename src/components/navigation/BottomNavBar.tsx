import Feather from '@expo/vector-icons/Feather';
import { useRouter, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import type { TextStyle } from 'react-native';

import { colors, radius, shadows } from '@/constants/theme';
import { useUnreadCount } from '@/hooks/useNotifications';

type FeatherName = keyof typeof Feather.glyphMap;

type Tab = {
  key: string;
  label: string;
  icon: FeatherName;
  path: '/' | '/search' | '/journey' | '/notifications' | '/profile';
};

/**
 * Order is RTL reading order — first entry renders rightmost (row, not
 * row-reverse, per the app's forced-RTL convention).
 */
const TABS: Tab[] = [
  { key: 'home', label: 'الرئيسية', icon: 'home', path: '/' },
  { key: 'search', label: 'بحث', icon: 'search', path: '/search' },
  { key: 'journey', label: 'رحلتي العلمية', icon: 'compass', path: '/journey' },
  { key: 'notifications', label: 'الإشعارات', icon: 'bell', path: '/notifications' },
  { key: 'profile', label: 'حسابي', icon: 'user', path: '/profile' },
];

export const BOTTOM_NAV_BAR_HEIGHT = 64;
/** Total vertical clearance a tab-root screen should reserve for the floating bar. */
export const BOTTOM_NAV_CLEARANCE = BOTTOM_NAV_BAR_HEIGHT + 24;

// Near-instant but still visibly sliding — settles in ~120ms. The icon color
// rides this same spring (see TabButton), so a sluggish spring here reads as
// "the active color lags the tap".
const SPRING = { damping: 26, stiffness: 500, mass: 0.4 };

function activeIndexFor(pathname: string): number {
  const i = TABS.findIndex((t) => t.path === pathname);
  return i === -1 ? 0 : i;
}

export function BottomNavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const unread = useUnreadCount();

  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = rowWidth / TABS.length;
  const activeIndex = useSharedValue(activeIndexFor(pathname));

  // Where the pill is currently headed. Lets a tab press start the spring
  // immediately without the pathname-effect below restarting the same
  // animation once navigation lands.
  const targetIndex = useRef(activeIndexFor(pathname));

  function animateTo(index: number) {
    if (targetIndex.current === index) return;
    targetIndex.current = index;
    activeIndex.value = withSpring(index, SPRING);
  }

  useEffect(() => {
    // Sync for non-tap navigations (back gesture, deep links); a tap has
    // already animated here and this is a no-op.
    animateTo(activeIndexFor(pathname));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: tabWidth > 0 ? 1 : 0,
    // Tabs render right-to-left under forced RTL (first tab = rightmost),
    // but translateX is a physical transform RTL doesn't auto-flip — so the
    // highlight must move negative (leftward) as the active index increases.
    transform: [{ translateX: -activeIndex.value * tabWidth }],
  }));

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.primaryTealDeep,
      }}
    >
      <View
        style={[
          {
            backgroundColor: colors.primaryTealDeep,
            overflow: 'hidden',
            paddingBottom: Math.max(insets.bottom, 12),
          },
          shadows.miniPlayer,
        ]}
      >
        <View
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
          style={{
            flexDirection: 'row',
            height: BOTTOM_NAV_BAR_HEIGHT,
          }}
        >
          {tabWidth > 0 ? (
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  top: 8,
                  bottom: 8,
                  width: tabWidth,
                  paddingHorizontal: 6,
                },
                pillStyle,
              ]}
            >
              <View
                style={{
                  flex: 1,
                  backgroundColor: colors.accentBrass,
                  borderRadius: radius.card - 4,
                }}
              />
            </Animated.View>
          ) : null}

          {TABS.map((tab, i) => (
            <TabButton
              key={tab.key}
              tab={tab}
              index={i}
              activeIndex={activeIndex}
              showDot={tab.key === 'notifications' && unread > 0}
              onActivate={() => {
                animateTo(i);
                // Defer one frame: Reanimated only flushes the spring to the
                // UI thread after the current JS task, and navigate() mounts
                // the destination screen inside that same task — navigating
                // immediately would stall JS before the spring ever starts.
                // One frame later the spring is already running on the UI
                // thread, immune to the mount.
                requestAnimationFrame(() => router.navigate(tab.path));
              }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function TabButton({
  tab,
  index,
  activeIndex,
  showDot,
  onActivate,
}: {
  tab: Tab;
  index: number;
  activeIndex: SharedValue<number>;
  showDot: boolean;
  onActivate: () => void;
}) {
  const iconStyle = useAnimatedStyle(() => {
    const progress = 1 - Math.min(Math.abs(activeIndex.value - index), 1);
    return {
      transform: [{ scale: 1 + progress * 0.12 }],
    };
  });

  const pathname = usePathname();
  const isActive = TABS[index].path === pathname;

  // Color must be driven off the *same* `activeIndex` progress that moves the
  // gold pill, not off `isActive` on its own timing — the active icon's color
  // (primaryTealDeep) is identical to the bar's background, so it's only
  // legible while the pill is actually underneath it. A separate, faster
  // color transition let the icon turn dark before the pill (a slower
  // spring) arrived, making it invisible against the bare background for a
  // beat on every tab change.
  const colorStyle = useAnimatedStyle(() => {
    const progress = 1 - Math.min(Math.abs(activeIndex.value - index), 1);
    return {
      color: interpolateColor(progress, [0, 1], [colors.onTealSecondary, colors.primaryTealDeep]),
    };
  });

  return (
    <Pressable
      // Switch on touch-DOWN like native tab bars — waiting for the release
      // (onPress) adds the entire finger-dwell time to the perceived latency.
      // onPress stays as the fallback for screen-reader activation, which
      // never emits pressIn; double-firing is harmless (the pill animation is
      // target-guarded and router.navigate dedupes the current route).
      onPressIn={onActivate}
      onPress={onActivate}
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isActive }}
      disabled={isActive}
      hitSlop={4}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View>
        <Animated.View style={iconStyle}>
          <AnimatedFeatherIcon name={tab.icon} colorStyle={colorStyle} />
        </Animated.View>
        {showDot ? (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -4,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.accentBrass,
              borderWidth: 1.5,
              borderColor: colors.primaryTealDeep,
            }}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const AnimatedFeather = Animated.createAnimatedComponent(Feather);

function AnimatedFeatherIcon({
  name,
  colorStyle,
}: {
  name: FeatherName;
  colorStyle: AnimatedStyle<TextStyle>;
}) {
  return <AnimatedFeather name={name} size={19} style={colorStyle} />;
}
