/**
 * deriveAvailability — the client mirror of the server quiz_availability()
 * (migration 0118). This is the Test Availability Control feature: the four
 * effective states an admin-set mode + window collapse to, which drive the
 * student gate and the admin pills. Boundary behaviour must match the server
 * (strict < / >, a missing bound is open on that side).
 */
import { deriveAvailability, QUIZ_AVAILABILITY_META } from '../quizAvailability';

const T0 = Date.parse('2026-08-01T20:00:00.000Z'); // window start
const T1 = Date.parse('2026-08-01T22:00:00.000Z'); // window end
const from = new Date(T0).toISOString();
const until = new Date(T1).toISOString();

describe('deriveAvailability — modes', () => {
  test("'open' mode is always open, even with a stale window set", () => {
    expect(deriveAvailability('open', from, until, T1 + 10_000_000)).toBe('open');
  });

  test("'closed' mode is always closed, even inside a live window", () => {
    expect(deriveAvailability('closed', from, until, (T0 + T1) / 2)).toBe('closed');
  });
});

describe('deriveAvailability — scheduled window', () => {
  test('before the start → scheduled (not started yet)', () => {
    expect(deriveAvailability('scheduled', from, until, T0 - 60_000)).toBe('scheduled');
  });

  test('inside the window → open', () => {
    expect(deriveAvailability('scheduled', from, until, (T0 + T1) / 2)).toBe('open');
  });

  test('after the end → expired', () => {
    expect(deriveAvailability('scheduled', from, until, T1 + 60_000)).toBe('expired');
  });

  test('exactly at the start is already open (strict <, matches server)', () => {
    expect(deriveAvailability('scheduled', from, until, T0)).toBe('open');
  });

  test('exactly at the end is still open (strict >, matches server)', () => {
    expect(deriveAvailability('scheduled', from, until, T1)).toBe('open');
  });

  test('open-ended start (only an end bound) is available until it expires', () => {
    expect(deriveAvailability('scheduled', null, until, T0 - 60_000)).toBe('open');
    expect(deriveAvailability('scheduled', null, until, T1 + 60_000)).toBe('expired');
  });

  test('open-ended finish (only a start bound) stays open forever after it opens', () => {
    expect(deriveAvailability('scheduled', from, null, T0 - 60_000)).toBe('scheduled');
    expect(deriveAvailability('scheduled', from, null, T1 + 10_000_000)).toBe('open');
  });
});

describe('availability pill copy is Arabic (no English leakage)', () => {
  test('every state has calm Arabic label', () => {
    expect(QUIZ_AVAILABILITY_META.open.label).toBe('مفتوح');
    expect(QUIZ_AVAILABILITY_META.closed.label).toBe('مغلق');
    expect(QUIZ_AVAILABILITY_META.scheduled.label).toBe('مجدوَل');
    expect(QUIZ_AVAILABILITY_META.expired.label).toBe('منتهٍ');
    for (const meta of Object.values(QUIZ_AVAILABILITY_META)) {
      expect(meta.label).not.toMatch(/[a-zA-Z]/);
    }
  });
});
