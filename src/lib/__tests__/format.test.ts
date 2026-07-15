/**
 * src/lib/format.ts — Arabic-Indic numeral + label formatters.
 * Pure functions; the Arabic dual/plural rules here are the same ones whose
 * absence caused audit finding F-044 (StreakRing showed «٢ يوماً» instead of
 * «يومان»).
 */
import {
  arAttemptCount,
  arDate,
  arDayCount,
  arDownloadSpeed,
  arDuration,
  arFileSize,
  arLectureCount,
  arMinuteCount,
  arNum,
  arPercent,
  arQuestionCount,
  arSince,
  toArabicDigits,
} from '../format';

describe('toArabicDigits / arNum / arPercent', () => {
  test('converts every ASCII digit', () => {
    expect(toArabicDigits('0123456789')).toBe('٠١٢٣٤٥٦٧٨٩');
  });

  test('leaves non-digits (Arabic text, punctuation) untouched', () => {
    expect(toArabicDigits('درس 42 / 100')).toBe('درس ٤٢ / ١٠٠');
  });

  test('arNum rounds to nearest integer', () => {
    expect(arNum(2.6)).toBe('٣');
    expect(arNum(2.4)).toBe('٢');
  });

  test('arPercent appends ٪', () => {
    expect(arPercent(38)).toBe('٣٨٪');
    expect(arPercent(99.6)).toBe('١٠٠٪');
  });
});

describe('arDuration', () => {
  test('mm:ss under an hour', () => {
    expect(arDuration(1122)).toBe('١٨:٤٢');
  });

  test('h:mm:ss at an hour and above', () => {
    expect(arDuration(3600)).toBe('١:٠٠:٠٠');
    expect(arDuration(3661)).toBe('١:٠١:٠١');
  });

  test('zero and negative clamp to ٠:٠٠', () => {
    expect(arDuration(0)).toBe('٠:٠٠');
    expect(arDuration(-5)).toBe('٠:٠٠');
  });

  test('fractional seconds floor', () => {
    expect(arDuration(59.9)).toBe('٠:٥٩');
  });
});

describe('Arabic count labels (dual/plural rules)', () => {
  test('arDayCount — واحد / مثنى / جمع قلة / جمع كثرة', () => {
    expect(arDayCount(1)).toBe('يوم واحد');
    expect(arDayCount(2)).toBe('يومان'); // the F-044 regression case
    expect(arDayCount(3)).toBe('٣ أيام');
    expect(arDayCount(10)).toBe('١٠ أيام');
    expect(arDayCount(11)).toBe('١١ يوماً');
    expect(arDayCount(42)).toBe('٤٢ يوماً');
  });

  test('arLectureCount', () => {
    expect(arLectureCount(0)).toBe('لا محاضرات');
    expect(arLectureCount(1)).toBe('محاضرة واحدة');
    expect(arLectureCount(2)).toBe('محاضرتان');
    expect(arLectureCount(7)).toBe('٧ محاضرات');
    expect(arLectureCount(500)).toBe('٥٠٠ محاضرة');
  });

  test('arQuestionCount', () => {
    expect(arQuestionCount(0)).toBe('لا أسئلة');
    expect(arQuestionCount(1)).toBe('سؤال واحد');
    expect(arQuestionCount(2)).toBe('سؤالان');
    expect(arQuestionCount(5)).toBe('٥ أسئلة');
    expect(arQuestionCount(11)).toBe('١١ سؤالاً');
  });

  test('arAttemptCount', () => {
    expect(arAttemptCount(0)).toBe('لا محاولات');
    expect(arAttemptCount(1)).toBe('محاولة واحدة');
    expect(arAttemptCount(2)).toBe('محاولتان');
    expect(arAttemptCount(3)).toBe('٣ محاولات');
    expect(arAttemptCount(12)).toBe('١٢ محاولة');
  });

  test('arMinuteCount', () => {
    expect(arMinuteCount(1)).toBe('دقيقة واحدة');
    expect(arMinuteCount(2)).toBe('دقيقتان');
    expect(arMinuteCount(10)).toBe('١٠ دقائق');
    expect(arMinuteCount(30)).toBe('٣٠ دقيقة');
  });
});

describe('arDate / arSince', () => {
  test('arDate formats ISO timestamps and shields null/garbage with —', () => {
    expect(arDate('2026-07-03T10:00:00Z')).toBe('٢٠٢٦/٧/٣');
    expect(arDate(null)).toBe('—');
    expect(arDate(undefined)).toBe('—');
    expect(arDate('not-a-date')).toBe('—');
  });

  describe('arSince (frozen clock)', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-15T12:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    const daysAgo = (n: number) =>
      new Date(Date.now() - n * 86_400_000).toISOString();

    test('today / yesterday / dual / plural buckets', () => {
      expect(arSince(daysAgo(0))).toBe('اليوم');
      expect(arSince(daysAgo(1))).toBe('أمس');
      expect(arSince(daysAgo(2))).toBe('منذ يومين');
      expect(arSince(daysAgo(5))).toBe('منذ ٥ أيام');
      expect(arSince(daysAgo(15))).toBe('منذ ١٥ يوماً');
    });

    test('30+ days falls back to a date; null → لم يدخل بعد', () => {
      expect(arSince(daysAgo(45))).toBe(arDate(daysAgo(45)));
      expect(arSince(null)).toBe('لم يدخل بعد');
      expect(arSince('garbage')).toBe('—');
    });

    test('a future timestamp (clock skew) still reads اليوم, never negative', () => {
      expect(arSince(daysAgo(-1))).toBe('اليوم');
    });
  });
});

describe('arFileSize / arDownloadSpeed', () => {
  test('one decimal below 10MB, whole numbers above, Arabic decimal separator', () => {
    expect(arFileSize(26 * 1024 * 1024)).toBe('٢٦ ميجابايت');
    expect(arFileSize(2.5 * 1024 * 1024)).toBe('٢٫٥ ميجابايت');
  });

  test('speed clamps negatives to zero', () => {
    expect(arDownloadSpeed(-100)).toBe('٠٫٠ م.ب/ث');
    expect(arDownloadSpeed(1.2 * 1024 * 1024)).toBe('١٫٢ م.ب/ث');
  });
});
