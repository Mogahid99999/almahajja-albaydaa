/**
 * In-memory mock dataset + query/mutation helpers.
 *
 * This is the single source of truth while `USE_MOCK` (src/config.ts) is true.
 * It mirrors the live Supabase schema (sections tree → lectures → per-user
 * progress) and the recursive rollups, but runs entirely on-device so every
 * screen works on the emulator without a network or seeded DB.
 *
 * `src/api/*` is the ONLY thing that imports this — components/hooks never do.
 * Arrays are mutable so admin "create/publish" and "save progress" feel real
 * for the duration of a session.
 */
import { Asset } from 'expo-asset';

import type { AppLectureStatus } from '@/config';
import type {
  AttachmentType,
  GoalMetric,
  NotificationData,
  NotificationType,
} from '@/api/types';

const now = '2026-06-26T00:00:00.000Z';

/** A real bundled recording, for end-to-end playback testing. */
const REAL_AUDIO = Asset.fromModule(
  require('../../assets/sample-lecture.mp3'),
).uri;

// --- Domain entities (supersets of the DB rows, so they're assignable up) -----
export type DSheikh = { id: string; name: string; created_at: string };

export type DSection = {
  id: string;
  title: string;
  description: string | null;
  cover_image: string | null;
  /** Letter-emblem shown on cards / in the section badge (Amiri). */
  cover_letter: string;
  /** PRD §6: admin can hide the header per node. */
  show_header: boolean;
  order: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DLecture = {
  id: string;
  title: string;
  /** In mock mode this holds a directly-playable URL (DB stores a storage path). */
  audio_path: string;
  duration_sec: number | null;
  order: number;
  status: AppLectureStatus;
  /** null while a lecture is unclassified (waiting in the admin review queue). */
  section_id: string | null;
  sheikh_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DProgress = {
  position_sec: number;
  completed: boolean;
  updated_at: string;
};

export type DAttachment = {
  id: string;
  type: AttachmentType;
  title: string;
  description: string | null;
  /** In mock mode the resolved/displayable URL lives here (DB splits it across
   *  storage_path / external_url). null for transcripts. */
  url: string | null;
  /** Transcript text — only for type='transcript', shown in the in-app reader. */
  body: string | null;
  order: number;
  /** Exactly one of section_id / lecture_id is set (mirrors the CHECK). */
  section_id: string | null;
  lecture_id: string | null;
  created_at: string;
  updated_at: string;
};

// Playable sample audio (reliable, CORS-friendly) so playback + download work.
const AUDIO = (n: number) =>
  `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${((n - 1) % 9) + 1}.mp3`;

// --- Sheikhs ------------------------------------------------------------------
export const sheikhs: DSheikh[] = [
  { id: 'sh-1', name: 'الشيخ عبد الله بن سالم', created_at: now },
  { id: 'sh-2', name: 'الشيخ محمد الأمين', created_at: now },
  { id: 'sh-3', name: 'الشيخ صالح بن إبراهيم', created_at: now },
  { id: 'sh-4', name: 'الشيخ أحمد بن يوسف', created_at: now },
];

// --- Sections (nested tree) ---------------------------------------------------
function sec(
  id: string,
  title: string,
  letter: string,
  order: number,
  parent_id: string | null,
  description: string | null = null,
  show_header = true,
): DSection {
  return {
    id, title, description, cover_image: null, cover_letter: letter,
    show_header, order, parent_id, created_at: now, updated_at: now,
  };
}

export const sections: DSection[] = [
  // Top-level subjects (Home grid order)
  sec('aqeedah', 'العقيدة', 'ع', 0, null, 'أصول الاعتقاد وأبوابه', true),
  sec('fiqh', 'الفقه', 'ف', 1, null, 'فقه العبادات والمعاملات', true),
  sec('tafsir', 'التفسير', 'ت', 2, null, 'تفسير كتاب الله', true),
  sec('hadith', 'الحديث', 'ح', 3, null, 'علوم الحديث وشروحه', true),
  sec('seerah', 'السيرة', 'س', 4, null, 'السيرة النبوية ومراحلها', true),
  sec('tazkiyah', 'التزكية', 'ز', 5, null, 'تزكية النفوس والرقائق', true),

  // العقيدة → ...
  sec('tawheed', 'التوحيد', 'ت', 0, 'aqeedah', 'باب التوحيد وأقسامه', true),
  sec('asma-sifat', 'الأسماء والصفات', 'أ', 1, 'aqeedah', 'باب الأسماء والصفات', true),
  sec('usool-thalatha', 'الأصول الثلاثة', 'أ', 2, 'aqeedah', 'شرح الأصول الثلاثة وأدلتها', true),
  // التوحيد → كتاب التوحيد (leaf with lessons)
  sec('kitab-tawheed', 'كتاب التوحيد', 'ك', 0, 'tawheed',
    'شرح كتاب التوحيد للإمام محمد بن عبد الوهاب', true),

  // الفقه → ...
  sec('taharah', 'الطهارة', 'ط', 0, 'fiqh', 'أحكام الطهارة', true),
  sec('salah', 'الصلاة', 'ص', 1, 'fiqh', 'أحكام الصلاة', true),

  // السيرة → السيرة النبوية → المرحلة المكية
  sec('seerah-nabawiyya', 'السيرة النبوية', 'س', 0, 'seerah', 'سيرة النبي ﷺ', true),
  sec('marhala-makkiyya', 'المرحلة المكية', 'م', 0, 'seerah-nabawiyya',
    'من البعثة إلى الهجرة', false), // header hidden — demonstrates PRD §6
];

// --- Lectures -----------------------------------------------------------------
let lectureSeq = 0;
function lec(
  id: string,
  title: string,
  section_id: string | null,
  sheikh_id: string | null,
  order: number,
  duration_sec: number,
  status: AppLectureStatus = 'published',
  audioOverride?: string,
): DLecture {
  return {
    id, title, audio_path: audioOverride ?? AUDIO(++lectureSeq), duration_sec, order, status,
    section_id, sheikh_id, created_at: now, updated_at: now,
  };
}

export const lectures: DLecture[] = [
  // كتاب التوحيد (the design's reference lessons)
  lec('l-kt-1', 'باب الأصل الأول: معرفة الله', 'kitab-tawheed', 'sh-1', 0, 1815),
  lec('l-kt-2', 'باب الأصل الثاني: معرفة دين الإسلام', 'kitab-tawheed', 'sh-1', 1, 1700),
  lec('l-kt-3', 'باب الأصل الثالث: معرفة نبيكم ﷺ', 'kitab-tawheed', 'sh-1', 2, 1920),
  lec('l-kt-4', 'باب فضل التوحيد وما يكفّر من الذنوب', 'kitab-tawheed', 'sh-1', 3, 1605),
  lec('l-kt-5', 'باب الدعاء إلى شهادة أن لا إله إلا الله', 'kitab-tawheed', 'sh-2', 4, 1740),
  // Real bundled recording for end-to-end playback testing.
  lec('l-real', 'محاضرة تجريبية — تسجيل حقيقي', 'kitab-tawheed', 'sh-1', 6, 510, 'published', REAL_AUDIO),

  // الأصول الثلاثة
  lec('l-ut-1', 'مقدمة الأصول الثلاثة', 'usool-thalatha', 'sh-1', 0, 1490),
  lec('l-ut-2', 'المسائل الأربع', 'usool-thalatha', 'sh-1', 1, 1560),

  // العقيدة (lectures directly on the parent — PRD §5 example)
  lec('l-aq-1', 'أهمية تعلّم العقيدة', 'aqeedah', 'sh-3', 0, 1320),
  lec('l-aq-2', 'فضل التوحيد', 'aqeedah', 'sh-3', 1, 1410),

  // الطهارة
  lec('l-th-1', 'مدخل إلى أحكام الطهارة', 'taharah', 'sh-2', 0, 1380),
  lec('l-th-2', 'أحكام المياه', 'taharah', 'sh-2', 1, 1450),

  // الصلاة
  lec('l-sl-1', 'مكانة الصلاة في الإسلام', 'salah', 'sh-4', 0, 1600),
  lec('l-sl-2', 'شروط الصلاة', 'salah', 'sh-4', 1, 1680),

  // المرحلة المكية
  lec('l-mk-1', 'المبعث وبدء الوحي', 'marhala-makkiyya', 'sh-4', 0, 1550),
  lec('l-mk-2', 'الجهر بالدعوة', 'marhala-makkiyya', 'sh-4', 1, 1490),

  // Unclassified (waiting in the admin review queue — no section yet)
  lec('l-un-1', 'تسجيل وارد: درس في فضل العلم', null, 'sh-1', 0, 1230, 'unclassified'),
  lec('l-un-2', 'تسجيل وارد: مجلس في الرقائق', null, null, 0, 980, 'unclassified'),
  // A draft, classified but not yet published
  lec('l-dr-1', 'مسودة: باب خوف العبد من الشرك', 'kitab-tawheed', 'sh-1', 5, 1510, 'draft'),
];

// --- Per-user progress (single mock student) ----------------------------------
export const progress: Record<string, DProgress> = {
  // Real-recording test lecture — set as the "continue listening" card so it's
  // one tap to test real playback from Home.
  'l-real': { position_sec: 30, completed: false, updated_at: now },
  // Resume / "continue listening" card — 62% through, matches the design.
  'l-kt-1': { position_sec: 1122, completed: false, updated_at: now },
  // Completed lessons — seeded to 7 so رحلتي العلمية has a believable history.
  'l-aq-1': { position_sec: 1320, completed: true, updated_at: now },
  'l-aq-2': { position_sec: 1410, completed: true, updated_at: now },
  'l-ut-1': { position_sec: 1490, completed: true, updated_at: now },
  'l-ut-2': { position_sec: 1560, completed: true, updated_at: now },
  'l-kt-2': { position_sec: 1700, completed: true, updated_at: now },
  'l-kt-3': { position_sec: 1920, completed: true, updated_at: now },
  'l-th-2': { position_sec: 1450, completed: true, updated_at: now },
  // Lightly started
  'l-th-1': { position_sec: 240, completed: false, updated_at: now },
};

/** The lecture the student should resume (most recently touched, incomplete). */
export let lastPlayedLectureId: string | null = 'l-real';

// --- Attachments (PRD §13) ----------------------------------------------------
// Owned by a section node OR a lecture. Sample public URLs so view/download work
// on the emulator; transcript carries inline `body` for the in-app reader.
const SAMPLE_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
const SAMPLE_IMG = 'https://picsum.photos/seed/almahajja/800/560';
const SAMPLE_BOOK = 'https://shamela.ws/book/12286';
const SAMPLE_LINK = 'https://binbaz.org.sa';

const TRANSCRIPT_BODY = [
  'بسم الله الرحمن الرحيم، الحمد لله رب العالمين، وصلى الله وسلم على نبينا محمد وعلى آله وصحبه أجمعين، أما بعد:',
  'فإن أول واجب على العبد معرفة الله جل وعلا، ومعرفة دينه، ومعرفة نبيه ﷺ، فهذه هي الأصول الثلاثة التي يُسأل عنها كل أحد في قبره.',
  'قال المصنف رحمه الله: «اعلم أرشدك الله لطاعته أن الحنيفية ملة إبراهيم: أن تعبد الله وحده مخلصاً له الدين»، وفي هذا بيان أن التوحيد هو الغاية التي خلق الله الخلق من أجلها.',
  'ومن لطائف هذا الباب: أن العلم قبل القول والعمل، كما بوّب البخاري رحمه الله، فلا يصح قولٌ ولا عملٌ إلا بعلمٍ يسبقه.',
].join('\n\n');

function att(
  id: string,
  type: AttachmentType,
  title: string,
  order: number,
  owner: { section_id: string } | { lecture_id: string },
  opts: { description?: string | null; url?: string | null; body?: string | null } = {},
): DAttachment {
  return {
    id,
    type,
    title,
    description: opts.description ?? null,
    url: opts.url ?? null,
    body: opts.body ?? null,
    order,
    section_id: 'section_id' in owner ? owner.section_id : null,
    lecture_id: 'lecture_id' in owner ? owner.lecture_id : null,
    created_at: now,
    updated_at: now,
  };
}

export const attachments: DAttachment[] = [
  // On the section كتاب التوحيد — a PDF متن, a كتاب reference, and a رابط.
  att('at-s-1', 'pdf', 'متن كتاب التوحيد (PDF)', 0, { section_id: 'kitab-tawheed' }, {
    description: 'النص الكامل للمتن', url: SAMPLE_PDF,
  }),
  att('at-s-2', 'book', 'كتاب التوحيد — المكتبة الشاملة', 1, { section_id: 'kitab-tawheed' }, {
    description: 'للإمام محمد بن عبد الوهاب', url: SAMPLE_BOOK,
  }),
  att('at-s-3', 'link', 'موقع الشيخ — مادة مساندة', 2, { section_id: 'kitab-tawheed' }, {
    description: 'دروس وفتاوى ذات صلة', url: SAMPLE_LINK,
  }),

  // On the lecture باب الأصل الأول — a transcript (تفريغ) + a صورة (شرح مبسّط).
  att('at-l-1', 'transcript', 'تفريغ الدرس', 0, { lecture_id: 'l-kt-1' }, {
    description: 'نص الدرس مكتوباً', body: TRANSCRIPT_BODY,
  }),
  att('at-l-2', 'image', 'خريطة الأصول الثلاثة', 1, { lecture_id: 'l-kt-1' }, {
    description: 'مخطط توضيحي', url: SAMPLE_IMG,
  }),
];

let attachmentSeq = 0;

// =============================================================================
// Query helpers (mirror the SQL + recursive rollups)
// =============================================================================
export function childrenOf(parentId: string | null): DSection[] {
  return sections
    .filter((s) => s.parent_id === parentId)
    .sort((a, b) => a.order - b.order);
}

/** All descendant section ids (inclusive) of a node — the recursive subtree. */
export function subtreeIds(sectionId: string): string[] {
  const out: string[] = [sectionId];
  const stack = [sectionId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf(cur)) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

export function publishedLecturesIn(sectionIds: string[]): DLecture[] {
  const set = new Set(sectionIds);
  return lectures.filter(
    (l) => l.status === 'published' && l.section_id && set.has(l.section_id),
  );
}

/** { total, completed } across the whole subtree under a section (this user). */
export function rollup(sectionId: string): { total: number; completed: number } {
  const ls = publishedLecturesIn(subtreeIds(sectionId));
  const completed = ls.filter((l) => progress[l.id]?.completed).length;
  return { total: ls.length, completed };
}

export function sheikhName(id: string | null): string | null {
  return id ? (sheikhs.find((s) => s.id === id)?.name ?? null) : null;
}

/** Distinct sheikh names across a section's subtree (for the chips row). */
export function sheikhNamesIn(sectionId: string): string[] {
  const ids = new Set(
    publishedLecturesIn(subtreeIds(sectionId))
      .map((l) => l.sheikh_id)
      .filter((x): x is string => !!x),
  );
  return [...ids].map((id) => sheikhName(id)).filter((x): x is string => !!x);
}

export function getLectureById(id: string): DLecture | undefined {
  return lectures.find((l) => l.id === id);
}

export function getSectionById(id: string): DSection | undefined {
  return sections.find((s) => s.id === id);
}

export function attachmentsForSection(sectionId: string): DAttachment[] {
  return attachments
    .filter((a) => a.section_id === sectionId)
    .sort((a, b) => a.order - b.order);
}

export function attachmentsForLecture(lectureId: string): DAttachment[] {
  return attachments
    .filter((a) => a.lecture_id === lectureId)
    .sort((a, b) => a.order - b.order);
}

export function getAttachmentById(id: string): DAttachment | undefined {
  return attachments.find((a) => a.id === id);
}

// --- Mutations ----------------------------------------------------------------
export function setProgress(lectureId: string, positionSec: number, durationSec: number) {
  const prev = progress[lectureId];
  const completed =
    prev?.completed || (durationSec > 0 && positionSec / durationSec >= 0.9);
  progress[lectureId] = {
    position_sec: positionSec,
    completed,
    updated_at: new Date().toISOString(),
  };
  lastPlayedLectureId = lectureId;
}

export function addLecture(input: {
  title: string;
  section_id: string | null;
  sheikh_id: string | null;
  order: number;
  duration_sec?: number | null;
  status: AppLectureStatus;
}): DLecture {
  const created: DLecture = {
    id: `l-new-${Date.now()}`,
    title: input.title,
    audio_path: AUDIO(lectures.length + 1),
    duration_sec: input.duration_sec ?? 1500,
    order: input.order,
    status: input.status,
    section_id: input.section_id,
    sheikh_id: input.sheikh_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  lectures.push(created);
  // Faked fan-out: a published lecture in a followed subtree → inbox row.
  fanOutNewLecture(created);
  return created;
}

export function setLectureStatus(id: string, status: AppLectureStatus) {
  const l = getLectureById(id);
  if (l) {
    const wasPublished = l.status === 'published';
    l.status = status;
    l.updated_at = new Date().toISOString();
    // Only fan out on the draft/unclassified → published transition.
    if (!wasPublished && status === 'published') fanOutNewLecture(l);
  }
}

export function classifyLecture(id: string, sectionId: string, order: number) {
  const l = getLectureById(id);
  if (l) {
    l.section_id = sectionId;
    l.order = order;
    l.updated_at = new Date().toISOString();
  }
}

export function updateLecture(
  id: string,
  input: {
    title?: string;
    section_id?: string | null;
    sheikh_id?: string | null;
    order?: number;
    status?: AppLectureStatus;
  },
) {
  const l = getLectureById(id);
  if (!l) return;
  const wasPublished = l.status === 'published';
  if (input.title !== undefined) l.title = input.title;
  if (input.section_id !== undefined) l.section_id = input.section_id;
  if (input.sheikh_id !== undefined) l.sheikh_id = input.sheikh_id;
  if (input.order !== undefined) l.order = input.order;
  if (input.status !== undefined) l.status = input.status;
  l.updated_at = new Date().toISOString();
  if (!wasPublished && l.status === 'published' && l.section_id) fanOutNewLecture(l);
}

export function removeLecture(id: string) {
  const idx = lectures.findIndex((l) => l.id === id);
  if (idx >= 0) lectures.splice(idx, 1);
  delete progress[id];
  for (let i = attachments.length - 1; i >= 0; i -= 1) {
    if (attachments[i].lecture_id === id) attachments.splice(i, 1);
  }
}

// --- Sheikh mutations ---------------------------------------------------------
export function addSheikh(name: string): DSheikh {
  const created: DSheikh = {
    id: `sh-new-${Date.now()}`,
    name,
    created_at: new Date().toISOString(),
  };
  sheikhs.push(created);
  return created;
}

export function updateSheikh(id: string, name: string) {
  const s = sheikhs.find((x) => x.id === id);
  if (s) s.name = name;
}

export function removeSheikh(id: string) {
  const idx = sheikhs.findIndex((s) => s.id === id);
  if (idx >= 0) sheikhs.splice(idx, 1);
  // Lectures keep playing — clear the dangling ref (DB: ON DELETE SET NULL).
  lectures.forEach((l) => {
    if (l.sheikh_id === id) l.sheikh_id = null;
  });
}

export function addSection(input: {
  title: string;
  parent_id: string | null;
  description?: string | null;
  cover_letter?: string;
  show_header?: boolean;
}): DSection {
  const siblings = childrenOf(input.parent_id);
  const created = sec(
    `s-new-${Date.now()}`,
    input.title,
    input.cover_letter ?? input.title.trim().charAt(0),
    siblings.length,
    input.parent_id,
    input.description ?? null,
    input.show_header ?? true,
  );
  sections.push(created);
  return created;
}

export function updateSection(
  id: string,
  input: {
    title?: string;
    description?: string | null;
    parent_id?: string | null;
    order?: number;
    show_header?: boolean;
  },
) {
  const s = getSectionById(id);
  if (!s) return;
  if (input.title !== undefined) s.title = input.title;
  if (input.description !== undefined) s.description = input.description;
  if (input.parent_id !== undefined) s.parent_id = input.parent_id;
  if (input.order !== undefined) s.order = input.order;
  if (input.show_header !== undefined) s.show_header = input.show_header;
  s.updated_at = new Date().toISOString();
}

/** Delete a section + its whole subtree (mirrors the DB ON DELETE CASCADE). */
export function removeSection(id: string) {
  const idSet = new Set(subtreeIds(id)); // inclusive of id
  const removedLectureIds = new Set(
    lectures.filter((l) => l.section_id && idSet.has(l.section_id)).map((l) => l.id),
  );
  for (let i = lectures.length - 1; i >= 0; i -= 1) {
    const sid = lectures[i].section_id;
    if (sid && idSet.has(sid)) lectures.splice(i, 1);
  }
  for (let i = attachments.length - 1; i >= 0; i -= 1) {
    const a = attachments[i];
    if (
      (a.section_id && idSet.has(a.section_id)) ||
      (a.lecture_id && removedLectureIds.has(a.lecture_id))
    ) {
      attachments.splice(i, 1);
    }
  }
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    if (idSet.has(sections[i].id)) sections.splice(i, 1);
  }
}

export function addAttachment(input: {
  type: AttachmentType;
  title: string;
  description?: string | null;
  url?: string | null;
  body?: string | null;
  section_id: string | null;
  lecture_id: string | null;
}): DAttachment {
  const siblings = input.section_id
    ? attachmentsForSection(input.section_id)
    : input.lecture_id
      ? attachmentsForLecture(input.lecture_id)
      : [];
  const created: DAttachment = {
    id: `at-new-${Date.now()}-${++attachmentSeq}`,
    type: input.type,
    title: input.title,
    description: input.description ?? null,
    url: input.url ?? null,
    body: input.body ?? null,
    order: siblings.length,
    section_id: input.section_id,
    lecture_id: input.lecture_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  attachments.push(created);
  // Faked fan-out: a new attachment on a followed section/lecture → inbox row.
  fanOutNewAttachment(created);
  return created;
}

export function removeAttachment(id: string) {
  const idx = attachments.findIndex((a) => a.id === id);
  if (idx >= 0) attachments.splice(idx, 1);
}

/** Reassign `order` for one owner's attachments to match `orderedIds`. */
export function reorderAttachments(orderedIds: string[]) {
  orderedIds.forEach((id, index) => {
    const a = attachments.find((x) => x.id === id);
    if (a) {
      a.order = index;
      a.updated_at = new Date().toISOString();
    }
  });
}

// =============================================================================
// Journey · رحلتي العلمية (Phase 2 · feature C)
// Personal-only: weekly goal, مداومة/streak, milestone badges. Mirrors the SQL
// semantics in supabase/migrations/0004_journey.sql so behavior matches when the
// USE_MOCK flag flips. Streak/week/totals are computed here the same way the
// rollup RPCs compute them server-side (never via UI tree-walking).
// =============================================================================

const MS_DAY = 86400000;

/** Local date key 'YYYY-MM-DD' — streak/week use the student's own day. */
export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKey(d);
}

/** Midnight-local timestamp for a 'YYYY-MM-DD' key (for day arithmetic). */
function parseDay(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** One row per (user, day). `lecture_ids` = distinct lectures heard that day. */
export type DDailyListening = {
  day: string;
  seconds_listened: number;
  lecture_ids: Set<string>;
};

// Seeded RELATIVE to runtime "today" so the demo always reads as a current,
// unbroken 5-day streak (a hardcoded past date would read as a broken streak).
export const dailyListening: Record<string, DDailyListening> = {
  [daysAgoKey(4)]: { day: daysAgoKey(4), seconds_listened: 1320, lecture_ids: new Set(['l-aq-1']) },
  [daysAgoKey(3)]: { day: daysAgoKey(3), seconds_listened: 1490, lecture_ids: new Set(['l-ut-1', 'l-ut-2']) },
  [daysAgoKey(2)]: { day: daysAgoKey(2), seconds_listened: 900,  lecture_ids: new Set(['l-kt-2']) },
  [daysAgoKey(1)]: { day: daysAgoKey(1), seconds_listened: 1610, lecture_ids: new Set(['l-kt-3', 'l-th-2']) },
  [daysAgoKey(0)]: { day: daysAgoKey(0), seconds_listened: 600,  lecture_ids: new Set(['l-kt-1']) },
};

/** The active weekly goal (one per user). Default mirrors the DB default. */
export const weeklyGoal: { metric: GoalMetric; target: number } = {
  metric: 'lectures',
  target: 3,
};

export type DUserBadge = { badge_key: string; earned_at: string };

// Pre-earned to match the seeded history (7 completed, longest streak 5) so the
// grid is coherent on first run: completed_1/_5 + streak_3 earned, rest locked.
export const userBadges: DUserBadge[] = [
  { badge_key: 'completed_1', earned_at: `${daysAgoKey(4)}T09:00:00.000Z` },
  { badge_key: 'completed_5', earned_at: `${daysAgoKey(2)}T09:00:00.000Z` },
  { badge_key: 'streak_3', earned_at: `${daysAgoKey(2)}T09:00:00.000Z` },
];

// --- Journey rollups (mirror the SQL RPCs) ------------------------------------

/** Days (keys) with any listening. */
function activeDayKeys(): Set<string> {
  return new Set(
    Object.values(dailyListening)
      .filter((r) => r.seconds_listened > 0)
      .map((r) => r.day),
  );
}

/** Run of consecutive listening days ending today or yesterday (else 0). */
export function currentStreak(): number {
  const active = activeDayKeys();
  if (active.size === 0) return 0;

  const cursor = new Date();
  if (active.has(dayKey(cursor))) {
    // anchor = today
  } else {
    cursor.setDate(cursor.getDate() - 1);
    if (!active.has(dayKey(cursor))) return 0; // last activity older than yesterday
  }

  let count = 0;
  while (active.has(dayKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/** Longest run of consecutive listening days, ever (kept so it's never lost). */
export function longestStreak(): number {
  const days = [...activeDayKeys()].map(parseDay).sort((a, b) => a - b);
  if (days.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = days[i] - days[i - 1] === MS_DAY ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Most recent Saturday (inclusive) — start of the Sat→Fri week. */
function weekStartKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
  return dayKey(d);
}

/** Daily rows falling inside the current Sat→Fri week. */
function weekRows(): DDailyListening[] {
  const start = parseDay(weekStartKey());
  const end = start + 6 * MS_DAY;
  return Object.values(dailyListening).filter((r) => {
    const t = parseDay(r.day);
    return t >= start && t <= end;
  });
}

/** Progress toward the active goal this week (minutes or distinct lectures). */
export function weekProgressCurrent(metric: GoalMetric): number {
  const rows = weekRows();
  if (metric === 'minutes') {
    return Math.floor(rows.reduce((s, r) => s + r.seconds_listened, 0) / 60);
  }
  const set = new Set<string>();
  rows.forEach((r) => r.lecture_ids.forEach((id) => set.add(id)));
  return set.size;
}

export function totalSecondsListened(): number {
  return Object.values(dailyListening).reduce((s, r) => s + r.seconds_listened, 0);
}

export function activeDaysCount(): number {
  return activeDayKeys().size;
}

export function completedLecturesCount(): number {
  return Object.values(progress).filter((p) => p.completed).length;
}

// --- Journey mutations --------------------------------------------------------

/** Upsert today's row: add the listened delta + union the lecture into the set. */
export function recordDailyListening(lectureId: string | null, deltaSec: number) {
  const key = dayKey();
  const row =
    dailyListening[key] ??
    (dailyListening[key] = { day: key, seconds_listened: 0, lecture_ids: new Set() });
  row.seconds_listened += Math.max(0, deltaSec);
  if (lectureId) row.lecture_ids.add(lectureId);
}

export function hasBadge(key: string): boolean {
  return userBadges.some((b) => b.badge_key === key);
}

export function earnBadge(key: string) {
  if (!hasBadge(key)) {
    userBadges.push({ badge_key: key, earned_at: new Date().toISOString() });
  }
}

export function setWeeklyGoal(metric: GoalMetric, target: number) {
  weeklyGoal.metric = metric;
  weeklyGoal.target = target;
}

// =============================================================================
// Notifications · الإشعارات (Phase 2 · feature B)
// All personal to the single mock student. Mirrors supabase/migrations/0003:
//   * follows                 — sections the student follows (follow ⇒ subtree)
//   * notificationPrefOverrides — per-type on/off; ABSENCE of a key = ON
//   * notifications           — the in-app inbox rows
// The server-side cross-user fan-out is faked locally here: when an admin
// publishes a lecture / adds an attachment in a FOLLOWED subtree, we insert an
// in-app notification row (honoring prefs). No Expo Push, no Edge Function.
// =============================================================================

export type DNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData;
  read_at: string | null;
  created_at: string;
};

/** Sections the student follows (a follow implies the whole subtree). */
export const follows = new Set<string>(['kitab-tawheed', 'fiqh']);

/**
 * Per-type pref overrides. A type ABSENT from this map defaults to ON (mirrors
 * "absence of a notification_prefs row = enabled"). Seeded empty → all ON.
 */
export const notificationPrefOverrides: Partial<Record<NotificationType, boolean>> = {};

function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * 3600000).toISOString();
}

/** Inbox rows, newest first. Seeded coherent with the follows above. */
export const notifications: DNotification[] = [
  {
    id: 'nt-1',
    type: 'new_lecture',
    title: 'درس جديد في كتاب التوحيد',
    body: 'باب الدعاء إلى شهادة أن لا إله إلا الله',
    data: { lectureId: 'l-kt-5', sectionId: 'kitab-tawheed' },
    read_at: null,
    created_at: hoursAgoIso(3),
  },
  {
    id: 'nt-2',
    type: 'new_attachment',
    title: 'مرفق جديد في كتاب التوحيد',
    body: 'متن كتاب التوحيد (PDF)',
    data: { attachmentId: 'at-s-1', sectionId: 'kitab-tawheed' },
    read_at: null,
    created_at: hoursAgoIso(20),
  },
  {
    id: 'nt-3',
    type: 'new_lecture',
    title: 'درس جديد في الفقه',
    body: 'مكانة الصلاة في الإسلام',
    data: { lectureId: 'l-sl-1', sectionId: 'salah' },
    read_at: hoursAgoIso(40),
    created_at: hoursAgoIso(48),
  },
];

let notificationSeq = 0;

/** Section ids from `sectionId` up to the root (inclusive). */
export function ancestorsInclusive(sectionId: string): string[] {
  const out: string[] = [];
  let cur: string | null = sectionId;
  while (cur) {
    out.push(cur);
    cur = getSectionById(cur)?.parent_id ?? null;
  }
  return out;
}

/** True if the student follows this section directly. */
export function isFollowed(sectionId: string): boolean {
  return follows.has(sectionId);
}

/** True if a follow on this section OR any ancestor covers it (subtree rule). */
export function followCoversSection(sectionId: string): boolean {
  return ancestorsInclusive(sectionId).some((id) => follows.has(id));
}

export function addFollow(sectionId: string) {
  follows.add(sectionId);
}

export function removeFollow(sectionId: string) {
  follows.delete(sectionId);
}

/** Resolved on/off for a type (absence of an override = ON). */
export function prefEnabled(type: NotificationType): boolean {
  return notificationPrefOverrides[type] ?? true;
}

export function setNotificationPref(type: NotificationType, enabled: boolean) {
  notificationPrefOverrides[type] = enabled;
}

export function markNotificationRead(id: string) {
  const n = notifications.find((x) => x.id === id);
  if (n && !n.read_at) n.read_at = new Date().toISOString();
}

export function markAllNotificationsRead() {
  const now = new Date().toISOString();
  notifications.forEach((n) => {
    if (!n.read_at) n.read_at = now;
  });
}

function pushNotification(row: Omit<DNotification, 'id' | 'created_at' | 'read_at'>) {
  notifications.unshift({
    ...row,
    id: `nt-new-${Date.now()}-${++notificationSeq}`,
    read_at: null,
    created_at: new Date().toISOString(),
  });
}

/**
 * Faked fan-out for a freshly-published lecture: if the student follows the
 * lecture's section (or an ancestor) and the `new_lecture` pref is on, drop an
 * inbox row. The live path runs this server-side for ALL followers.
 */
export function fanOutNewLecture(lecture: DLecture) {
  if (lecture.status !== 'published' || !lecture.section_id) return;
  if (!followCoversSection(lecture.section_id)) return;
  if (!prefEnabled('new_lecture')) return;
  const section = getSectionById(lecture.section_id);
  pushNotification({
    type: 'new_lecture',
    title: `درس جديد في ${section?.title ?? 'قسم متابَع'}`,
    body: lecture.title,
    data: { lectureId: lecture.id, sectionId: lecture.section_id },
  });
}

/** Faked fan-out for a new attachment on a followed section/lecture. */
export function fanOutNewAttachment(att: DAttachment) {
  const sectionId =
    att.section_id ??
    (att.lecture_id ? getLectureById(att.lecture_id)?.section_id ?? null : null);
  if (!sectionId || !followCoversSection(sectionId)) return;
  if (!prefEnabled('new_attachment')) return;
  const section = getSectionById(sectionId);
  pushNotification({
    type: 'new_attachment',
    title: `مرفق جديد في ${section?.title ?? 'قسم متابَع'}`,
    body: att.title,
    data: att.section_id
      ? { attachmentId: att.id, sectionId }
      : { attachmentId: att.id, lectureId: att.lecture_id ?? undefined, sectionId },
  });
}
