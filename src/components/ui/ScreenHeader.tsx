import { useRouter } from 'expo-router';
import { View, type ViewStyle } from 'react-native';

import { colors } from '@/constants/theme';
import { IconButton } from '@/components/ui/IconButton';
import { Txt } from '@/components/ui/Txt';

/**
 * Standard page header: a back button + a display title on one row.
 *
 * RTL rule (owner, 2026-07-20): the back button sits on the RIGHT. Because the
 * app runs in forced-RTL, a `flex-direction: row` flips child order — so the back
 * button is the FIRST child here to land on the right edge (matching
 * SectionNavBar). The title flows to its left. The chevron points right (›) as
 * "back" in RTL.
 *
 * `right` optionally renders a trailing action pinned to the LEFT edge (e.g. a
 * search icon); when omitted the title stretches to fill.
 */
export function ScreenHeader({
  title,
  onBack,
  right,
  titleSize = 22,
  style,
}: {
  title: string;
  /** Defaults to router.back(). */
  onBack?: () => void;
  right?: React.ReactNode;
  titleSize?: number;
  style?: ViewStyle;
}) {
  const router = useRouter();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        },
        style,
      ]}
    >
      <IconButton
        icon="chevron-right"
        onPress={onBack ?? (() => router.back())}
        accessibilityLabel="رجوع"
      />
      {/* Title sits immediately beside the back button (on its LEFT = the right
          side in RTL). `flex: 1` gives it the remaining width as its box so the
          Arabic display font measures + right-aligns fully (a fit-content box
          mis-measures and clips the last word under forced RTL). A trailing
          `right` action, if any, sits at the far (left) edge. */}
      <Txt
        size={titleSize}
        weight="display"
        color={colors.primaryTeal}
        numberOfLines={1}
        style={{ flex: 1 }}
      >
        {title}
      </Txt>
      {right ?? null}
    </View>
  );
}
