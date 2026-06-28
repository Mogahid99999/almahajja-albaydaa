/**
 * Badge catalog — رحلتي العلمية milestones (Phase 2 · feature C).
 *
 * The DB stores only *earned* instances (`user_badges`); the definitions live
 * here in app code so the rules stay in TypeScript and out of migrations
 * (PLAN_PHASE2.md §3.2). Evaluation (`recordListening` / `getBadges`) compares
 * these thresholds against the journey rollups.
 *
 * Calm tone (CLAUDE.md): badges are quiet brass seals, not trophies. Titles and
 * descriptions are encouraging, never pressuring — streak badges reward the
 * *longest* run reached, so a broken streak never revokes one.
 *
 *   kind 'completed' → threshold compares against completed-lecture count
 *   kind 'streak'    → threshold compares against the longest streak (days)
 */
import type { BadgeKind } from '@/api/types';

export type BadgeDef = {
  key: string;
  titleAr: string;
  descAr: string;
  threshold: number;
  kind: BadgeKind;
};

export const BADGES: BadgeDef[] = [
  // Completed-lecture milestones
  { key: 'completed_1',  kind: 'completed', threshold: 1,
    titleAr: 'بداية الطريق', descAr: 'أتممت أول درس في رحلتك' },
  { key: 'completed_5',  kind: 'completed', threshold: 5,
    titleAr: 'خمسة دروس',    descAr: 'أتممت خمسة دروس' },
  { key: 'completed_10', kind: 'completed', threshold: 10,
    titleAr: 'عشرة دروس',    descAr: 'أتممت عشرة دروس' },
  { key: 'completed_25', kind: 'completed', threshold: 25,
    titleAr: 'خمسة وعشرون',  descAr: 'أتممت خمسة وعشرين درساً' },
  { key: 'completed_50', kind: 'completed', threshold: 50,
    titleAr: 'خمسون درساً',  descAr: 'أتممت خمسين درساً' },

  // مداومة / streak milestones (compared against the longest streak)
  { key: 'streak_3',   kind: 'streak', threshold: 3,
    titleAr: 'مداومة ثلاثة أيام', descAr: 'ثلاثة أيام متتالية من طلب العلم' },
  { key: 'streak_7',   kind: 'streak', threshold: 7,
    titleAr: 'أسبوع من المداومة', descAr: 'سبعة أيام متتالية' },
  { key: 'streak_30',  kind: 'streak', threshold: 30,
    titleAr: 'شهر من المداومة',   descAr: 'ثلاثون يوماً متتالية' },
  { key: 'streak_100', kind: 'streak', threshold: 100,
    titleAr: 'مائة يوم',          descAr: 'مائة يوم متتالية من المداومة' },
];

/** Lookup a definition by key. */
export const badgeByKey = (key: string): BadgeDef | undefined =>
  BADGES.find((b) => b.key === key);
