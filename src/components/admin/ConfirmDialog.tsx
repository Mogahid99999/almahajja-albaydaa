/**
 * ConfirmDialog — a small modal confirmation used by the admin destructive
 * actions (delete a lecture / section / sheikh). Works on web and native (RN
 * Alert is unreliable on react-native-web, so we render our own dialog).
 */
import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** A red confirm button for irreversible actions (default true). */
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'حذف',
  cancelLabel = 'إلغاء',
  destructive = true,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <View style={styles.dialog} onStartShouldSetResponder={() => true}>
          <View style={styles.iconWrap}>
            <Feather
              name={destructive ? 'alert-triangle' : 'help-circle'}
              size={22}
              color={destructive ? colors.stateDanger : colors.primaryTeal}
            />
          </View>
          <Txt weight="semibold" size={17} color={colors.textInk} align="center" style={{ marginTop: 12 }}>
            {title}
          </Txt>
          <Txt size={13} color={colors.textMuted} align="center" style={styles.message}>
            {message}
          </Txt>

          <View style={styles.actions}>
            <Pressable
              onPress={onConfirm}
              disabled={pending}
              style={({ pressed }) => [
                styles.confirmBtn,
                destructive && styles.confirmBtnDanger,
                { opacity: pressed || pending ? 0.7 : 1 },
              ]}
            >
              <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                {pending ? '...' : confirmLabel}
              </Txt>
            </Pressable>
            <Pressable
              onPress={onCancel}
              disabled={pending}
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
            >
              <Txt weight="semibold" size={14} color={colors.textMuted}>
                {cancelLabel}
              </Txt>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  } as ViewStyle,

  dialog: {
    width: 420,
    maxWidth: '100%',
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.card,
    padding: 24,
    alignItems: 'center',
    ...shadows.button,
  } as ViewStyle,

  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceInset,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  message: {
    marginTop: 8,
    lineHeight: 21,
  } as ViewStyle,

  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
    alignSelf: 'stretch',
  } as ViewStyle,

  confirmBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  confirmBtnDanger: {
    backgroundColor: colors.stateDanger,
  } as ViewStyle,

  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
});
