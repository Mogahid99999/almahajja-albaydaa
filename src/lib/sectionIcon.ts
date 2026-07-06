import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type MCIName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * Keyword → icon, checked in order (most specific pattern first so e.g.
 * "أصول الفقه" resolves before the generic "فقه" bucket).
 */
const KEYWORD_ICONS: [RegExp, MCIName][] = [
  [/توحيد|عقيدة|إيمان|أسماء (الله|الحسنى)/, 'star-crescent'],
  [/أصول الفقه/, 'sitemap-outline'],
  [/فرائض|مواريث/, 'calculator-variant-outline'],
  [/فقه|أحكام|فتاوى|عبادات|طهارة|صلاة|زكاة|صيام|صوم|حج|معاملات/, 'scale-balance'],
  [/حديث|سنة|أربعين/, 'comment-quote-outline'],
  [/تفسير|قرآن|تجويد/, 'book-open-page-variant-outline'],
  [/سيرة|شمائل/, 'map-marker-path'],
  [/تزكية|أخلاق|آداب|رقائق|زهد|سلوك/, 'hand-heart-outline'],
  [/دعاء|أذكار/, 'hands-pray'],
  [/دعوة/, 'bullhorn-outline'],
  [/تاريخ/, 'history'],
  [/لغة|نحو|صرف|بلاغة|عرب/, 'book-alphabet'],
  [/جهاد/, 'sword'],
];

const DEFAULT_ICON: MCIName = 'book-outline';

/** Picks a suitable icon for a section based on its (Arabic) title. */
export function sectionIconName(title: string): MCIName {
  for (const [pattern, icon] of KEYWORD_ICONS) {
    if (pattern.test(title)) return icon;
  }
  return DEFAULT_ICON;
}
