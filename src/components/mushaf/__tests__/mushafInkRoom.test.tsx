/**
 * Regression (a student's report, 2026-11-21): in the downloaded Madinah mushaf
 * the start of some words was cut off — the first diacritics half shown, the
 * hamza/alef of «إِبْرَٰهِيمَ» / «ٱلْأَرْضُ» missing, an initial ي with one dot.
 * Android clips a Text to its own content box, and the fonts draw past a word's
 * advance (Madinah ≤ 0.51 em, Hafs marks ≤ 0.93 em — measured over all 604 pages).
 * Every drawn word therefore carries no-break spaces of ink room on both sides,
 * cancelled by equal negative margins, in all three modes.
 */
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
type Node = ReturnType<Awaited<ReturnType<typeof render>>['getByText']>;

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
const text = Array.from({ length: 6236 }, (_, g) => `kalima${g}`);
const NBSP_EM = 450 / 2048;

/** The ink-room box around a drawn word: the nearest enclosing host Text. */
function roomBox(word: Node) {
  let box = word.parent!;
  while (box.type !== 'Text') box = box.parent!;
  return box;
}

function expectRoom(word: Node, spaces: number, size: number) {
  const box = roomBox(word);
  const pad = String.fromCharCode(0xa0).repeat(spaces);
  const kids = box.props.children as unknown[];
  expect(kids[0]).toBe(pad);
  expect(kids[kids.length - 1]).toBe(pad);
  const style = StyleSheet.flatten(box.props.style);
  expect(style.fontFamily).toBe('UthmanicHafsV22'); // the spaces' width is known only in this font
  expect(style.marginHorizontal).toBeCloseTo(-size * NBSP_EM * spaces, 5);
  expect(style.paddingVertical).toBeCloseTo(-style.marginVertical, 5);
}

const base = { level: 0, text, glyphs, packUri: 'file:///pack', width: 360, height: 640 };

test('Madinah words: 3 spaces (0.66 em) of room each side, in place', async () => {
  const view = await render(<MushafPage {...base} page={205} mode="print" />);
  const word = view.getByText('W205-10a');
  expectRoom(word, 3, 21);
  expect(StyleSheet.flatten(word.props.style).fontFamily).toBe('QCF_P205');
});

test('simplified words: 5 spaces (1.1 em) of room each side', async () => {
  const view = await render(<MushafPage {...base} page={205} mode="simple" />);
  const word = view.getAllByText(/^kalima\d+$/)[0];
  expectRoom(word, 5, StyleSheet.flatten(roomBox(word).props.style).fontSize as number);
});

test('enlarged reading draws each word in its own box (no paragraph edge to cut a line end)', async () => {
  const view = await render(<MushafPage {...base} page={205} mode="flex" />);
  const words = view.getAllByText(/^kalima\d+$/);
  expect(words.length).toBeGreaterThan(1);
  for (const w of words.slice(0, 5)) expectRoom(w, 5, 20.5);
});

test('a sura header is one stretched, centered string (Android dropped the name — pages 262, 434, 467, 523…)', async () => {
  const view = await render(<MushafPage {...base} page={2} mode="print" />);
  // The page frame names the sura too; the in-text header is the one with a break strategy.
  const header = view.getAllByText(/^سُورَةُ \S+$/).find((t) => t.props.textBreakStrategy)!;
  expect(header).toBeDefined();
  const style = StyleSheet.flatten(header.props.style);
  expect(style.alignSelf).toBe('stretch');
  expect(style.textAlign).toBe('center');
  expect(header.props.textBreakStrategy).toBe('simple');
});
