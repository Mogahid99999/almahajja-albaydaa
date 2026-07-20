import type { QuizAvailability, QuizAvailabilityMode } from '@/api/types';
import { colors } from '@/constants/theme';

/**
 * Client mirror of the server's quiz_availability() (migration 0118): derive the
 * effective availability from the admin-set mode + window. The server remains
 * the source of truth for the RPC-fed student paths; this is used where the
 * client reads the raw columns directly (the admin quizzes list) and to keep a
 * live preview in the editor without a round-trip.
 */
export function deriveAvailability(
  mode: QuizAvailabilityMode,
  from: string | null,
  until: string | null,
  now: number = Date.now(),
): QuizAvailability {
  if (mode === 'closed') return 'closed';
  if (mode === 'open') return 'open';
  // scheduled — a missing bound is open on that side.
  if (from && now < Date.parse(from)) return 'scheduled';
  if (until && now > Date.parse(until)) return 'expired';
  return 'open';
}

/** Calm status-pill meta for the derived availability (admin surfaces). */
export const QUIZ_AVAILABILITY_META: Record<
  QuizAvailability,
  { label: string; bg: string; fg: string }
> = {
  open: { label: 'مفتوح', bg: 'rgba(31,138,91,0.12)', fg: colors.stateSuccess },
  closed: { label: 'مغلق', bg: colors.surfaceInset, fg: colors.textMuted },
  scheduled: { label: 'مجدوَل', bg: 'rgba(176,137,79,0.14)', fg: colors.accentBrassMuted },
  expired: { label: 'منتهٍ', bg: 'rgba(184,92,74,0.12)', fg: colors.stateDanger },
};
