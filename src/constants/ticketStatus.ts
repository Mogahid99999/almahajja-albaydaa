/**
 * Support-ticket status labels + colors (item 10). One source of truth for the
 * six lifecycle states, shared by the student tickets list/detail and the admin
 * ticket view so the Arabic wording never drifts.
 */
import type { TicketStatus } from '@/api/feedback';
import { colors } from '@/constants/theme';

export const TICKET_STATUS_META: Record<
  TicketStatus,
  { label: string; bg: string; fg: string }
> = {
  new: { label: 'مفتوحة', bg: 'rgba(176,137,79,0.14)', fg: colors.accentBrassMuted },
  in_review: { label: 'قيد المراجعة', bg: 'rgba(176,137,79,0.14)', fg: colors.accentBrassMuted },
  awaiting_student: { label: 'بانتظار ردّك', bg: 'rgba(31,138,91,0.12)', fg: colors.stateSuccess },
  resolved: { label: 'مغلقة', bg: 'rgba(154,143,124,0.18)', fg: colors.textFaint },
  dismissed: { label: 'مغلقة', bg: 'rgba(154,143,124,0.18)', fg: colors.textFaint },
  closed: { label: 'مغلقة', bg: 'rgba(154,143,124,0.18)', fg: colors.textFaint },
};

export function ticketStatusLabel(status: TicketStatus): string {
  return TICKET_STATUS_META[status]?.label ?? 'مفتوحة';
}
