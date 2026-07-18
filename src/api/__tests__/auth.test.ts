/**
 * src/api/auth.ts — normalizePhone. Country code used to be guessed from
 * digit length/prefix alone (always defaulting to Sudan's "249"), which
 * silently mis-normalized any non-Sudan number of the same length (e.g. a
 * 9-digit Saudi number). Every phone entry point now has a country picker
 * (`PhoneInput`) and passes its selection explicitly.
 */
import { normalizePhone } from '../auth';

describe('normalizePhone', () => {
  test('defaults to Sudan (249) when no country code is passed', () => {
    expect(normalizePhone('0912345678')).toBe('249912345678');
    expect(normalizePhone('912345678')).toBe('249912345678');
  });

  test('applies an explicit non-Sudan country code instead of guessing 249', () => {
    // A 9-digit Saudi number is the same length as a 9-digit Sudanese one —
    // this is exactly the ambiguity that made the app mis-tag Saudi sign-ups.
    expect(normalizePhone('0512345678', '966')).toBe('966512345678');
    expect(normalizePhone('512345678', '966')).toBe('966512345678');
  });

  test('strips a leading local trunk "0" before prepending the country code', () => {
    expect(normalizePhone('0501234567', '971')).toBe('971501234567');
  });

  test('leaves a number that already carries the given country code untouched', () => {
    expect(normalizePhone('966512345678', '966')).toBe('966512345678');
  });

  test('leaves a long number untouched even with a different selected code', () => {
    // >9 digits after stripping a leading 0 is treated as already carrying a
    // country code, regardless of which one is currently selected.
    expect(normalizePhone('+249 91 234 5678', '966')).toBe('249912345678');
  });

  test('strips non-digit formatting characters', () => {
    expect(normalizePhone('+966 51-234-5678', '966')).toBe('966512345678');
  });

  test('returns an empty string for empty input', () => {
    expect(normalizePhone('', '966')).toBe('');
  });
});
