/**
 * src/constants/badges.ts — the badge catalog IS the award rule set (thresholds
 * are compared in evaluateBadges against completed-lecture count / LONGEST
 * streak). These tests pin the catalog's invariants so an accidental edit
 * can't silently change award behavior.
 */
import { BADGES, badgeByKey } from '../badges';

test('keys are unique', () => {
  const keys = BADGES.map((b) => b.key);
  expect(new Set(keys).size).toBe(keys.length);
});

test('every badge has a positive threshold and Arabic title/description', () => {
  for (const b of BADGES) {
    expect(b.threshold).toBeGreaterThan(0);
    expect(/[؀-ۿ]/.test(b.titleAr)).toBe(true);
    expect(/[؀-ۿ]/.test(b.descAr)).toBe(true);
  }
});

test('completed milestones are 1/5/10/25/50, streak milestones 3/7/30/100', () => {
  const completed = BADGES.filter((b) => b.kind === 'completed').map((b) => b.threshold);
  const streak = BADGES.filter((b) => b.kind === 'streak').map((b) => b.threshold);
  expect(completed).toEqual([1, 5, 10, 25, 50]);
  expect(streak).toEqual([3, 7, 30, 100]);
});

test('key encodes kind + threshold (evaluate/DB rows join on it)', () => {
  for (const b of BADGES) {
    expect(b.key).toBe(`${b.kind}_${b.threshold}`);
  }
});

test('badgeByKey looks up definitions and misses return undefined', () => {
  expect(badgeByKey('streak_7')?.titleAr).toBe('أسبوع من المداومة');
  expect(badgeByKey('nope')).toBeUndefined();
});
