/**
 * Badge catalog — رحلتي العلمية, tiered system (V20 · §9).
 *
 * The DB stores only *earned* instances (`user_badges.badge_key`); the definitions
 * live here so the rules stay in TypeScript and out of migrations (PLAN_PHASE2 §3.2).
 * Evaluation (`evaluateBadges`) compares each badge's threshold against the matching
 * metric from `get_journey_summary` + `get_badge_metrics`.
 *
 * Structure (source §9): badges are grouped into CATEGORIES, most with five graded
 * TIERS (bronze→silver→gold→diamond→exceptional). The page groups them under TABS
 * (الكل · التعلّم · المداومة · الإتقان · التدوين · الرفقة). Calm tone (CLAUDE.md):
 * quiet brass seals, not trophies. Streak/active-day badges reward the *peak*
 * reached, so a broken streak never revokes one.
 *
 *   metric 'lessons'      → completed-lecture count            (summary.completedLectures)
 *   metric 'hours'        → ACTUAL listening hours             (summary.totalSeconds / 3600)
 *   metric 'streak'       → longest streak, days               (summary.streak.longest)
 *   metric 'active_days'  → total active days (never lost)     (summary.activeDays)
 *   metric 'series'       → fully-completed series             (metrics.completedSeries)
 *   metric 'quizzes'      → distinct quizzes passed            (metrics.quizzesPassed)
 *   metric 'mastery'      → a ≥90% pass (threshold 1 = boolean)(metrics.hasMastery)
 *   metric 'benefits'     → visible فوائد written              (metrics.benefitsCount)
 *   metric 'benefit_days' → distinct days a benefit was written(metrics.benefitDays)
 *   metric 'buddy_*'      → buddy stats (Phase 3 — stay locked until buddy_goals)
 *
 * `key` is STABLE and permanent (earned rows join on it) — never renumber a key.
 * The first-lesson badge keeps its historical key `completed_1` so existing
 * «بداية الطريق» awards survive this redesign.
 */
import type { Badge, BadgeCategory, BadgeMetric, BadgeTier } from '@/api/types';

export type BadgeDef = {
  key: string;
  titleAr: string;
  descAr: string;
  threshold: number;
  metric: BadgeMetric;
  category: BadgeCategory;
  /** null for standalone one-offs (e.g. بداية الطريق, first benefit). */
  tier: BadgeTier | null;
};

/** Human-facing tab labels, in display order. */
export const BADGE_TABS: { category: BadgeCategory | 'all'; label: string }[] = [
  { category: 'all', label: 'الكل' },
  { category: 'learning', label: 'التعلّم' },
  { category: 'streak', label: 'المداومة' },
  { category: 'mastery', label: 'الإتقان' },
  { category: 'notes', label: 'التدوين' },
  { category: 'buddy', label: 'الرفقة' },
];

const tierName: Record<BadgeTier, string> = {
  bronze: 'البرونزي',
  silver: 'الفضي',
  gold: 'الذهبي',
  diamond: 'الماسي',
  exceptional: 'الاستثنائي',
};

/** Build the five graded tiers of one category into BadgeDefs. */
function tiers(
  keyBase: string,
  category: BadgeCategory,
  metric: BadgeMetric,
  titleBase: string,
  thresholds: [number, number, number, number, number],
  desc: (n: number) => string,
): BadgeDef[] {
  const order: BadgeTier[] = ['bronze', 'silver', 'gold', 'diamond', 'exceptional'];
  return order.map((tier, i) => ({
    key: `${keyBase}_${tier}`,
    titleAr: `${titleBase} ${tierName[tier]}`,
    descAr: desc(thresholds[i]),
    threshold: thresholds[i],
    metric,
    category,
    tier,
  }));
}

