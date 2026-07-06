/**
 * Shared Arabic labels + icon mapping for notification types (feature B). Kept in
 * one place so the inbox rows and the prefs toggles phrase + ice each type
 * identically. new_quiz went live with Feature 12 (0018 publish fan-out).
 */
import type { Feather } from '@expo/vector-icons';
import type { NotificationType } from '@/api/types';

type FeatherName = keyof typeof Feather.glyphMap;

/** Short label for the prefs toggle row (درس جديد / مرفق جديد / …). */
export const notificationTypeLabel: Record<NotificationType, string> = {
  new_lecture: 'درس جديد',
  new_attachment: 'مرفق جديد',
  new_quiz: 'اختبار جديد',
  beneficial_reminder: 'تذكير نافع',
  resume_reminder: 'تذكير بالمتابعة',
  noncompletion_gentle: 'تذكير لطيف بعدم الإكمال',
  resume_series: 'متابعة السلسلة',
  completion_praise: 'تشجيع بعد الإكمال',
  daily_reminder: 'تذكير يومي',
  streak_reminder: 'تذكير المداومة',
  weekly_goal: 'الهدف الأسبوعي',
  buddy_activity: 'تنبيهات رفيق الدراسة',
  buddy_request: 'دعوة رفيق دراسة',
  question_received: 'سؤال جديد (لحساب الشيخ)',
  question_answered: 'الجواب عن سؤالك',
  content_reported: 'بلاغ جديد (لحساب الإدارة)',
};

/** One-line explanation shown under each toggle. */
export const notificationTypeDescription: Record<NotificationType, string> = {
  new_lecture: 'عند نشر درس جديد',
  new_attachment: 'عند إضافة مرفق جديد',
  new_quiz: 'عند نشر اختبار في قسم تتابعه',
  beneficial_reminder: 'تذكيرات نافعة من إدارة المنصة',
  resume_reminder: 'تذكير لطيف بدرس لم تكمله',
  noncompletion_gentle: 'كلمة لطيفة إن توقفت قبل الإكمال',
  resume_series: 'تذكير بمواصلة سلسلة بدأتها',
  completion_praise: 'كلمة طيبة عند إتمام الدرس',
  daily_reminder: 'تذكير لطيف مرة كل يوم',
  streak_reminder: 'تنبيه لطيف كي لا تفقد مداومتك اليوم',
  weekly_goal: 'تذكير لطيف بهدفك الأسبوعي',
  buddy_activity: 'عند إتمام رفيقك درساً',
  buddy_request: 'عند دعوتك لرفقة طلب العلم أو قبول دعوتك',
  question_received: 'عند وصول سؤال جديد من طالب علم',
  question_answered: 'عند إجابة الشيخ عن سؤالك',
  content_reported: 'عند إبلاغ أحد الدارسين عن محتوى بحاجة مراجعة',
};

/** Calm Feather icon per type (rhombus-framed in the row). */
export const notificationTypeIcon: Record<NotificationType, FeatherName> = {
  new_lecture: 'headphones',
  new_attachment: 'paperclip',
  new_quiz: 'edit-3',
  beneficial_reminder: 'star',
  resume_reminder: 'clock',
  noncompletion_gentle: 'heart',
  resume_series: 'layers',
  completion_praise: 'check-circle',
  daily_reminder: 'sunrise',
  streak_reminder: 'zap',
  weekly_goal: 'target',
  buddy_activity: 'users',
  buddy_request: 'mail',
  question_received: 'help-circle',
  question_answered: 'message-circle',
  content_reported: 'flag',
};

/**
 * Order the prefs toggles render in. new_quiz sits with the other content
 * pushes now that quizzes are live.
 */
export const NOTIFICATION_TYPE_ORDER: NotificationType[] = [
  'new_lecture',
  'new_attachment',
  'new_quiz',
  'beneficial_reminder',
  'resume_reminder',
  'noncompletion_gentle',
  'resume_series',
  'completion_praise',
  'daily_reminder',
  'streak_reminder',
  'weekly_goal',
  'buddy_activity',
  'buddy_request',
  'question_answered',
  'question_received',
];
