/**
 * UI-facing data-transfer types returned by `src/api/*`.
 *
 * These decouple screens from the data source: identical shape whether served by
 * the mock dataset (now) or Supabase (later). Components/hooks import from here.
 */
import type { AppLectureStatus } from '@/config';
import type { AppRole } from './auth';

export type LectureProgressStatus = 'new' | 'in_progress' | 'completed';

// --- Attachments (Phase 2 · feature A) ---------------------------------------
/** PDF · كتاب · تفريغ · صورة · رابط. */
export type AttachmentType = 'pdf' | 'book' | 'transcript' | 'image' | 'link';

/** Identifies the owner of an attachment — a section node OR a lecture. */
export type AttachmentOwnerRef =
  | { kind: 'section'; id: string }
  | { kind: 'lecture'; id: string };

/** UI-facing attachment, source-agnostic (mock now / Supabase later). */
export type Attachment = {
  id: string;
  type: AttachmentType;
  title: string;
  description: string | null;
  /** Signed URL (storage) or external_url (link/book); null for transcript. */
  url: string | null;
  /** Transcript text — populated only by `getAttachment` for the in-app reader. */
  body: string | null;
  order: number;
};

/** Admin create payload (file already uploaded → storagePath, or external link). */
export type CreateAttachmentInput = {
  owner: AttachmentOwnerRef;
  type: AttachmentType;
  title: string;
  description?: string | null;
  /** external_url for link/book. */
  url?: string | null;
  /** transcript text (in-app reader). */
  body?: string | null;
  /** storage_path of a file already uploaded to the `attachments` bucket. */
  storagePath?: string | null;
};

// --- Journey · رحلتي العلمية (Phase 2 · feature C) ---------------------------
/** Weekly goal metric: lectures studied OR minutes listened. */
export type GoalMetric = 'lectures' | 'minutes';

/** The student's active weekly goal. */
export type WeeklyGoal = {
  metric: GoalMetric;
  target: number;
};

/** This week's progress toward the active goal (Sat→Fri week). */
export type WeekProgress = {
  metric: GoalMetric;
  target: number;
  /** Lectures studied this week, or whole minutes listened — per `metric`. */
  current: number;
};

/** مداومة — consecutive listening days. Longest is kept so it's never lost. */
export type Streak = {
  current: number;
  longest: number;
};

/**
 * Home StreakCard state (26.1). `todayCounted` = today reached the meaningful
 * bar (≥2 min or a completion). Recovery is open for 3 days after a break.
 */
export type StreakStatus = {
  current: number;
  todayCounted: boolean;
  recoveryAvailable: boolean;
  recoveryDaysLeft: number;
};

// --- Study buddy · رفيق الدراسة (26.2) ----------------------------------------
export type Gender = 'male' | 'female';

/** The accepted buddy's card data — encouraging phrases only, never ranks. */
export type BuddyStatus = {
  buddyId: string;
  displayName: string;
  currentStreak: number;
  todayCounted: boolean;
  weekProgressPct: number;
  weeklyGoalMet: boolean;
};

/** A same-gender candidate row in the buddy search. */
export type BuddyCandidate = {
  id: string;
  displayName: string;
  currentStreak: number;
};

/** An incoming pending invitation. */
export type BuddyRequest = {
  id: string;
  fromDisplayName: string;
  createdAt: string;
};

/** Everything the رحلتي العلمية page header needs, in one round-trip. */
export type JourneySummary = {
  completedLectures: number;
  totalSeconds: number;
  streak: Streak;
  /** Distinct days with any listening. */
  activeDays: number;
  week: WeekProgress;
};

/** A milestone badge: completed-lectures count or streak-days. */
export type BadgeKind = 'completed' | 'streak';

/** A badge catalog entry merged with this user's earned state. */
export type Badge = {
  key: string;
  titleAr: string;
  descAr: string;
  threshold: number;
  kind: BadgeKind;
  earned: boolean;
  earnedAt: string | null;
};