export const BADGES: BadgeDef[] = [
  // بداية الطريق — standalone first lesson (historical key kept).
  {
    key: 'completed_1',
    titleAr: 'بداية الطريق',
    descAr: 'أتممت أول درس في رحلتك',
    threshold: 1,
    metric: 'lessons',
    category: 'learning',
    tier: null,
  },

  // طالب العلم — lessons: 25 · 50 · 150 · 250 · 500
  ...tiers(
    'student',
    'learning',
    'lessons',
    'طالب العلم',
    [25, 50, 150, 250, 500],
    (n) => `أتممت ${arDigits(n)} درساً`,
  ),

  // ساعات في طلب العلم — actual listening hours: 15 · 30 · 100 · 300 · 500
  ...tiers(
    'hours',
    'learning',
    'hours',
    'ساعات في طلب العلم',
    [15, 30, 100, 300, 500],
    (n) => `${arDigits(n)} ساعة استماع`,
  ),

  // إتمام السلاسل — series: 1 · 3 · 5 · 10 (+ exceptional at 20 for symmetry)
  ...tiers(
    'series',
    'learning',
    'series',
    'إتمام السلاسل',
    [1, 3, 5, 10, 20],
    (n) => (n === 1 ? 'أتممت أول سلسلة' : `أتممت ${arDigits(n)} سلاسل`),
  ),

  // المداومة — longest streak: 7 · 15 · 30 · 100 · 365
  ...tiers(
    'streak',
    'streak',
    'streak',
    'المداومة',
    [7, 15, 30, 100, 365],
    (n) => `${arDigits(n)} يوماً متتالية`,
  ),

  // أيام النشاط — total active days (never lost): 10 · 30 · 100 · 365
  ...tiers(
    'active',
    'streak',
    'active_days',
    'أيام النشاط',
    [10, 30, 100, 365, 730],
    (n) => `${arDigits(n)} يوم نشاط علمي`,
  ),

  // الاختبارات — quizzes passed: 1 · 5 · 10 (+ diamond/exceptional)
  ...tiers(
    'quiz',
    'mastery',
    'quizzes',
    'الاختبارات',
    [1, 5, 10, 20, 40],
    (n) => (n === 1 ? 'اجتزت أول اختبار' : `اجتزت ${arDigits(n)} اختبارات`),
  ),
  // الإتقان — a ≥90% pass (standalone).
  {
    key: 'mastery_90',
    titleAr: 'الإتقان',
    descAr: 'نتيجة ٩٠٪ فأكثر في اختبار',
    threshold: 1,
    metric: 'mastery',
    category: 'mastery',
    tier: null,
  },

  // تدوين العلم — benefits: first · 10 · 50 (+ tiers), and 7-different-days.
  {
    key: 'benefit_1',
    titleAr: 'أول فائدة',
    descAr: 'دوّنت أول فائدة',
    threshold: 1,
    metric: 'benefits',
    category: 'notes',
    tier: null,
  },
  ...tiers(
    'benefits',
    'notes',
    'benefits',
    'تدوين العلم',
    [10, 50, 100, 200, 400],
    (n) => `دوّنت ${arDigits(n)} فائدة`,
  ),
  {
    key: 'benefit_days_7',
    titleAr: 'مواظبة التدوين',
    descAr: 'دوّنت العلم في ٧ أيام مختلفة',
    threshold: 7,
    metric: 'benefit_days',
    category: 'notes',
    tier: null,
  },

  // الرفقة — buddy (Phase 3; stay locked until buddy_goals exists).
  {
    key: 'buddy_start',
    titleAr: 'بداية الرفقة',
    descAr: 'بدأت رفقة في طلب العلم',
    threshold: 1,
    metric: 'buddy_start',
    category: 'buddy',
    tier: null,
  },
  ...tiers(
    'buddy_goals',
    'buddy',
    'buddy_goals_done',
    'أهداف الرفقة',
    [1, 4, 12, 24, 48],
    (n) => (n === 1 ? 'أتممت أول هدف مشترك' : `أتممت ${arDigits(n)} أهداف مشتركة`),
  ),
];

/** Western→Arabic-Indic digits for description strings (no import cycle). */
function arDigits(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
}

/** Lookup a definition by key. */
export const badgeByKey = (key: string): BadgeDef | undefined =>
  BADGES.find((b) => b.key === key);

/**
 * The single locked badge closest to unlocking (smallest remaining, as a fraction
 * of its threshold so metrics with different scales compare fairly), for the
 * «أقرب وسام» line (§9). Ignores buddy badges that can't progress yet (progress
 * is always 0 pre-Phase-3), and any badge with no progress at all. Null when every
 * badge is earned or nothing has started.
 */
export function nearestBadge(badges: Badge[]): Badge | null {
  let best: Badge | null = null;
  let bestFrac = Infinity;
  for (const b of badges) {
    if (b.earned || b.threshold <= 0 || b.progress <= 0) continue;
    if (b.progress >= b.threshold) continue; // should be earned; skip defensively
    const frac = (b.threshold - b.progress) / b.threshold;
    if (frac < bestFrac) {
      bestFrac = frac;
      best = b;
    }
  }
  return best;
}

/**
 * Map a freshly-earned badge to its celebration event (V20 · §15). The event
 * `key` is `badge:<badge.key>` — stable and unique per badge, so the server claim
 * (`try_claim_celebration`) fires the modal at most once ever. The first lesson
 * («بداية الطريق») and any 'exceptional'/'diamond' tier get the `large` weight; the
 * rest are the quiet `medium` modal. `iconBadgeKey` attaches the seal + «عرض الوسام».
 */
export function badgeCelebration(badge: Badge): CelebrationEvent {
  const def = badgeByKey(badge.key);
  const big =
    badge.key === 'completed_1' ||
    def?.tier === 'exceptional' ||
    def?.tier === 'diamond';
  return {
    key: `badge:${badge.key}`,
    level: big ? 'large' : 'medium',
    titleAr: badge.titleAr,
    bodyAr: badge.descAr,
    iconBadgeKey: badge.key,
  };
}

// Re-imported at the bottom to avoid a cycle in the type-only import list above.
import type { CelebrationEvent } from '@/api/types';
