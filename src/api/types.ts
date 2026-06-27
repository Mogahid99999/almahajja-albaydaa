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

/** Admin create payload (file already uploaded → url, or external link). */
export type CreateAttachmentInput = {
  owner: AttachmentOwnerRef;
  type: AttachmentType;
  title: string;
  description?: string | null;
  /** external_url for link/book, or the resolved storage URL for file types. */
  url?: string | null;
  /** transcript text (in-app reader). */
  body?: string | null;
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
  sheikhName: string | null;
  status: AppLectureStatus;
  durationSec: number;
  order: number;
};

export type SheikhOption = { id: string; name: string };
