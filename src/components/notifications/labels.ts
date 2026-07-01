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
  noncompletion_gentle: 'تذكير لطيف بعدم الإكمال',
  resume_series: 'متابعة السلسلة',
  completion_praise: 'تشجيع بعد الإكمال',
  daily_reminder: 'تذكير يومي',
  weekly_goal: 'الهدف الأسبوعي',
};

/** One-line explanation shown under each toggle. */
export const notificationTypeDescription: Record<NotificationType, string> = {
  new_lecture: 'عند نشر درس جديد',
  new_attachment: 'عند إضافة مرفق جديد',
  new_quiz: 'عند إضافة اختبار (قريباً)',
  resume_reminder: 'تذكير لطيف بدرس لم تكمله',
  noncompletion_gentle: 'كلمة لطيفة إن توقفت قبل الإكمال',
  resume_series: 'تذكير بمواصلة سلسلة بدأتها',
  completion_praise: 'كلمة طيبة عند إتمام الدرس',
  daily_reminder: 'تذكير لطيف مرة كل يوم (مغلق افتراضياً)',
  weekly_goal: 'تذكير لطيف بهدفك الأسبوعي',
};

/** Calm Feather icon per type (rhombus-framed in the row). */
export const notificationTypeIcon: Record<NotificationType, FeatherName> = {
  new_lecture: 'headphones',
  new_attachment: 'paperclip',
  new_quiz: 'edit-3',
  resume_reminder: 'clock',
  noncompletion_gentle: 'heart',
  resume_series: 'layers',
  completion_praise: 'check-circle',
  daily_reminder: 'sunrise',
  weekly_goal: 'target',
};

/**
 * Order the prefs toggles render in. Quizzes sit last (deferred), the opt-in
 * daily reminder just before it.
 */
export const NOTIFICATION_TYPE_ORDER: NotificationType[] = [
  'new_lecture',
  'new_attachment',
  'resume_reminder',
  'noncompletion_gentle',
  'resume_series',
  'completion_praise',
  'daily_reminder',
  'weekly_goal',
  'new_quiz',
];
