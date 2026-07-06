import type { ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, StatusBar, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';

/**
 * Sand-background screen wrapper. Applies safe-area top inset and 22px mobile
 * side padding. Use `scroll` for vertical scroll screens; `bottomPad` clears the
 * fixed mini-player (~118px on Home/Section).
 *
 * `refreshing`/`onRefresh` only apply to the `scroll` branch — `scroll={false}`
 * screens host their own FlatList and wire pull-to-refresh directly onto it
 * instead (see notifications.tsx).
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  bottomPad = 24,
  background = colors.bgSand,
  contentStyle,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  bottomPad?: number;
  background?: string;
  contentStyle?: ViewStyle;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const insets = useSafeAreaInsets();
  // On Android, insets.top can briefly read 0 on first paint before the safe-area
  // measurement lands — StatusBar.currentHeight is a synchronous native constant,
  // so use it as a floor to avoid a one-frame flash of content under the status bar.
  const topInset =
    Platform.OS === 'android' ? Math.max(insets.top, StatusBar.currentHeight ?? 0) : insets.top;
  const padding: ViewStyle = {
    paddingTop: topInset + 8,
    paddingHorizontal: padded ? spacing.screenH : 0,
    paddingBottom: bottomPad + insets.bottom,
  };

  // iOS only: a subtle tint PINNED over the status-bar area (outside the
  // scroll), so content scrolling beneath the notch / Dynamic Island never
  // collides with the clock text un-fogged — the in-flow scrim above scrolls
  // away with the content. Skipped (zero-height) inside the pageSheet-presented
  // player modal, where insets.top is 0. Android is left exactly as shipped.
  const iosStatusBarScrim =
    Platform.OS === 'ios' && topInset > 0 ? (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: topInset,
          backgroundColor: 'rgba(0, 0, 0, 0.08)',
          zIndex: 101,
        }}
      />
    ) : null;

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: background }, contentStyle]}>
        {/* Semi-transparent status bar scrim to fog any overlapping content */}
        <View
          style={{
            height: topInset + 8,
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
            zIndex: 100,
          }}
        />
        <View
          style={[
            { flex: 1, paddingHorizontal: padded ? spacing.screenH : 0, paddingBottom: bottomPad + insets.bottom },
          ]}
        >
          {children}
        </View>
        {iosStatusBarScrim}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          { paddingHorizontal: padded ? spacing.screenH : 0, paddingBottom: bottomPad + insets.bottom },
          contentStyle,
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              tintColor={colors.primaryTeal}
              colors={[colors.primaryTeal]}
            />
          ) : undefined
        }
      >
        {/* Semi-transparent status bar scrim to fog any overlapping content */}
        <View
          style={{
            height: topInset + 8,
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
            zIndex: 100,
            marginHorizontal: padded ? -spacing.screenH : 0,
          }}
        />
        {children}
      </ScrollView>
      {iosStatusBarScrim}
    </View>
  );
}
