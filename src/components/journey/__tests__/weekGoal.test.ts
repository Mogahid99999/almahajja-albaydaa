/**
 * src/components/journey/labels.ts — upgraded weekly-goal math (V20 · §5).
 *
 * Pins the §5 rules: percentage, days-left in the Sat→Fri week (counting today),
 * the required daily rate (round UP), and the over-target behavior (progress does
 * NOT stop at 100%). All timezone-sensitive via an injected `now`.
 */
import {
  daysLeftInWeek,
  formatDailyNeeded,
  formatDaysLeft,
  weekGoalStats,
} from '../labels';

describe('daysLeftInWeek (Sat→Fri, counts today)', () => {
  // 2026-07-18 is a Saturday → week start → 7 days left.
  it('Saturday = 7', () => {
    expect(daysLeftInWeek(new Date('2026-07-18T10:00:00'))).toBe(7);
  });
  it('Sunday = 6', () => {
    expect(daysLeftInWeek(new Date('2026-07-19T10:00:00'))).toBe(6);
  });
  it('Friday = 1 (last day)', () => {
    expect(daysLeftInWeek(new Date('2026-07-24T10:00:00'))).toBe(1);
  });
});

describe('weekGoalStats', () => {
  // 2026-07-22 is a Wednesday. Sat→Fri: Sat=7…Wed=3 days left (incl. today).
  const wed = new Date('2026-07-22T10:00:00');

  it('computes percent + remaining + daily rate mid-week', () => {
    const s = weekGoalStats(3, 7, wed);
    expect(s.percent).toBe(43); // round(3/7*100)
    expect(s.remaining).toBe(4);
    expect(s.daysLeft).toBe(3);
    expect(s.dailyNeeded).toBe(2); // ceil(4/3)
    expect(s.reached).toBe(false);
    expect(s.overTarget).toBe(false);
  });

  it('rounds the daily rate UP', () => {
    const s = weekGoalStats(5, 7, wed); // remaining 2 over 3 days → ceil(0.67)=1
    expect(s.dailyNeeded).toBe(1);
  });

  it('does not stop at 100% and reports over-target', () => {
    const s = weekGoalStats(9, 7, wed);
    expect(s.percent).toBe(129);
    expect(s.reached).toBe(true);
    expect(s.overTarget).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.dailyNeeded).toBe(0);
  });

  it('treats an exact hit as reached (not over)', () => {
    const s = weekGoalStats(7, 7, wed);
    expect(s.reached).toBe(true);
    expect(s.overTarget).toBe(false);
  });

  it('is safe with a zero target', () => {
    const s = weekGoalStats(0, 0, wed);
    expect(s.percent).toBe(0);
    expect(s.reached).toBe(false);
    expect(s.dailyNeeded).toBe(0);
  });
});

describe('phrasing', () => {
  it('days-left copy is calm and grammatical', () => {
    expect(formatDaysLeft(1)).toBe('آخر يوم في الأسبوع');
    expect(formatDaysLeft(2)).toBe('بقي يومان');
    expect(formatDaysLeft(4)).toContain('بقي');
  });

  it('daily-needed copy handles singular vs plural', () => {
    expect(formatDailyNeeded(1, 'lectures')).toContain('واحد');
    expect(formatDailyNeeded(3, 'lectures')).toContain('دروس');
    expect(formatDailyNeeded(30, 'minutes')).toContain('دقيقة');
  });
});
