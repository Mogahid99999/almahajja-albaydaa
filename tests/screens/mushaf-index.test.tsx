/**
 * Mushaf index — regressions found on a real Android phone (2026-10-26):
 *  - switching to «الأجزاء» crashed («Changing numColumns on the fly is not
 *    supported»): the juz grid (5 columns) reused the one-column list;
 *  - the search box must stay the SAME input while typing (a remount dropped
 *    its focus, so the first tap on a result only closed the keyboard);
 *  - the source attribution sits at the end of the index.
 */
import { fireEvent, render } from '@testing-library/react-native';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/hooks/useMiniPlayerPad', () => ({ useMiniPlayerPad: () => 0 }));
jest.mock('@/mushaf/usage', () => ({ touchMushafUsage: jest.fn() }));
jest.mock('@/mushaf/pack', () => {
  const state = { status: { state: 'ready', version: 'v1' } };
  const usePackStore = (sel: (s: typeof state) => unknown) => sel(state);
  usePackStore.getState = () => state;
  return { usePackStore, initPack: jest.fn(async () => {}) };
});

import MushafIndex from '../../app/(student)/mushaf';

test('switching السور → الأجزاء → العلامات → السور does not crash', async () => {
  const { getByText, getByLabelText } = await render(<MushafIndex />);
  expect(getByText('البقرة')).toBeTruthy();
  await fireEvent.press(getByText('الأجزاء'));
  expect(getByLabelText('الجزء ٣٠')).toBeTruthy();
  await fireEvent.press(getByText('العلامات'));
  await fireEvent.press(getByText('السور'));
  expect(getByText('الفاتحة')).toBeTruthy();
});

test('typing a search keeps the same input (no remount) and shows live results', async () => {
  const { getByLabelText, getByText } = await render(<MushafIndex />);
  const before = getByLabelText('اسم السورة أو رقم الصفحة');
  await fireEvent.changeText(before, '50');
  expect(getByText('الانتقال إلى الصفحة ٥٠')).toBeTruthy();
  expect(getByLabelText('اسم السورة أو رقم الصفحة')).toBe(before);
});

test('the attribution to the King Fahd Complex is at the end of the index', async () => {
  const { getAllByText } = await render(<MushafIndex />);
  expect(getAllByText(/مجمع الملك فهد لطباعة المصحف الشريف/).length).toBeGreaterThan(0);
});
