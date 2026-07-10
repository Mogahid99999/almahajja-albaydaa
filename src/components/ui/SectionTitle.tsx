import { Pressable, View } from 'react-native';

import { colors } from '@/constants/theme';
import { Txt } from './Txt';

/**
 * "العنوان" + optional "عرض الكل" row above Home rails / section lists.
 */
export function SectionTitle({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 12,
      }}
    >
      <Txt
        weight="semibold"
        size={16}
        color={colors.textInk}
        numberOfLines={1}
        style={{ flexShrink: 1 }}
      >
        {title}
      </Txt>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={8} style={{ flexShrink: 0 }}>
          <Txt size={12.5} weight="medium" color={colors.accentBrassMuted}>
            {actionLabel}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
