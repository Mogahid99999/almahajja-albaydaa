/**
 * ISO country code → flag + Arabic name, for «الطلاب حسب الدول» and the users-page country filter.
 * The codes come from the server (public.phone_country, migration 0165: the calling code at the
 * start of the stored phone). 'ZZ' = a phone with no recognisable calling code («غير محدد»).
 *
 * No dependency: Arabic names come from the registration picker's list (src/constants/countries.ts,
 * keyed by its flag), then the platform's CLDR names (Intl.DisplayNames — every browser, Node),
 * then the bare code. Never throws.
 */
import { COUNTRIES } from '@/constants/countries';

export const UNKNOWN_COUNTRY = 'ZZ';

const REGIONAL_A = 0x1f1e6;
const isIso = (code: string) => /^[A-Z]{2}$/.test(code);

/** 🇸🇩 → "SD" (the picker list carries flags, not ISO codes). */
function isoFromFlag(flag: string): string | null {
  const cps = Array.from(flag).map((c) => c.codePointAt(0) ?? 0);
  if (cps.length !== 2 || cps.some((cp) => cp < REGIONAL_A || cp > REGIONAL_A + 25)) return null;
  return String.fromCharCode(...cps.map((cp) => cp - REGIONAL_A + 65));
}

const PICKER_NAMES: Record<string, string> = Object.fromEntries(
  COUNTRIES.flatMap((c) => {
    const iso = isoFromFlag(c.flag);
    return iso ? [[iso, c.name] as const] : [];
  }),
);

let displayNames: { of(code: string): string | undefined } | null | undefined;
function cldrName(code: string): string | undefined {
  if (displayNames === undefined) {
    try {
      const DN = (Intl as unknown as { DisplayNames?: new (l: string[], o: object) => typeof displayNames })
        .DisplayNames;
      displayNames = DN ? new DN(['ar'], { type: 'region', fallback: 'none' }) : null;
    } catch {
      displayNames = null;
    }
  }
  try {
    return displayNames?.of(code) || undefined;
  } catch {
    return undefined;
  }
}

export function countryName(code: string): string {
  const c = (code || '').toUpperCase();
  if (!isIso(c) || c === UNKNOWN_COUNTRY) return 'غير محدد';
  return PICKER_NAMES[c] ?? cldrName(c) ?? c;
}

export function countryFlag(code: string): string {
  const c = (code || '').toUpperCase();
  if (!isIso(c) || c === UNKNOWN_COUNTRY) return '🌐';
  return String.fromCodePoint(...Array.from(c).map((ch) => REGIONAL_A + ch.charCodeAt(0) - 65));
}

export function countryLabel(code: string): string {
  return `${countryFlag(code)} ${countryName(code)}`;
}

/** `?country=SD` (or `sd`) → 'SD'; anything that isn't a 2-letter code → no country filter. */
export function parseCountryParam(raw: string | string[] | undefined): string | undefined {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  return v && /^[A-Z]{2}$/.test(v) ? v : undefined;
}
