import Feather from '@expo/vector-icons/Feather';
import { useRouter, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
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

const SPRING = { damping: 16, stiffness: 160, mass: 0.6 };

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

  useEffect(() => {
    activeIndex.value = withSpring(activeIndexFor(pathname), SPRING);
  }, [pathname, activeIndex]);

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
              onPress={() => router.navigate(tab.path)}
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
  onPress,
}: {
  tab: Tab;
  index: number;
  activeIndex: SharedValue<number>;
  showDot: boolean;
  onPress: () => void;
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
      onPress={onPress}
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