// --- Notifications (Phase 2 · feature B) -------------------------------------
/**
 * درس جديد · مرفق جديد · اختبار جديد · تذكير بالمتابعة · متابعة السلسلة · تشجيع
 * بعد الإكمال · تذكير يومي.
 *
 * `new_quiz` ships even though quizzes are deferred, so the pref + payload light
 * up later with no migration. The last three are LOCAL-only (scheduled/presented
 * on-device, never stored as inbox rows): `resume_series` continues a started
 * series, `completion_praise` is the calm word after finishing a lesson, and
 * `daily_reminder` is a calm once-a-day remembrance (default ON, defers to
 * resume nudges).
 *
 * `buddy_request` is a server push+inbox type (migration 0019/0020): a student
 * is told when they're invited to be a study buddy, or when their invite is
 * accepted.
 *
 * `question_received` / `question_answered` are the V6 Q&A types (0027): the
 * sheikh is told a new question awaits; the asker is told their question was
 * answered. Both are server push+inbox, inserted inside the Q&A DEFINER RPCs.
 *
 * `streak_reminder` (V7, 0033/0035) is the server-cron المداومة keep-alive;
 * `resume_reminder` / `noncompletion_gentle` are ALSO server-cron now (0035) —
 * the device ladder was unreliable on Samsung. `beneficial_reminder` (V7,
 * 0033/0034) is the admin التذكيرات النافعة broadcast, deep-linking to its
 * detail page via `data.route`.
 */
export type NotificationType =
  | 'new_lecture'
  | 'new_attachment'
  | 'new_quiz'
  | 'beneficial_reminder'
  | 'resume_reminder'
  | 'noncompletion_gentle'
  | 'resume_series'
  | 'completion_praise'
  | 'daily_reminder'
  | 'streak_reminder'
  | 'weekly_goal'
  | 'buddy_activity'
  | 'buddy_request'
  | 'question_received'
  | 'question_answered';

/**
 * Every notification type, in a stable order. Single source of truth for the
 * api/mock prefs resolvers (kept exhaustive — a missing DB row resolves to its
 * default) so the two never drift.
 */
export const NOTIFICATION_TYPES: NotificationType[] = [
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
  'question_received',
  'question_answered',
];

/**
 * Default on/off when no stored pref row exists. Every type defaults ON (a
 * missing row = enabled) — including `daily_reminder`, whose calm once-a-day
 * remembrance defers to resume nudges anyway (see `_layout.tsx` re-arm). Used by
 * both the live and mock prefs resolvers.
 */
export function defaultNotificationEnabled(_type: NotificationType): boolean {
  return true;
}

/** Deep-link payload carried on a notification (exactly one target is set). */
export type NotificationData = {
  lectureId?: string;
  sectionId?: string;
  attachmentId?: string;
  /** new_quiz pushes carry the quiz id; navigation happens via `route`. */
  quizId?: string;
  /** Resume notifications carry the paused second → player opens there (§8). */
  positionSec?: number;
  /** An explicit route to push (e.g. weekly-goal → '/(student)/journey'). */
  route?: string;
};

/** One row in the الإشعارات inbox. `read` derives from the DB's `read_at`. */
export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData;
  read: boolean;
  createdAt: string;
};

/**
 * Per-type on/off, keyed by every {@link NotificationType}. Absence of a DB row
 * means ON, so the api layer always resolves this to a complete map.
 */
export type NotificationPrefs = Record<NotificationType, boolean>;

/** Whether the current user follows a given section. */
export type FollowState = {
  sectionId: string;
  followed: boolean;
};

/** Section card on Home grid + subsection scrollers. */
export type SectionCard = {
  id: string;
  title: string;
  coverLetter: string;
  lectureCount: number;
  progressPct: number;
};

/** Home rail card (مختارات + downloads). */
export type LectureCard = {
  id: string;
  title: string;
  sheikhName: string | null;
  durationSec: number;
  coverLetter: string;
};

