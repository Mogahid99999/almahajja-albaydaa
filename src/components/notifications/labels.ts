/**
 * Shared Arabic labels + icon mapping for notification types (feature B). Kept in
 * one place so the inbox rows and the prefs toggles phrase + ice each type
 * identically. Quizzes are still deferred — the new_quiz entry ships now so the
 * pref + payload light up later with no migration.
 */
import type { Feather } from '@expo/vector-icons';
import type { NotificationType } from '@/api/types';

type FeatherName = keyof typeof Feather.glyphMap;

/** Short label for the prefs toggle row (درس جديد / مرفق جديد / …). */
export const notificationTypeLabel: Record<NotificationType, string> = {
  new_lecture: 'درس جديد',
  new_attachment: 'مرفق جديد',
  new_quiz: 'اختبار جديد',
  resume_reminder: 'تذكير بالمتابعة',
};

/** One-line explanation shown under each toggle. */
export const notificationTypeDescription: Record<NotificationType, string> = {
  new_lecture: 'عند نشر درس في قسم تتابعه',
  new_attachment: 'عند إضافة مرفق في قسم تتابعه',
  new_quiz: 'عند إضافة اختبار (قريباً)',
  resume_reminder: 'تذكير لطيف بدرس لم تكمله',
};

/** Calm Feather icon per type (rhombus-framed in the row). */
export const notificationTypeIcon: Record<NotificationType, FeatherName> = {
  new_lecture: 'headphones',
  new_attachment: 'paperclip',
  new_quiz: 'edit-3',
  resume_reminder: 'clock',
};

/** Order the prefs toggles render in. */
export const NOTIFICATION_TYPE_ORDER: NotificationType[] = [
  'new_lecture',
  'new_attachment',
  'new_quiz',
  'resume_reminder',
];
