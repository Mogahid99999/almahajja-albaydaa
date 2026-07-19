/**
 * Month-grid helpers for «سجل النشاط» (V20 · §7). Pure + timezone-neutral (works
 * on YYYY-MM-DD strings), so they're unit-testable. The calendar is RTL: weeks
 * read right-to-left, starting Saturday (the app's week anchor).
 */

/** YYYY-MM-DD for a given year/month(0-based)/day. */
function ymd(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days in a month (m0 = 0-based month). */
export function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

/**
 * The leading blank count so day 1 lands under the correct weekday column, with
 * SATURDAY as the first column (Sat=0…Fri=6, matching the app's Sat→Fri week).
 * `getDay()`: Sun=0..Sat=6 → shift so Sat=0.
 */
export function leadingBlanks(y: number, m0: number): number {
  const firstDow = new Date(y, m0, 1).getDay(); // 0=Sun..6=Sat
  return (firstDow + 1) % 7; // Sat→0, Sun→1, …, Fri→6
}

/**
 * A flat cell list for the month grid: `leadingBlanks` nulls, then each day's
 * YYYY-MM-DD string. The caller pads the tail to fill the last row of 7.
 */
export function monthCells(y: number, m0: number): (string | null)[] {
  const cells: (string | null)[] = [];
  for (let i = 0; i < leadingBlanks(y, m0); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(y, m0); d++) cells.push(ymd(y, m0, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Weekday headers, Saturday-first, short Arabic. */
export const WEEKDAY_HEADERS_AR = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

/** Arabic month names (0-based). */
const MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** "يوليو ٢٠٢٦" for a YYYY-MM anchor. */
export function monthLabel(y: number, m0: number): string {
  const yearAr = String(y).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
  return `${MONTHS_AR[m0]} ${yearAr}`;
}

/** Shift a {y, m0} by ±1 month, normalizing the year. */
export function shiftMonth(y: number, m0: number, delta: number): { y: number; m0: number } {
  const total = y * 12 + m0 + delta;
  return { y: Math.floor(total / 12), m0: ((total % 12) + 12) % 12 };
}
