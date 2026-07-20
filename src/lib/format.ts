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

/** "٤٢ يوماً" / "يوم واحد" / "يومان" — Arabic-aware day count label. */
export function arDayCount(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (n >= 3 && n <= 10) return `${arNum(n)} أيام`;
  return `${arNum(n)} يوماً`;
}

/** "٥ أسئلة" / "سؤال واحد" / "سؤالان" — Arabic-aware question count label. */
export function arQuestionCount(n: number): string {
  if (n === 0) return 'لا أسئلة';
  if (n === 1) return 'سؤال واحد';
  if (n === 2) return 'سؤالان';
  if (n >= 3 && n <= 10) return `${arNum(n)} أسئلة`;
  return `${arNum(n)} سؤالاً`;
}

/** "٣ محاولات" / "محاولة واحدة" / "محاولتان" — attempt count label. */
export function arAttemptCount(n: number): string {
  if (n === 0) return 'لا محاولات';
  if (n === 1) return 'محاولة واحدة';
  if (n === 2) return 'محاولتان';
  if (n >= 3 && n <= 10) return `${arNum(n)} محاولات`;
  return `${arNum(n)} محاولة`;
}

/** "١٠ دقائق" / "دقيقة واحدة" / "دقيقتان" — minute count label. */
export function arMinuteCount(n: number): string {
  if (n === 1) return 'دقيقة واحدة';
  if (n === 2) return 'دقيقتان';
  if (n >= 3 && n <= 10) return `${arNum(n)} دقائق`;
  return `${arNum(n)} دقيقة`;
}

/** ISO timestamp → "٢٠٢٦/٧/٣" (Arabic-Indic digits, "—" when null). */
export function arDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return toArabicDigits(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
}

/** Date + 24h time, e.g. «٢٠٢٦/٨/١ - ٢٠:٠٠». For quiz availability windows. */
export function arDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return toArabicDigits(`${date} - ${time}`);
}

/** Friendly "آخر دخول": اليوم / أمس / منذ ن يوماً / a date for older. */
export function arSince(iso: string | null | undefined): string {
  if (!iso) return 'لم يدخل بعد';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days === 2) return 'منذ يومين';
  if (days <= 10) return `منذ ${arNum(days)} أيام`;
  if (days < 30) return `منذ ${arNum(days)} يوماً`;
  return arDate(iso);
}

/** Bytes → "٢٤٫٨ ميجابايت" style size label. */
export function arFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const text = mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
  return `${toArabicDigits(text.replace('.', '٫'))} ميجابايت`;
}

/** Bytes/sec → "١٫٢ م.ب/ث" compact download-speed label (in-progress download row). */
export function arDownloadSpeed(bytesPerSec: number): string {
  const mb = Math.max(0, bytesPerSec) / (1024 * 1024);
  const text = mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
  return `${toArabicDigits(text.replace('.', '٫'))} م.ب/ث`;
}
