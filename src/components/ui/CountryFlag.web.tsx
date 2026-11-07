/**
 * Web build of CountryFlag: Windows browsers have no flag glyphs (🇸🇩 shows as the letters «SD»),
 * so the flag is drawn with a flags-only font (Twemoji Country Flags, CC-BY 4.0 — see
 * assets/fonts/twemoji-flags/LICENSE.md). Any glyph the font lacks (🌐 for 'ZZ') falls back to the
 * system emoji font. Native builds use CountryFlag.tsx and never bundle this font.
 */
import { useFonts } from 'expo-font';
import React from 'react';
import { Text } from 'react-native';

import { countryFlag } from '@/lib/countryDisplay';

const FLAG_FONT = 'TwemojiCountryFlags';

export function CountryFlag({ code, size = 15 }: { code: string; size?: number }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const [loaded] = useFonts({ [FLAG_FONT]: require('../../../assets/fonts/twemoji-flags/TwemojiCountryFlags.woff2') });
  return (
    <Text
      aria-hidden
      style={{ fontSize: size, lineHeight: size * 1.35, fontFamily: loaded ? FLAG_FONT : undefined }}
    >
      {countryFlag(code)}
    </Text>
  );
}
