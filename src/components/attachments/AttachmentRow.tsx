/**
 * A single attachment row inside the section page's "المرفقات" card.
 *
 * Layout (RTL): rhombus-framed type icon · title + type/description · action.
 * Tap opens the attachment (transcript → in-app reader, others → URL).
 * Student view shows a download control for file types (pdf/image/تفريغ). When
 * `onRemove` is provided (admin), trailing reorder + delete controls are shown
 * instead of the open/download affordance.
 */
import Feather from '@expo/vector-icons/Feather';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { Attachment } from '@/api/types';
import { Rhombus, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { isDownloadable } from '@/lib/attachmentDownloads';
import { AttachmentDownloadButton } from './AttachmentDownloadButton';
import { ATTACHMENT_META, openAttachment } from './attachmentMeta';

export function AttachmentRow({
  attachment,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  attachment: Attachment;
  onRemove?: () => void;
  /** Admin-only: move this attachment one step earlier (omit at the top). */
  onMoveUp?: () => void;
  /** Admin-only: move this attachment one step later (omit at the bottom). */
  onMoveDown?: () => void;
}) {
  const router = useRouter();
  const meta = ATTACHMENT_META[attachment.type];
  const subtitle = attachment.description ?? meta.label;

  return (
    <Pressable
      onPress={() => openAttachment(attachment, router)}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
        },
        pressed && { backgroundColor: colors.bgSandRaised },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label}: ${attachment.title}`}
    >
      {/* Type icon tile with a faint rhombus motif */}
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.sm,
          backgroundColor: colors.bgSandRaised,
          borderWidth: 1,
          borderColor: colors.borderSand,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name={meta.icon} size={18} color={colors.primaryTeal} />
      </View>

      {/* Title + subtitle */}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt size={14} weight="semibold" color={colors.textInk} numberOfLines={1}>
          {attachment.title}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Rhombus size={6} color={colors.accentBrassMuted} />
          <Txt size={11.5} color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>
            {subtitle}
          </Txt>
        </View>
      </View>

      {/* Trailing action */}
      {onRemove ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {onMoveUp ? (
            <Pressable
              onPress={onMoveUp}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="نقل لأعلى"
              style={{ padding: 4 }}
            >
              <Feather name="chevron-up" size={17} color={colors.textMuted} />
            </Pressable>
          ) : null}
          {onMoveDown ? (
            <Pressable
              onPress={onMoveDown}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="نقل لأسفل"
              style={{ padding: 4 }}
            >
              <Feather name="chevron-down" size={17} color={colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="إزالة المرفق"
            style={{ padding: 4 }}
          >
            <Feather name="trash-2" size={17} color={colors.stateDanger} />
          </Pressable>
        </View>
      ) : isDownloadable(attachment) ? (
        <AttachmentDownloadButton attachment={attachment} />
      ) : (
        <Feather
          name={attachment.type === 'transcript' ? 'chevron-left' : 'external-link'}
          size={17}
          color={colors.textGhost}
        />
      )}
    </Pressable>
  );
}
