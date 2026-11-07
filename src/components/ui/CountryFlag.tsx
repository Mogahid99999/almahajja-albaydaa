/**
 * A country's flag (ISO code → emoji; 'ZZ'/invalid → 🌐). Native platforms render flag emoji
 * themselves. The web build (CountryFlag.web.tsx) adds a flags-only font because Windows browsers
 * have no flag glyphs.
 */
import React from 'react';

import { Txt } from '@/components/ui/Txt';
import { countryFlag } from '@/lib/countryDisplay';

export function CountryFlag({ code, size = 15 }: { code: string; size?: number }) {
  return (
    <Txt size={size} accessibilityElementsHidden importantForAccessibility="no">
      {countryFlag(code)}
    </Txt>
  );
}
