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
  [/شبه|شبهات|خدعوك|خداع|رد على/, 'shield-alert-outline'],
  [/كفار|مكفر|توبة|استغفار/, 'shield-check-outline'],
  [/كيف تبدأ|منهج|خطة الطلب|خطة الدراسة/, 'compass-outline'],
  [/آزفة|القيامة|الساعة|الآخرة|الموت/, 'weather-night'],
  [/متنوع|منوعات/, 'view-grid-outline'],
];

/**
 * Titles that match no keyword above (general/misc sections) rotate through
 * these instead of all collapsing onto one repeated glyph.
 */
const FALLBACK_ICONS: MCIName[] = [
  'book-outline',
  'lightbulb-on-outline',
  'help-circle-outline',
  'view-grid-outline',
];

/** Picks a suitable icon for a section based on its (Arabic) title. */
export function sectionIconName(title: string): MCIName {
  for (const [pattern, icon] of KEYWORD_ICONS) {
    if (pattern.test(title)) return icon;
  }
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0;
  return FALLBACK_ICONS[Math.abs(hash) % FALLBACK_ICONS.length]!;
}
