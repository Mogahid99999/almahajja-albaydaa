import {
  I18nManager,
  Platform,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, fonts } from '@/constants/theme';

type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'display' | 'displayRegular';

const FONT: Record<Weight, string> = {
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
  /**
   * Optically center a SINGLE glyph inside a fixed badge/circle (cover letters
   * ف/ع, number circles). Android adds extra top/bottom padding from the font
   * metrics (`includeFontPadding`) which pushes a lone glyph off-center; this
   * removes it and centers within the line box. No effect on iOS. (Task 5)
   */
  centerGlyph?: boolean;
  /** Text styles; layout props (margins, width) are tolerated too. */
  style?: StyleProp<TextStyle | ViewStyle>;
};

/**
 * On this app's forced-RTL setup, any native platform actually running in RTL
 * mode (`I18nManager.isRTL`) renders `textAlign: 'right'` flush LEFT and
 * `textAlign: 'left'` flush RIGHT for any Text whose box is wider than its
 * content (flex:1 boxes, full-width blocks) — confirmed on-device on Android,
 * and on iOS once native forceRTL enforcement was fixed there too (previously
 * iOS wasn't truly RTL, so it didn't hit this quirk). Web sets direction via
 * `document.dir` instead and must stay untouched here (confirmed broken on
 * web admin panel otherwise). 'center'/'justify'/'auto' are unaffected and
 * pass through.
 */
function physicalAlign(align: TextStyle['textAlign']): TextStyle['textAlign'] {
  if (Platform.OS === 'web' || !I18nManager.isRTL) return align;
  if (align === 'right') return 'left';
  if (align === 'left') return 'right';
  return align;
}

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
  centerGlyph,
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
          textAlign: physicalAlign(align),
          writingDirection: 'rtl',
          ...(tabular ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : null),
          ...(centerGlyph
            ? { includeFontPadding: false, textAlignVertical: 'center' as const }
            : null),
        },
        style as StyleProp<TextStyle>,
      ]}
      {...rest}
    />
  );
}
