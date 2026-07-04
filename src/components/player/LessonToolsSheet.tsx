/**
 * Slide-up menu with the three lesson tools (V6) — opened from the utility
 * bar's tools icon next to تحميل. Same targets as the chip row.
 */
import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';

type Router = ReturnType<typeof useRouter>;

const TOOLS: { icon: keyof typeof Feather.glyphMap; label: string; path: string }[] = [
  { icon: 'edit-3', label: 'ملاحظاتي', path: 'lecture-note' },
  { icon: 'award', label: 'فوائد الدارسين', path: 'lecture-benefits' },
  { icon: 'help-circle', label: 'أسئلة الدرس', path: 'lecture-questions' },
];

export function LessonToolsSheet({
  lectureId,
  visible,
  onClose,
}: {
  lectureId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  function open(path: string) {
    onClose();
    router.push(`/(student)/${path}/${lectureId}` as Parameters<Router['push']>[0]);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="إغلاق" />
        <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom }]}>
          <View style={styles.handle} />
          <Txt weight="semibold" size={14} color={colors.textSlate} style={{ marginBottom: 6 }}>
            أدوات الدرس
          </Txt>
          {TOOLS.map((tool) => (
            <Pressable
              key={tool.path}
              onPress={() => open(tool.path)}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.rowIcon}>
                <Feather name={tool.icon} size={17} color={colors.primaryTeal} />
              </View>
              <Txt size={14.5} weight="medium" color={colors.textInk} style={{ flex: 1 }}>
                {tool.label}
              </Txt>
              <Feather name="chevron-left" size={16} color={colors.textGhost} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' } as ViewStyle,

  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,40,36,0.5)',
  } as ViewStyle,

  sheet: {
    backgroundColor: colors.bgSand,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
  } as ViewStyle,

  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderSand2,
    marginBottom: 14,
  } as ViewStyle,

  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  } as ViewStyle,

  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(44,97,87,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
});
