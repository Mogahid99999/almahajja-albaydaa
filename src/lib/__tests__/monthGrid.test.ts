/**
 * src/lib/monthGrid.ts — «سجل النشاط» month layout (V20 · §7). Pins the Sat-first
 * RTL week alignment and month arithmetic.
 */
import {
  daysInMonth,
  leadingBlanks,
  monthCells,
  shiftMonth,
} from '../monthGrid';

test('daysInMonth handles month lengths incl. leap Feb', () => {
  expect(daysInMonth(2026, 0)).toBe(31); // Jan
  expect(daysInMonth(2026, 1)).toBe(28); // Feb 2026 (not leap)
  expect(daysInMonth(2024, 1)).toBe(29); // Feb 2024 (leap)
  expect(daysInMonth(2026, 3)).toBe(30); // Apr
});

test('leadingBlanks aligns day 1 under the Saturday-first column', () => {
  // 2026-07-01 is a Wednesday. Sat-first index of Wed = 4 blanks before it.
  expect(leadingBlanks(2026, 6)).toBe(4);
  // 2026-08-01 is a Saturday → 0 blanks.
  expect(leadingBlanks(2026, 7)).toBe(0);
});

test('monthCells pads to whole weeks of 7', () => {
  const cells = monthCells(2026, 6); // July 2026: 31 days + 4 lead
  expect(cells.length % 7).toBe(0);
  expect(cells.filter((c) => c !== null)).toHaveLength(31);
  // First non-null is the 1st, at index = leadingBlanks.
  expect(cells[4]).toBe('2026-07-01');
});

test('shiftMonth rolls the year over correctly', () => {
  expect(shiftMonth(2026, 11, 1)).toEqual({ y: 2027, m0: 0 }); // Dec → Jan
  expect(shiftMonth(2026, 0, -1)).toEqual({ y: 2025, m0: 11 }); // Jan → Dec
  expect(shiftMonth(2026, 6, -3)).toEqual({ y: 2026, m0: 3 }); // Jul → Apr
});