/** One curated pick in the admin «المختارات» list (drafts/unclassified visible). */
export type AdminFeaturedRow = {
  lectureId: string;
  title: string;
  status: AppLectureStatus;
  sectionTitle: string | null;
  sheikhName: string | null;
  durationSec: number;
  order: number;
};

/** "Continue listening" feature card. */
export type ResumeLecture = {
  id: string;
  title: string;
  sheikhName: string | null;
  eyebrow: string;
  positionSec: number;
  durationSec: number;
};

export type HomeData = {
  continueListening: ResumeLecture | null;
  /** «أُضيف حديثاً» — auto-sorted newest published lectures. */
  newlyAdded: LectureCard[];
  /** «مختارات» — staff-curated picks (ordered). */
  featured: LectureCard[];
  sections: SectionCard[];
};

/** A lecture row inside a section page's lecture list. */
export type LectureRow = {
  id: string;
  title: string;
  durationSec: number;
  sheikhName: string | null;
  status: LectureProgressStatus;
  positionSec: number;
  order: number;
};

export type SectionHeaderData = {
  id: string;
  title: string;
  description: string | null;
  coverLetter: string;
  coverImage: string | null;
  showHeader: boolean;
};

export type SectionPageData = {
  section: SectionHeaderData;
  /** Nav-bar context label (the parent's title), null at the root. */
  parentTitle: string | null;
  sheikhNames: string[];
  rollup: { total: number; completed: number; progressPct: number };
  subsections: SectionCard[];
  lectures: LectureRow[];
  /** Attachments owned by this section node (PRD §13). */
  attachments: Attachment[];
  /** Published quizzes attached to this section node (PRD §12). */
  quizzes: QuizCard[];
};

/** Everything the player needs for one lecture. */
export type LecturePlayback = {
  id: string;
  title: string;
  sheikhName: string | null;
  eyebrow: string;
  sectionTitle: string | null;
  /** Section + order drive "next lecture" (manual button + auto-advance). */
  sectionId: string | null;
  order: number;
  durationSec: number;
  audioUrl: string;
  positionSec: number;
  /** Attachments owned by this lecture (PRD §13). */
  attachments: Attachment[];
};

// --- Quizzes · الاختبارات (Feature 12) ----------------------------------------
/**
 * Personal quiz status, derived from the DEFINER RPC status fields — best
 * score drives it and a pass is sticky (never un-passed by a later attempt).
 */
export type QuizStatus = 'not_started' | 'in_progress' | 'passed' | 'failed' | 'exhausted';

/** One quiz on the section page card (content-free — no questions/answers). */
export type QuizCard = {
  id: string;
  title: string;
  description: string | null;
  questionCount: number;
  totalScore: number;
  passScore: number;
  timeLimitSec: number | null;
  /** null = unlimited attempts. */
  maxAttempts: number | null;
  attemptsUsed: number;
  /** null when maxAttempts is null (unlimited). */
  attemptsLeft: number | null;
  bestScore: number | null;
  status: QuizStatus;
  inProgressAttemptId: string | null;
  /** Latest submitted attempt — for re-opening its result. */
  lastResultAttemptId: string | null;
  order: number;
};

/** Pre-quiz intro screen data (§12.2). */
export type QuizIntro = QuizCard & {
  sectionId: string;
  sectionTitle: string;
};

/** A solver option — `isCorrect` never exists on the student side. */
export type QuizOptionView = {
  id: string;
  text: string;
  order: number;
};

/** A solver question with any already-saved answer (resume). */
export type QuizQuestionView = {
  id: string;
  text: string;
  points: number;
  order: number;
  selectedOptionId: string | null;
  options: QuizOptionView[];
};

/** The whole solver payload for one attempt (answer key stripped server-side). */
export type QuizAttemptData = {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  timeLimitSec: number | null;
  /** Server-clock remaining seconds; null = no limit. */
  remainingSec: number | null;
  submittedAt: string | null;
  questions: QuizQuestionView[];
};

