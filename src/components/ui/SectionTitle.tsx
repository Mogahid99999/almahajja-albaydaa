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
        marginBottom: 12,
      }}
    >
      <Txt weight="semibold" size={16} color={colors.textInk}>
        {title}
      </Txt>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Txt size={12.5} weight="medium" color={colors.accentBrassMuted}>
            {actionLabel}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
