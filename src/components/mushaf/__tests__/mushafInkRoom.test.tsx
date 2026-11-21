/**
 * Regression (a student's report, 2026-11-21): in the downloaded Madinah mushaf
 * the start of some words was cut off — the first diacritics half shown, the
 * hamza/alef of «إِبْرَٰهِيمَ» / «ٱلْأَرْضُ» missing, an initial ي with one dot.
 * The page fonts draw up to 0.68 em past a word's advance on its start side and
 * Android clips a Text to its own content box. Every drawn word therefore carries
 * no-break spaces of ink room on both sides, cancelled by an equal negative margin.
 */
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

jest.mock('@/mushaf/qcfFonts', () => ({
  qcfFamily: (p: number) => `QCF_P${p}`,
  isPageFontLoaded: () => true,
  ensurePageFont: () => Promise.resolve(),
}));

import { MushafPage } from '../MushafPage';

const glyphs = {
  v: 1,
  fx: { width: 340, font: 21, gap: 2 },
  shrink: {},
  pages: Array.from({ length: 604 }, (_, i) => Array.from({ length: 15 }, (_, l) => `W${i + 1}-${l + 1}a W${i + 1}-${l + 1}b`)),
};
const text = Array.from({ length: 6236 }, () => 'ا');

test('every Madinah word has ink room on both sides and keeps its place', async () => {
  const view = await render(
    <MushafPage page={205} mode="print" level={0} text={text} glyphs={glyphs} packUri="file:///pack" width={360} height={640} />,
  );
  const word = view.getByText('W205-10a');
  // The nearest enclosing host Text: the ink-room box.
  let box = word.parent!;
  while (box.type !== 'Text') box = box.parent!;
  const room = ' '.repeat(4);
  const kids = box.props.children as unknown[];
  expect(kids[0]).toBe(room);
  expect(kids[kids.length - 1]).toBe(room);

  const style = StyleSheet.flatten(box.props.style);
  expect(style.fontFamily).toBe('UthmanicHafsV22'); // the spaces' width is known only in this font
  // 4 Hafs spaces = 4 × 450/2048 em, removed again by the margin so the line doesn't move.
  expect(style.marginHorizontal).toBeCloseTo(-21 * ((4 * 450) / 2048), 5);
  expect(StyleSheet.flatten(word.props.style).fontFamily).toBe('QCF_P205');
});
