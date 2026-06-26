import {
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, fonts } from '@/constants/theme';

type Weight =
  | 'light'
  | 'regular'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'display'
  | 'displayRegular';

const FONT: Record<Weight, string> = {
  light: fonts.bodyLight,
  regular: fonts.body,
  medium: fonts.bodyMedium,
  semibold: fonts.bodySemibold,
  bold: fonts.bodyBold,
  display: fonts.display,
  displayRegular: fonts.displayRegular,
};

export type TxtProps = Omit<TextProps, 'style'> & {
  /** Font family + weight. `display` = Amiri (titles); others = IBM Plex Sans Arabic. */
  weight?: Weight;
  size?: number;
  color?: string;
  /** Tabular figures (for times/counters that shouldn't jitter). */
  tabular?: boolean;
  align?: TextStyle['textAlign'];
  /** Text styles; layout props (margins, width) are tolerated too. */
  style?: StyleProp<TextStyle | ViewStyle>;
};

/**
 * Arabic-first text. Defaults to RTL, body font, ink color. Always prefer this
 * over a raw <Text> so font + direction stay consistent across screens.
 */
export function Txt({
  weight = 'regular',
  size = 14,
  color = colors.textInk,
  tabular,
  align = 'right',
  style,
  ...rest
}: TxtProps) {
  return (
    <Text
      style={[
        {
          fontFamily: FONT[weight],
          fontSize: size,
          color,
          textAlign: align,
          writingDirection: 'rtl',
          ...(tabular ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : null),
        },
        style as StyleProp<TextStyle>,
      ]}
      {...rest}
    />
  );
}
