import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Platform, Pressable } from 'react-native';

import { colors } from '@/constants/theme';
import { useDownload } from '@/hooks/useDownloads';
import { toArabicDigits } from '@/lib/format';
import { Txt } from '@/components/ui/Txt';

/**
 * Reusable per-lecture download control (PRD §10):
 *   idle → outline download · downloading → percentage (or spinner while the
 *   server's Content-Length is still unknown) · downloaded → filled check.
 * Tapping a downloaded item removes it. Used in section rows + the player.
 *
 * Hidden on web: offline download is a mobile feature (no persistent FS here),
 * so the control would only ever land in the error state.
 */
export function DownloadButton({
  lectureId,
  size = 22,
  onTeal = false,
}: {
  lectureId: string;
  size?: number;
  onTeal?: boolean;
}) {
  const { status, progress, totalBytes, download, remove } = useDownload(lectureId);
  if (Platform.OS === 'web') return null;
  const stroke = onTeal ? colors.onTealIcon : colors.textMuted;
  const tint = onTeal ? colors.onTealIcon : colors.accentBrass;

  return (
    <Pressable
      hitSlop={10}
      onPress={status === 'downloaded' ? remove : status === 'idle' || status === 'error' ? download : undefined}
      accessibilityRole="button"
      accessibilityLabel={
        status === 'downloaded'
          ? 'حذف التحميل'
          : status === 'downloading'
            ? `جارٍ التحميل ${Math.round(progress * 100)}٪`
            : 'تحميل المحاضرة'
      }
      style={{ width: size + 12, height: size + 12, alignItems: 'center', justifyContent: 'center' }}
    >
      {status === 'downloading' ? (
        totalBytes ? (
          <Txt size={11} weight="semibold" color={tint} tabular>
            {toArabicDigits(String(Math.round(progress * 100)))}٪
          </Txt>
        ) : (
          <ActivityIndicator size="small" color={colors.accentBrass} />
        )
      ) : status === 'downloaded' ? (
        <Feather name="check-circle" size={size} color={colors.stateSuccess} />
      ) : status === 'error' ? (
        <Feather name="alert-circle" size={size} color={colors.stateDanger} />
      ) : (
        <Feather name="download" size={size} color={stroke} />
      )}
    </Pressable>
  );
}
