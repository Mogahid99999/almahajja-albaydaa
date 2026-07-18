/**
 * RestoreDownloadsDialog — استعادة التحميلات (V19)
 *
 * A reinstall wipes the app's private storage (the id→file manifest + the SAF
 * grant) but the downloaded audio files survive in the user's public folder
 * (Download/المحجة البيضاء/…). This dialog walks the user through relinking them:
 * confirm → pick the folder (native SAF picker) → scan + match against their
 * lectures → calm result. Android only in effect (the restore is a no-op
 * elsewhere), so callers gate on that before showing it.
 *
 * Shown two ways (both wired in V19): auto after sign-in when the account has
 * history but the local manifest is empty, and manually from the downloads page.
 */
import Feather from '@expo/vector-icons/Feather';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { Txt } from '@/components/ui';
import { colors, radius, shadows } from '@/constants/theme';
import { useRestoreDownloads } from '@/hooks/useDownloads';

export function RestoreDownloadsDialog({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { state, result, error, restore } = useRestoreDownloads();
  const running = state === 'running';

  // Calm result copy — pluralization-free Arabic phrasing.
  const resultMessage = (() => {
    if (state === 'error') {
      return error === 'لم يتم منح إذن الوصول إلى مجلد التخزين'
        ? 'لم يتم منح الإذن للوصول إلى المجلد. يمكنك المحاولة مرة أخرى وتحديد المجلد الذي حفظت فيه المحاضرات.'
        : 'تعذّرت الاستعادة. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.';
    }
    if (state === 'done' && result) {
      if (result.restored === 0) {
        return 'لم يُعثر على محاضرات محمّلة في المجلد المحدد. تأكد من اختيار المجلد الصحيح الذي حفظت فيه التحميلات سابقًا.';
      }
      return `تمت استعادة ${result.restored} محاضرة. أصبحت متاحة الآن للاستماع بدون اتصال.`;
    }
    return '';
  })();

  const showResult = state === 'done' || state === 'error';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={running ? undefined : onClose}>
      <Pressable style={styles.backdrop} onPress={running ? undefined : onClose}>
        <View style={styles.dialog} onStartShouldSetResponder={() => true}>
          <View style={styles.iconWrap}>
            <Feather
              name={state === 'error' ? 'alert-triangle' : 'download-cloud'}
              size={22}
              color={state === 'error' ? colors.stateDanger : colors.primaryTeal}
            />
          </View>

          <Txt weight="semibold" size={17} color={colors.textInk} align="center" style={{ marginTop: 12 }}>
            استعادة التحميلات
          </Txt>

          {running ? (
            <View style={{ alignItems: 'center', marginTop: 18, gap: 12 }}>
              <ActivityIndicator color={colors.primaryTeal} />
              <Txt size={13} color={colors.textMuted} align="center" style={styles.message}>
                جارٍ البحث عن المحاضرات المحمّلة وربطها…
              </Txt>
            </View>
          ) : showResult ? (
            <Txt size={13} color={colors.textMuted} align="center" style={styles.message}>
              {resultMessage}
            </Txt>
          ) : (
            <Txt size={13} color={colors.textMuted} align="center" style={styles.message}>
              يبدو أن لديك سجلًّا سابقًا. إن كنت قد حمّلت محاضرات على هذا الجهاز من قبل،
              يمكننا استعادتها دون إعادة تحميل. سنطلب منك تحديد المجلد الذي حفظتها فيه.
            </Txt>
          )}

          <View style={styles.actions}>
            {showResult ? (
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.confirmBtn, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                  تم
                </Txt>
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={() => void restore()}
                  disabled={running}
                  style={({ pressed }) => [styles.confirmBtn, { opacity: pressed || running ? 0.7 : 1 }]}
                >
                  <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
                    {running ? '...' : 'استعادة الآن'}
                  </Txt>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  disabled={running}
                  style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
                >
                  <Txt weight="semibold" size={14} color={colors.textMuted}>
                    ليس الآن
                  </Txt>
                </Pressable>
              </>
            )}
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