/** Per-question correction row — present only when the admin enabled it. */
export type QuizResultDetail = {
  questionId: string;
  text: string;
  points: number;
  selectedOptionId: string | null;
  selectedOptionText: string | null;
  correctOptionId: string | null;
  correctOptionText: string | null;
  isCorrect: boolean;
};

/**
 * A graded attempt as the student may see it: score fields are null when the
 * admin disabled show_result; `details` is null unless show_correct_answers.
 */
export type QuizResult = {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  submittedAt: string | null;
  showResult: boolean;
  showCorrectAnswers: boolean;
  attemptsLeft: number | null;
  canRetry: boolean;
  questionCount: number;
  score: number | null;
  passed: boolean | null;
  totalScore: number | null;
  passScore: number | null;
  correctCount: number | null;
  wrongCount: number | null;
  details: QuizResultDetail[] | null;
};

/** Quiet Journey line (§12.4): personal counts only, never compared. */
export type MyQuizStats = {
  attempted: number;
  passed: number;
};

/** Admin editor payloads — ids present on rows that already exist (diff-upsert). */
export type QuizOptionInput = {
  id?: string;
  text: string;
  isCorrect: boolean;
  order: number;
};

export type QuizQuestionInput = {
  id?: string;
  text: string;
  points: number;
  order: number;
  options: QuizOptionInput[];
};

export type QuizInput = {
  sectionId: string;
  title: string;
  description: string | null;
  passScore: number;
  timeLimitSec: number | null;
  maxAttempts: number | null;
  showResult: boolean;
  showCorrectAnswers: boolean;
  status: 'draft' | 'published';
  order: number;
};

/** Admin quizzes list row (drafts visible; grouped by section client-side). */
export type AdminQuizRow = {
  id: string;
  title: string;
  sectionId: string;
  sectionTitle: string | null;
  status: 'draft' | 'published';
  questionCount: number;
  passScore: number;
  order: number;
  updatedAt: string;
};

/** Full quiz as loaded into the admin editor (includes the answer key). */
export type AdminQuizDetail = QuizInput & {
  id: string;
  questions: (QuizQuestionInput & { id: string; options: (QuizOptionInput & { id: string })[] })[];
};

/** §12.5 summary tiles. avg/max/min are over each student's best score. */
export type AdminQuizSummary = {
  entered: number;
  passedCount: number;
  failedCount: number;
  incompleteCount: number;
  notTaken: number;
  avgScore: number | null;
  maxScore: number | null;
  minScore: number | null;
};

export type AdminResultStatus = 'passed' | 'failed' | 'incomplete' | 'exhausted';

/** One student row in the admin results table. */
export type AdminQuizResultRow = {
  userId: string;
  displayName: string;
  status: AdminResultStatus;
  bestScore: number | null;
  attemptsUsed: number;
  lastAttemptAt: string;
  lastAttemptId: string;
};

export type AdminAttemptAnswer = {
  questionId: string;
  text: string;
  points: number;
  selectedOptionText: string | null;
  correctOptionText: string | null;
  isCorrect: boolean;
};

/** §12.5 drill-down: one attempt with per-question right/wrong. */
export type AdminAttemptDetail = {
  attemptId: string;
  quizId: string;
  quizTitle: string;
  displayName: string;
  attemptNo: number;
  startedAt: string;
  submittedAt: string | null;
  durationSec: number | null;
  score: number | null;
  passed: boolean | null;
  totalScore: number;
  passScore: number;
  answers: AdminAttemptAnswer[];
  otherAttempts: {
    attemptId: string;
    attemptNo: number;
    score: number | null;
    passed: boolean | null;
    submittedAt: string | null;
  }[];
};

// --- Admin -------------------------------------------------------------------
export type FlatSectionNode = {
  id: string;
  title: string;
  parentId: string | null;
  depth: number;
  /** Ancestor titles including self, e.g. ["العقيدة","التوحيد","الأصول الثلاثة"]. */
  path: string[];
};

