import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable } from 'react-native';

import type { Attachment } from '@/api/types';
import { colors } from '@/constants/theme';
import { useAttachmentDownload } from '@/hooks/useAttachmentDownloads';

/**
 * Per-attachment download control for file types (pdf/image/تفريغ), reusing the
 * lecture DownloadButton pattern (PRD §13):
 *   idle → outline download · downloading → spinner · downloaded → filled check.
 * Tapping a downloaded item removes it. Shown in the section list + player strip.
 */
export function AttachmentDownloadButton({
  attachment,
  sectionTitle = null,
  size = 18,
}: {
  attachment: Attachment;
  /** Section this file belongs to — places its download under <app>/<section>/…. */
  sectionTitle?: string | null;
  size?: number;
}) {
  const { status, download, remove } = useAttachmentDownload(attachment, sectionTitle);

  return (
    <Pressable
      hitSlop={10}
      onPress={
        status === 'downloaded'
          ? remove
          : status === 'idle' || status === 'error'
            ? download
            : undefined
      }
      accessibilityRole="button"
      accessibilityLabel={status === 'downloaded' ? 'حذف التحميل' : 'تحميل المرفق'}
      style={{ width: size + 12, height: size + 12, alignItems: 'center', justifyContent: 'center' }}
    >
      {status === 'downloading' ? (
        <ActivityIndicator size="small" color={colors.accentBrass} />
      ) : status === 'downloaded' ? (
        <Feather name="check-circle" size={size} color={colors.stateSuccess} />
      ) : status === 'error' ? (
        <Feather name="alert-circle" size={size} color={colors.stateDanger} />
      ) : (
        <Feather name="download" size={size} color={colors.textMuted} />
      )}
    </Pressable>
  );
}
