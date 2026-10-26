/**
 * Regression (device, 2026-10-26): the pager reuses its three slots across
 * turns, so a page component can receive a NEW page whose Madinah font is not
 * registered yet. A «ready» flag remembered from the previous page drew the new
 * page's glyph codes with no font — parts of the page showed blank and never
 * redrew. Readiness must always be the CURRENT page's font.
 */
import { act, render } from '@testing-library/react-native';

const mockLoaded = new Set<number>();
const mockPending = new Map<number, () => void>();
jest.mock('@/mushaf/qcfFonts', () => ({
  qcfFamily: (p: number) => `QCF_P${p}`,
  isPageFontLoaded: (p: number) => mockLoaded.has(p),
  ensurePageFont: (_uri: string, p: number) =>
    new Promise<void>((resolve) => {
      mockPending.set(p, () => {
        mockLoaded.add(p);
        resolve();
      });
    }),
}));

import { MushafPage } from '../MushafPage';

// A glyph index where every line of page p reads «Pp-<line>».
const glyphs = {
  v: 1,
  fx: { width: 340, font: 21, gap: 2 },
  shrink: {},
  pages: Array.from({ length: 604 }, (_, i) => Array.from({ length: 15 }, (_, l) => `P${i + 1}-${l + 1}`)),
};
const text = Array.from({ length: 6236 }, () => 'ا');
const props = { mode: 'print' as const, level: 0, text, glyphs, packUri: 'file:///pack', width: 360, height: 640 };

test('a reused page component never draws a page whose font is not loaded yet', async () => {
  mockLoaded.add(50);
  const view = await render(<MushafPage {...props} page={50} />);
  expect(view.queryAllByText(/^P50-/).length).toBeGreaterThan(0);

  // Same component, next page, font NOT loaded: nothing of page 51 is drawn yet…
  await view.rerender(<MushafPage {...props} page={51} />);
  expect(view.queryAllByText(/^P51-/)).toHaveLength(0);
  expect(view.queryAllByText(/^P50-/)).toHaveLength(0);

  // …and it is drawn as soon as the font is registered.
  await act(async () => mockPending.get(51)!());
  expect(view.queryAllByText(/^P51-/).length).toBeGreaterThan(0);
});
