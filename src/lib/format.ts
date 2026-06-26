/**
 * Formatting helpers — Arabic-Indic numerals everywhere (PRD §10 design notes,
 * README › Localization). Use these instead of hardcoding ٠١٢٣ glyphs or raw
 * `String(n)`, so digits stay locale-correct and tabular.
 */

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Convert any string's ASCII digits to Arabic-Indic. */
export function toArabicDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);
}

/** Integer with Arabic-Indic digits (e.g. 42 → "٤٢"). */
export function arNum(n: number): string {
  return toArabicDigits(Math.round(n));
}

/** Percentage like "٣٨٪". */
export function arPercent(pct: number): string {
  return `${toArabicDigits(Math.round(pct))}٪`;
}

/** Seconds → "mm:ss" (or "h:mm:ss") in Arabic-Indic digits, e.g. 1122 → "١٨:٤٢". */
export function arDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const core = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  return toArabicDigits(core);
}

/** "٤٢ درساً" / "درس واحد" / "درسان" — Arabic-aware lecture count label. */
export function arLectureCount(n: number): string {
  if (n === 0) return 'لا محاضرات';
  if (n === 1) return 'محاضرة واحدة';
  if (n === 2) return 'محاضرتان';
  if (n >= 3 && n <= 10) return `${arNum(n)} محاضرات`;
  return `${arNum(n)} محاضرة`;
}

/** Bytes → "٢٤٫٨ ميجابايت" style size label. */
export function arFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const text = mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
  return `${toArabicDigits(text.replace('.', '٫'))} ميجابايت`;
}
