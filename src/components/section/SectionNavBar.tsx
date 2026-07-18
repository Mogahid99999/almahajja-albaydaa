/**
 * SectionNavBar — top bar for the section page (every tree level).
 *
 * RTL layout (right → left):
 *   [back chevron (right-pointing)] ··· [parent/context label] ··· [search icon]
 *
 * Back chevron points RIGHT (›) because the app is RTL.
 * Search opens the app-wide بحث screen.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

type Props = {
  /** Parent section title or current section title when at root. */
  contextLabel: string | null;
};

export function SectionNavBar({ contextLabel }: Props) {
  const router = useRouter();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 6,
        // Negative horizontal to break out of the screen's side padding —
        // derived from spacing.screenH (not hardcoded) so it always matches
        // whatever inset the caller wraps this bar in.
        marginHorizontal: -spacing.screenH,
        paddingHorizontal: spacing.screenH - 4,
        marginBottom: 4,
      }}
    >
      {/* Back button — chevron-right because RTL (back = going right) */}
      <IconButton
        icon="chevron-right"
        iconSize={18}
        accessibilityLabel="رجوع"
        onPress={() => router.back()}
      />

      {/* Parent / context label */}
      <Txt size={13} weight="medium" color={colors.textGhost} align="center" numberOfLines={1}>
        {contextLabel ?? ''}
      </Txt>

      {/* Search — opens the app-wide بحث screen (was a dead TODO stub until the
          search screen shipped; audit F-011). */}
      <IconButton
        icon="search"
        iconSize={18}
        accessibilityLabel="بحث"
        onPress={() => router.push('/(student)/search')}
      />
    </View>
  );
}
