/**
 * Android fixed-height field fix (2026-11-18): with the phone's font size raised,
 * Android's default EditText padding left no room in our 42–46 px single-line
 * fields and the text was cut from the top (phone digits, «اسمك», hints).
 * The shared TextInput zeroes the vertical padding for exactly those fields.
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  TextInput: () => null,
  StyleSheet: {
    flatten: (s: unknown): Record<string, unknown> =>
      Array.isArray(s) ? Object.assign({}, ...s.map((x) => x ?? {})) : ((s as Record<string, unknown>) ?? {}),
  },
}));

import { needsFixedHeightFix } from '../TextInput';

const field = { height: 42, borderWidth: 1, paddingHorizontal: 14, fontSize: 14 };

test('a fixed-height single-line field on Android gets the fix', () => {
  expect(needsFixedHeightFix({ style: field }, 'android')).toBe(true);
  expect(needsFixedHeightFix({ style: [field, { color: 'red' }] }, 'android')).toBe(true);
});

test('multi-line, free-height and self-padded fields are left alone', () => {
  expect(needsFixedHeightFix({ style: field, multiline: true }, 'android')).toBe(false);
  expect(needsFixedHeightFix({ style: { minHeight: 42 } }, 'android')).toBe(false);
  expect(needsFixedHeightFix({ style: { ...field, paddingVertical: 6 } }, 'android')).toBe(false);
  expect(needsFixedHeightFix({ style: { ...field, padding: 8 } }, 'android')).toBe(false);
  expect(needsFixedHeightFix({ style: { ...field, paddingTop: 4 } }, 'android')).toBe(false);
});

test('iOS and web are untouched', () => {
  expect(needsFixedHeightFix({ style: field }, 'ios')).toBe(false);
  expect(needsFixedHeightFix({ style: field }, 'web')).toBe(false);
});
