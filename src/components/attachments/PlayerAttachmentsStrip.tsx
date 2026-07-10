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
import { ATTACHMENT_META, openAttachment } from './attachmentMeta';

export function PlayerAttachmentsStrip({ attachments }: { attachments: Attachment[] }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (attachments.length === 0) return null;

  return (
    // Track the utility bar's safe-area lift so the gap above it stays constant.
    // 144 clears the V6 «أدوات الدرس» row that now sits at 86.
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 144 + insets.bottom }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // RTL: lay chips out from the right edge inward.
        contentContainerStyle={{
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: 18,
        }}
      >
        {attachments.map((attachment) => {
          const meta = ATTACHMENT_META[attachment.type];
          return (
            <Pressable
              key={attachment.id}
              onPress={() => openAttachment(attachment, router)}
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
