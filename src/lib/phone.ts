/**
 * Phone numbers. New numbers are always stored in international form, parsed by
 * libphonenumber. GoTrue accepts "+2348012345678" and keeps the digits, so
 * auth.users.phone holds "2348012345678".
 *
 * Older accounts can hold a number with no calling code (anything longer than
 * nine digits used to be stored as typed), so sign-in also tries that old form.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

const toAsciiDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

const digitsOf = (s: string) => toAsciiDigits(s).replace(/[^0-9]/g, '');

const LEGACY_DEFAULT_CODE = '249';

/** "+<code><number>" from what was typed and the chosen dial code, or null if impossible. */
export function toInternationalPhone(raw: string, dialCode: string): string | null {
  const digits = digitsOf(raw);
  if (!digits) return null;
  const typedInternational = /^\s*(\+|00)/.test(toAsciiDigits(raw));
  const national = parsePhoneNumberFromString(digits, { defaultCallingCode: dialCode });
  const full = digits.startsWith(dialCode)
    ? parsePhoneNumberFromString(`+${digits}`)
    : undefined;
  const typed = typedInternational
    ? parsePhoneNumberFromString(`+${digits.replace(/^00/, '')}`)
    : undefined;
  // Validity first; length-only acceptance last, so a new number range the
  // metadata does not know yet is not refused.
  const best =
    (typed?.isValid() && typed) ||
    (national?.isValid() && national) ||
    (full?.isValid() && full) ||
    (typed?.isPossible() && typed) ||
    (national?.isPossible() && national) ||
    null;
  return best ? best.number : null;
}

export function isPhoneEntryValid(raw: string, dialCode: string): boolean {
  return toInternationalPhone(raw, dialCode) !== null;
}

/** The old storage rule. Only sign-in still needs it, to reach accounts stored that way. */
export function normalizePhone(raw: string, countryCode: string = LEGACY_DEFAULT_CODE): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return digits;
  const local = digits.startsWith('0') ? digits.slice(1) : digits;
  if (local.startsWith(countryCode) || local.length > 9) return local;
  return countryCode + local;
}

/** Stored forms this sign-in entry could be, most likely first, without repeats. */
export function phoneLoginCandidates(raw: string, dialCode: string = LEGACY_DEFAULT_CODE): string[] {
  const ascii = toAsciiDigits(raw);
  const international = toInternationalPhone(ascii, dialCode);
  const legacy = normalizePhone(ascii);
  const out = [international ? digitsOf(international) : '', legacy];
  // A national Egyptian mobile: the one shape that identifies its country alone.
  if (/^1[0125]\d{8}$/.test(legacy)) out.push(`20${legacy}`);
  return [...new Set(out.filter(Boolean))];
}
