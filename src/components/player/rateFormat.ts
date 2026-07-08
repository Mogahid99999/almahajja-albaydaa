import { toArabicDigits } from '@/lib/format';

/** Format a playback rate as Arabic-Indic with ٫ decimal, e.g. 0.8→"٠٫٨×", 1→"١٫٠×". */
export function formatRate(rate: number): string {
  const str = rate.toFixed(1);
  return `${toArabicDigits(str.replace('.', '٫'))}×`;
}
