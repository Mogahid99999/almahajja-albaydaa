/**
 * A single attachment row inside the section page's "المرفقات" card.
 *
 * Layout (RTL): rhombus-framed type icon · title + type/description · action.
 * Tap opens the attachment (transcript → in-app reader, others → URL).
 * When `onRemove` is provided (admin), a trailing delete control is shown
 * instead of the open chevron.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { Attachment } from '@/api/types';
import { Rhombus, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { ATTACHMENT_META, openAttachment } from './attachmentMeta';

export function AttachmentRow({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove?: () => void;
}) {
  const router = useRouter();
  const meta = ATTACHMENT_META[attachment.type];
  const subtitle = attachment.description ?? meta.label;

  return (
    <Pressable
      onPress={() => openAttachment(attachment, router)}
      style={({ pressed }) => [
        {
          flexDirection: 'row-reverse',
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
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
          <Rhombus size={6} color={colors.accentBrassMuted} />
          <Txt size={11.5} color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>
            {subtitle}
          </Txt>
        </View>
      </View>

      {/* Trailing action */}
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="إزالة المرفق"
          style={{ padding: 4 }}
        >
          <Feather name="trash-2" size={17} color={colors.stateDanger} />
        </Pressable>
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
