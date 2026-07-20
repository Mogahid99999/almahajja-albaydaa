import { isSeriesComplete, type SeriesCompletionSummary } from '@/api/seriesSummary';
import { seriesCelebration } from '@/constants/badges';

const base: SeriesCompletionSummary = {
  totalLectures: 0,
  completedLectures: 0,
  listeningSeconds: 0,
  quizAttempts: 0,
  quizzesTaken: 0,
  quizBestTotal: 0,
  quizPointsTotal: 0,
  benefitsCount: 0,
  notesCount: 0,
  bookmarksCount: 0,
  startedAt: null,
  completedAt: null,
};

describe('isSeriesComplete (V20 · Feature A)', () => {
  it('is false for an empty series — a container being built out is never "complete"', () => {
    expect(isSeriesComplete({ ...base, totalLectures: 0, completedLectures: 0 })).toBe(false);
  });

  it('is false while any lesson remains', () => {
    expect(isSeriesComplete({ ...base, totalLectures: 5, completedLectures: 4 })).toBe(false);
  });

  it('is true only once every published lesson is completed', () => {
    expect(isSeriesComplete({ ...base, totalLectures: 5, completedLectures: 5 })).toBe(true);
  });
});

describe('seriesCelebration', () => {
  it('keys on the section id so the modal fires at most once per series', () => {
    const e = seriesCelebration('abc-123', 'نواقض الإسلام');
    expect(e.key).toBe('series:abc-123');
    expect(e.level).toBe('large');
    // No badge seal — the closing summary page carries the detail instead.
    expect(e.iconBadgeKey).toBeNull();
    // Secondary action deep-links to the closing «ملخص إتمام السلسلة» page.
    expect(e.action).toEqual({ label: 'عرض الملخص', path: '/series-complete/abc-123' });
    // The series title is the calm body line.
    expect(e.bodyAr).toBe('نواقض الإسلام');
  });
});
