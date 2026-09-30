/**
 * The bottom-sheet frame of the live sheets, on the shared SheetModal (the dim
 * fades in place, only the panel slides — RN Modal "slide" used to carry the
 * dim up the screen with it): dim backdrop (tap to close), sand panel with a
 * rounded top, header = title + sub on the RTL start, close «×» on the end.
 */
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, SheetModal, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';

export function LiveSheet({
  visible,
  onClose,
  title,
  sub,
  showClose = true,
  children,
  maxHeightRatio,
  heightRatio,
  avoidKeyboard = false,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  showClose?: boolean;
  children: ReactNode;
  /** Cap the panel (e.g. 0.82 for long lists); content sizes itself otherwise. */
  maxHeightRatio?: number;
  /**
   * A FIXED panel height instead (e.g. 0.72) — for sheets with a search field:
   * a content-sized panel shrinks as results narrow and sinks behind the
   * keyboard; a fixed one keeps the field high on the screen.
   */
  heightRatio?: number;
  /**
   * A text field at the BOTTOM of the panel (the comments composer): the app
   * is edge-to-edge, so the keyboard overlays the modal. The panel sits in a
   * full-screen, bottom-anchored KeyboardAvoidingView (SheetModal's keyboard
   * pattern, as FeedbackSheet): `padding` lifts it above the keyboard and a
   * percentage height shrinks with the space left. A KeyboardAvoidingView
   * INSIDE the panel measured itself against the panel, not the screen, and
   * left the field under the keyboard (owner 2026-09-30).
   */
  avoidKeyboard?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const panel = (
      <View
        style={{
          backgroundColor: colors.bgSandRaised,
          borderTopLeftRadius: radius.artwork,
          borderTopRightRadius: radius.artwork,
          paddingHorizontal: 20,
          paddingTop: 10,
          paddingBottom: insets.bottom + 22,
          ...(heightRatio
            ? { height: `${Math.round(heightRatio * 100)}%` as const }
            : maxHeightRatio
              ? { maxHeight: `${Math.round(maxHeightRatio * 100)}%` as const }
              : null),
        }}
      >
        <View style={{ alignItems: 'center', paddingBottom: 12 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderSand2 }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <Txt weight="display" size={21} color={colors.primaryTeal} style={{ lineHeight: 30 }}>
              {title}
            </Txt>
            {sub ? (
              <Txt size={12.5} color={colors.textFaint} style={{ lineHeight: 20, marginTop: 2 }}>
                {sub}
              </Txt>
            ) : null}
          </View>
          {showClose ? (
            <IconButton icon="x" size={36} iconSize={18} onPress={onClose} accessibilityLabel="إغلاق" />
          ) : null}
        </View>
        {children}
      </View>
  );
  return (
    <SheetModal visible={visible} onClose={onClose} backdropAccessibilityLabel="إغلاق">
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}
          behavior="padding"
          pointerEvents="box-none"
        >
          {panel}
        </KeyboardAvoidingView>
      ) : (
        panel
      )}
    </SheetModal>
  );
}
