/**
 * Compact attachments strip for the full player (on-teal surface).
 *
 * The player layout is fixed (no scroll), so lecture attachments surface as a
 * single horizontal row of calm brass-outline chips, pinned just above the
 * utility bar. Renders nothing when the lecture has no attachments.
 */
import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Attachment } from '@/api/types';
import { Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { rtlStripStyles } from '@/components/home/useRtlRail';
import { ATTACHMENT_META, openAttachment } from './attachmentMeta';

export function PlayerAttachmentsStrip({
  attachments,
  bottom = 144,
}: {
  attachments: Attachment[];
  /** Base bottom offset — the player shrinks it on short viewports. */
  bottom?: number;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // iOS-17 RTL tap fix — see rtlStripStyles.
  const { stripStyle, stripContentStyle } = rtlStripStyles();
  if (attachments.length === 0) return null;

  return (
    // Track the utility bar's safe-area lift so the gap above it stays constant.
    // Default 144 clears the V6 «أدوات الدرس» row at its default 86.
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: bottom + insets.bottom }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={stripStyle}
        // RTL: lay chips out from the right edge inward (row-reverse under ltr on iOS).
        contentContainerStyle={{
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: 18,
          ...stripContentStyle,
        }}
      >
        {attachments.map((attachment) => {
          const meta = ATTACHMENT_META[attachment.type];
          return (
            <Pressable
              key={attachment.id}
              onPress={() => void openAttachment(attachment, router)}
              accessibilityRole="button"
              accessibilityLabel={`${meta.label}: ${attachment.title}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 9,
                paddingHorizontal: 13,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: 'rgba(201,164,99,0.4)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Feather name={meta.icon} size={14} color={colors.accentBrass} />
              <Txt size={12.5} weight="medium" color={colors.onTealPrimary} numberOfLines={1}>
                {attachment.title}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
