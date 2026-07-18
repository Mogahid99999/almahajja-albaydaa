/**
 * Country calling codes for the phone-registration country picker (see
 * `src/components/ui/PhoneInput.tsx`). Arab/Muslim-majority countries first
 * (Sudan default, then the Gulf, Levant, and North Africa — the app's actual
 * user base), then a short tail of other common countries.
 */
export type Country = {
  /** Dial code digits, no `+` (e.g. "249"). */
  code: string;
  name: string;
  flag: string;
};

export const DEFAULT_COUNTRY_CODE = '249';

export const COUNTRIES: Country[] = [
  { code: '249', name: 'السودان', flag: '🇸🇩' },
  { code: '966', name: 'السعودية', flag: '🇸🇦' },
  { code: '971', name: 'الإمارات', flag: '🇦🇪' },
  { code: '20', name: 'مصر', flag: '🇪🇬' },
  { code: '218', name: 'ليبيا', flag: '🇱🇾' },
  { code: '212', name: 'المغرب', flag: '🇲🇦' },
  { code: '213', name: 'الجزائر', flag: '🇩🇿' },
  { code: '216', name: 'تونس', flag: '🇹🇳' },
  { code: '968', name: 'عُمان', flag: '🇴🇲' },
  { code: '974', name: 'قطر', flag: '🇶🇦' },
  { code: '973', name: 'البحرين', flag: '🇧🇭' },
  { code: '965', name: 'الكويت', flag: '🇰🇼' },
  { code: '962', name: 'الأردن', flag: '🇯🇴' },
  { code: '961', name: 'لبنان', flag: '🇱🇧' },
  { code: '963', name: 'سوريا', flag: '🇸🇾' },
  { code: '964', name: 'العراق', flag: '🇮🇶' },
  { code: '967', name: 'اليمن', flag: '🇾🇪' },
  { code: '970', name: 'فلسطين', flag: '🇵🇸' },
  { code: '252', name: 'الصومال', flag: '🇸🇴' },
  { code: '253', name: 'جيبوتي', flag: '🇩🇯' },
  { code: '222', name: 'موريتانيا', flag: '🇲🇷' },
  { code: '90', name: 'تركيا', flag: '🇹🇷' },
  { code: '92', name: 'باكستان', flag: '🇵🇰' },
  { code: '91', name: 'الهند', flag: '🇮🇳' },
  { code: '60', name: 'ماليزيا', flag: '🇲🇾' },
  { code: '62', name: 'إندونيسيا', flag: '🇮🇩' },
  { code: '234', name: 'نيجيريا', flag: '🇳🇬' },
  { code: '44', name: 'المملكة المتحدة', flag: '🇬🇧' },
  { code: '1', name: 'الولايات المتحدة وكندا', flag: '🇺🇸' },
  { code: '49', name: 'ألمانيا', flag: '🇩🇪' },
  { code: '33', name: 'فرنسا', flag: '🇫🇷' },
  { code: '61', name: 'أستراليا', flag: '🇦🇺' },
];

export function findCountry(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

/**
 * Best-effort split of an already-stored, full E.164-ish digit string (e.g.
 * "966512345678") back into a country code + local number, for pre-filling
 * `PhoneInput` in edit screens (profile phone change, admin user detail).
 * Longest-code-first so "20" (Egypt) never shadows a longer match.
 */
export function splitPhone(stored: string): { countryCode: string; local: string } {
  const digits = (stored || '').replace(/[^0-9]/g, '');
  if (!digits) return { countryCode: DEFAULT_COUNTRY_CODE, local: '' };
  const match = [...COUNTRIES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => digits.startsWith(c.code));
  return match
    ? { countryCode: match.code, local: digits.slice(match.code.length) }
    : { countryCode: DEFAULT_COUNTRY_CODE, local: digits };
}
