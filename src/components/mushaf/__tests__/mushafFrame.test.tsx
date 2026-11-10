/**
 * The page frame only adds margin around the untouched 340×588 text box: it
 * must fit every screen, keep the box's proportions, and never squeeze it.
 */
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { MushafSheet, juzTitle, sheetGeometry, TEXT_H, TEXT_W } from '../MushafFrame';

const SCREENS: [string, number, number][] = [
  ['small', 320, 500],
  ['A54', 384, 700],
  ['tall', 412, 820],
  ['tablet', 800, 1100],
];

test.each(SCREENS)('the sheet fits a %s screen with the text box inside a real margin', (_n, w, h) => {
  const g = sheetGeometry(w, h);
  expect(g.sheetW * g.k).toBeLessThanOrEqual(w);
  expect(g.sheetH * g.k).toBeLessThanOrEqual(h);
  // The frame surrounds exactly the text box, with space on every side.
  expect(g.frameW - 2 * (g.band + g.padX)).toBe(TEXT_W);
  expect(g.frameH - 2 * (g.band + g.padY)).toBe(TEXT_H);
  expect(g.padX).toBeGreaterThanOrEqual(8);
  expect(g.padY).toBeGreaterThanOrEqual(10);
});

test('narrow screens get the slimmer margins', () => {
  expect(sheetGeometry(320, 600).compact).toBe(true);
  expect(sheetGeometry(384, 700).compact).toBe(false);
});

test('juz titles in words, 1 to 30', () => {
  expect(juzTitle(1)).toBe('الجزء الأول');
  expect(juzTitle(10)).toBe('الجزء العاشر');
  expect(juzTitle(11)).toBe('الجزء الحادي عشر');
  expect(juzTitle(12)).toBe('الجزء الثاني عشر');
  expect(juzTitle(20)).toBe('الجزء العشرون');
  expect(juzTitle(21)).toBe('الجزء الحادي والعشرون');
  expect(juzTitle(29)).toBe('الجزء التاسع والعشرون');
  expect(juzTitle(30)).toBe('الجزء الثلاثون');
  for (let j = 1; j <= 30; j++) expect(juzTitle(j)).not.toMatch(/undefined/);
});

test('the sheet shows the sura, the juz and the page number around the text', async () => {
  const view = await render(
    <MushafSheet geo={sheetGeometry(384, 700)} page={3} suraTitle="سُورَةُ البقرة" juz={1}>
      <Text>نص الصفحة</Text>
    </MushafSheet>,
  );
  expect(view.getByText('سُورَةُ البقرة')).toBeTruthy();
  expect(view.getByText('الجزء الأول')).toBeTruthy();
  expect(view.getByText('٣')).toBeTruthy();
  expect(view.getByText('نص الصفحة')).toBeTruthy();
});