/** Editable fields of a section node — used to pre-fill the admin editor. */
export type SectionEditData = {
  id: string;
  title: string;
  description: string | null;
  parentId: string | null;
  order: number;
  showHeader: boolean;
};

export type UnclassifiedItem = {
  id: string;
  title: string;
  sheikhName: string | null;
  durationSec: number;
  createdAt: string;
};

export type AdminLectureRow = {
  id: string;
  title: string;
  sectionTitle: string | null;
  /** Raw FKs so the admin editor can pre-fill section/sheikh pickers. */
  sectionId: string | null;
  sheikhId: string | null;
  sheikhName: string | null;
  status: AppLectureStatus;
  durationSec: number;
  order: number;
};

export type SheikhOption = { id: string; name: string };

// --- Admin V5: dashboard / analytics / users / config -------------------------
/** Feature 2 — calm dashboard overview (admin only). */
export type AdminTopSection = { title: string; hours: number };
export type AdminTopQuiz = { title: string; attempts: number };
export type AdminDashboardStats = {
  totalUsers: number;
  registeredUsers: number;
  newUsersMonth: number;
  newUsersWeek: number;
  activeToday: number;
  sectionsCount: number;
  lecturesPublished: number;
  publishedQuizzes: number;
  listenHoursTotal: number;
  listenHoursMonth: number;
  topSections: AdminTopSection[];
  topQuizzes: AdminTopQuiz[];
};

/** Feature 3 — تحليلات التقدم العلمي (admin only, never student-vs-student). */
export type AdminSectionProgress = {
  title: string;
  totalLectures: number;
  studentsStarted: number;
  /** 0..100 average completion of the subtree across students who started. */
  avgCompletion: number;
};
/** A single student in one of the two admin-private lists. */
export type AdminStudentBrief = {
  userId: string;
  displayName: string | null;
  /** completed lectures (good-progress list) or in-progress count (stopped list). */
  count: number;
  lastOpenedAt: string | null;
};
export type AdminProgressAnalytics = {
  completedFirst: number;
  completed5: number;
  completed10: number;
  completedSection: number;
  sections: AdminSectionProgress[];
  goodProgress: AdminStudentBrief[];
  startedStopped: AdminStudentBrief[];
};

/** Feature 4 — إدارة المستخدمين. */
export type AdminUserStatus = 'active' | 'inactive' | 'banned';
export type AdminUserRow = {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  role: AppRole;
  createdAt: string;
  lastOpenedAt: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  status: AdminUserStatus;
  completedLectures: number;
  passedQuizzes: number;
  currentStreak: number;
  weeklyGoalTarget: number | null;
  weeklyGoalMetric: string | null;
};
export type AdminUserProfile = {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  role: AppRole;
  createdAt: string;
  lastOpenedAt: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  status: AdminUserStatus;
  currentStreak: number;
  weeklyGoalTarget: number | null;
  weeklyGoalMetric: string | null;
};
export type AdminUserProgressRow = {
  lectureId: string;
  lectureTitle: string;
  sectionTitle: string | null;
  completed: boolean;
  positionSec: number;
  durationSec: number | null;
  updatedAt: string;
};
export type AdminUserQuizResult = {
  quizTitle: string;
  score: number | null;
  passed: boolean | null;
  attemptNo: number;
  submittedAt: string | null;
};
export type AdminUserDetail = {
  profile: AdminUserProfile;
  totals: { completedLectures: number; inProgressLectures: number; passedQuizzes: number };
  progress: AdminUserProgressRow[];
  quizResults: AdminUserQuizResult[];
};

/** Feature 6 — editable «عن المنصة» + Telegram live link. */
export type AboutContent = {
  intro: string;
  dua: string;
  thanks: string;
  closing: string;
  telegramIntro: string;
  telegramUrl: string;
  telegramLabel: string;
};
