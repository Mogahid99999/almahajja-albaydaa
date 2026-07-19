/**
 * src/constants/badges.ts — the tiered badge catalog IS the award rule set (V20
 * §9). Thresholds are compared in evaluateBadges against the per-metric value from
 * get_journey_summary + get_badge_metrics. These tests pin the catalog's
 * invariants so an accidental edit can't silently change award behavior.
 */
import { BADGES, BADGE_TABS, badgeByKey, badgeCelebration } from '../badges';
import type { Badge } from '@/api/types';

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

test('the historical first-lesson key is preserved (earned rows must survive)', () => {
  const first = badgeByKey('completed_1');
  expect(first?.titleAr).toBe('بداية الطريق');
  expect(first?.metric).toBe('lessons');
});

test('student (lessons) tiers are 25 · 50 · 150 · 250 · 500', () => {
  const student = BADGES.filter((b) => b.metric === 'lessons' && b.key.startsWith('student_'))
    .map((b) => b.threshold);
  expect(student).toEqual([25, 50, 150, 250, 500]);
});

test('listening-hours tiers are 15 · 30 · 100 · 300 · 500', () => {
  const hours = BADGES.filter((b) => b.metric === 'hours').map((b) => b.threshold);
  expect(hours).toEqual([15, 30, 100, 300, 500]);
});

test('streak tiers are 7 · 15 · 30 · 100 · 365', () => {
  const streak = BADGES.filter((b) => b.metric === 'streak').map((b) => b.threshold);
  expect(streak).toEqual([7, 15, 30, 100, 365]);
});

test('every tab category (except الكل) has at least one badge', () => {
  for (const tab of BADGE_TABS) {
    if (tab.category === 'all') continue;
    expect(BADGES.some((b) => b.category === tab.category)).toBe(true);
  }
});

test('badgeCelebration maps to a badge:<key> event with the seal attached', () => {
  const badge: Badge = {
    key: 'student_silver',
    titleAr: 'طالب العلم الفضي',
    descAr: 'أتممت ٥٠ درساً',
    threshold: 50,
    metric: 'lessons',
    category: 'learning',
    tier: 'silver',
    earned: true,
    earnedAt: null,
    progress: 50,
  };
  const ev = badgeCelebration(badge);
  expect(ev.key).toBe('badge:student_silver');
  expect(ev.iconBadgeKey).toBe('student_silver');
  expect(ev.level).toBe('medium');
});

test('exceptional + diamond tiers celebrate at the large level', () => {
  const mk = (key: string): Badge => ({
    key,
    titleAr: 'x',
    descAr: 'y',
    threshold: 1,
    metric: 'lessons',
    category: 'learning',
    tier: null,
    earned: true,
    earnedAt: null,
    progress: 1,
  });
  expect(badgeCelebration(mk('student_exceptional')).level).toBe('large');
  expect(badgeCelebration(mk('student_diamond')).level).toBe('large');
  expect(badgeCelebration(mk('completed_1')).level).toBe('large');
});

test('badgeByKey looks up definitions and misses return undefined', () => {
  expect(badgeByKey('streak_gold')?.titleAr).toBe('المداومة الذهبي');
  expect(badgeByKey('nope')).toBeUndefined();
});
