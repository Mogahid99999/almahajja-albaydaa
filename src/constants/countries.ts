/**
 * Every country with an international calling code, for the phone picker
 * (src/components/ui/PhoneInput.tsx) and the admin country views. The table is
 * generated; see scripts/generate-countries.mjs.
 */
import { GENERATED_COUNTRIES, PRIMARY_ISO } from './countries.generated';

export type Country = {
  /** ISO 3166 alpha-2, unique per row: several countries can share a calling code. */
  iso: string;
  /** Dial code digits, no `+` (e.g. "249"). */
  code: string;
  name: string;
  en: string;
  flag: string;
  /** Possible national number lengths, from libphonenumber. */
  lengths: number[];
};

export const DEFAULT_COUNTRY_CODE = '249';

export const COUNTRIES: Country[] = GENERATED_COUNTRIES;

export function findCountry(code: string): Country {
  const primary = PRIMARY_ISO[code];
  return (
    (primary && COUNTRIES.find((c) => c.iso === primary)) ||
    COUNTRIES.find((c) => c.code === code) ||
    COUNTRIES[0]
  );
}

const ARABIC_DIGITS = /[٠-٩]/g;

/** Folds spelling differences a person should not have to match exactly. */
function foldName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

const SEARCH_INDEX = COUNTRIES.map((c) => ({
  country: c,
  text: `${foldName(c.name)} ${foldName(c.en)} ${c.iso.toLowerCase()}`,
}));

/** By Arabic or English name, or by calling code («249», «+249», «٢٤٩»). */
export function searchCountries(query: string): Country[] {
  const ascii = query.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
  const digits = ascii.replace(/[\s+]/g, '');
  if (/^\d+$/.test(digits)) return COUNTRIES.filter((c) => c.code.startsWith(digits));
  const q = foldName(ascii);
  if (!q) return COUNTRIES;
  const withoutArticle = q.startsWith('ال') ? q.slice(2) : q;
  return SEARCH_INDEX.filter((x) => x.text.includes(q) || x.text.includes(withoutArticle)).map(
    (x) => x.country,
  );
}

/**
 * Best-effort split of a stored digit string (e.g. "966512345678") back into a
 * country code + local number, for pre-filling `PhoneInput` in edit screens.
 * The remaining digits must be a possible length for that country, so a number
 * stored without its calling code is not mistaken for +1 or +7.
 */
export function splitPhone(stored: string): { countryCode: string; local: string } {
  const digits = (stored || '').replace(/[^0-9]/g, '');
  if (!digits) return { countryCode: DEFAULT_COUNTRY_CODE, local: '' };
  // A national Egyptian mobile from before numbers kept their calling code.
  if (/^1[0125]\d{8}$/.test(digits)) return { countryCode: '20', local: digits };
  const match = [...COUNTRIES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => digits.startsWith(c.code) && c.lengths.includes(digits.length - c.code.length));
  return match
    ? { countryCode: match.code, local: digits.slice(match.code.length) }
    : { countryCode: DEFAULT_COUNTRY_CODE, local: digits };
}
