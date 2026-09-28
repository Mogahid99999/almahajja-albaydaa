/**
 * The bottom-sheet frame of the live sheets (same Modal pattern as the app's
 * GenderPrompt): dim backdrop (tap to close), sand panel with a rounded top,
 * header = title + sub on the RTL start, close «×» on the end.
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';

export function LiveSheet({
  visible,
  onClose,
  title,
  sub,
  showClose = true,
  children,
  maxHeightRatio,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  showClose?: boolean;
  children: ReactNode;
  /** Cap the panel (e.g. 0.82 for long lists); content sizes itself otherwise. */
  maxHeightRatio?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(22,53,47,0.35)' }}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="إغلاق"
        />
        <View
          style={{
            backgroundColor: colors.bgSandRaised,
            borderTopLeftRadius: radius.artwork,
            borderTopRightRadius: radius.artwork,
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: insets.bottom + 22,
            ...(maxHeightRatio ? { maxHeight: `${Math.round(maxHeightRatio * 100)}%` as const } : null),
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
      </View>
    </Modal>
  );
}
