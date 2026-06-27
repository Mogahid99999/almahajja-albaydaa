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
import type { AttachmentType } from '@/api/types';

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
  // Completed lessons
  'l-aq-1': { position_sec: 1320, completed: true, updated_at: now },
  'l-ut-1': { position_sec: 1490, completed: true, updated_at: now },
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
  return created;
}

export function setLectureStatus(id: string, status: AppLectureStatus) {
  const l = getLectureById(id);
  if (l) {
    l.status = status;
    l.updated_at = new Date().toISOString();
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
  return created;
}

export function removeAttachment(id: string) {
  const idx = attachments.findIndex((a) => a.id === id);
  if (idx >= 0) attachments.splice(idx, 1);
}
