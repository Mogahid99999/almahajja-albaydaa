import type { QuizStatus } from '@/api/types';
import { colors } from '@/constants/theme';

/**
 * Calm status pill meta shared by the section card, the intro screen and the
 * journey line. Personal-only wording — never comparative (PRD §12.6).
 */
export const QUIZ_STATUS_META: Record<QuizStatus, { label: string; bg: string; fg: string }> = {
  not_started: { label: 'لم يبدأ', bg: colors.surfaceInset, fg: colors.textMuted },
  in_progress: { label: 'قيد الحل', bg: 'rgba(31,74,66,0.10)', fg: colors.primaryTeal },
  passed: { label: 'ناجح', bg: 'rgba(31,138,91,0.12)', fg: colors.stateSuccess },
  failed: { label: 'غير مجتاز', bg: 'rgba(184,92,74,0.12)', fg: colors.stateDanger },
  exhausted: { label: 'استنفدت المحاولات', bg: colors.surfaceInset, fg: colors.textMuted },
};
