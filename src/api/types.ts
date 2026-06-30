/**
 * UI-facing data-transfer types returned by `src/api/*`.
 *
 * These decouple screens from the data source: identical shape whether served by
 * the mock dataset (now) or Supabase (later). Components/hooks import from here.
 */
import type { AppLectureStatus } from '@/config';

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
 * درس جديد · مرفق جديد · اختبار جديد · تذكير بالمتابعة. `new_quiz` ships now even
 * though quizzes are deferred, so the pref + payload light up later with no
 * migration.
 */
export type NotificationType =
  | 'new_lecture'
  | 'new_attachment'
  | 'new_quiz'
  | 'resume_reminder';

/** Deep-link payload carried on a notification (exactly one target is set). */
export type NotificationData = {
  lectureId?: string;
  sectionId?: string;
  attachmentId?: string;
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

/** "Newly added" rail card. */
export type LectureCard = {
  id: string;
  title: string;
  sheikhName: string | null;
  durationSec: number;
  coverLetter: string;
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
  newlyAdded: LectureCard[];
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
