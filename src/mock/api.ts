/**
 * Mock implementations of every `src/api/*` function, returning the UI DTOs in
 * `src/api/types.ts`. Active while `USE_MOCK` is true. Only `src/api/*` imports
 * this module.
 */
import { arNum } from '@/lib/format';
import {
  cancelResumeReminder,
  cancelSeriesReminder,
  presentCompletionPraise,
  scheduleResumeReminders,
  scheduleSeriesReminder,
} from '@/lib/notifications';
import {
  NOTIFICATION_TYPES,
  type AdminLectureRow,
  type Attachment,
  type AttachmentOwnerRef,
  type Badge,
  type CreateAttachmentInput,
  type FlatSectionNode,
  type GoalMetric,
  type HomeData,
  type JourneySummary,
  type LectureCard,
  type LecturePlayback,
  type LectureProgressStatus,
  type LectureRow,
  type NotificationItem,
  type NotificationPrefs,
  type NotificationType,
  type ResumeLecture,
  type SectionCard,
  type SectionEditData,
  type SectionPageData,
  type SheikhOption,
  type UnclassifiedItem,
  type WeeklyGoal,
} from '@/api/types';
import { BADGES, type BadgeDef } from '@/constants/badges';
import { MAX_LISTEN_TICK_SEC, type AppLectureStatus } from '@/config';
import * as db from './db';

const delay = () => new Promise<void>((r) => setTimeout(r, 120));

function progressStatus(lectureId: string): LectureProgressStatus {
  const p = db.progress[lectureId];
  if (!p) return 'new';
  if (p.completed) return 'completed';
  return p.position_sec > 0 ? 'in_progress' : 'new';
}

function sectionCard(s: db.DSection): SectionCard {
  const { total, completed } = db.rollup(s.id);
  return {
    id: s.id,
    title: s.title,
    coverLetter: s.cover_letter,
    lectureCount: total,
    progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

function lectureCard(l: db.DLecture): LectureCard {
  const parent = l.section_id ? db.getSectionById(l.section_id) : undefined;
  return {
    id: l.id,
    title: l.title,
    sheikhName: db.sheikhName(l.sheikh_id),
    durationSec: l.duration_sec ?? 0,
    coverLetter: parent?.cover_letter ?? '✦',
  };
}

function eyebrowFor(l: db.DLecture): string {
  return `الدرس ${arNum(l.order + 1)}`;
}

/** Map a stored attachment → UI DTO. `body` is only included for the reader. */
function toAttachment(a: db.DAttachment, includeBody = false): Attachment {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    url: a.url,
    body: includeBody ? a.body : null,
    order: a.order,
  };
}

// --- Home --------------------------------------------------------------------
export async function getHomeData(): Promise<HomeData> {
  await delay();
  let continueListening: ResumeLecture | null = null;
  const lastId = db.lastPlayedLectureId;
  if (lastId) {
    const l = db.getLectureById(lastId);
    const p = db.progress[lastId];
    if (l && p && !p.completed) {
      const parent = l.section_id ? db.getSectionById(l.section_id) : undefined;
      continueListening = {
        id: l.id,
        title: l.title,
        sheikhName: db.sheikhName(l.sheikh_id),
        eyebrow: `${eyebrowFor(l)}${parent ? ` · ${parent.title}` : ''}`,
        positionSec: p.position_sec,
        durationSec: l.duration_sec ?? 0,
      };
    }
  }

  const newlyAdded = db.lectures
    .filter((l) => l.status === 'published')
    .slice()
    .reverse()
    .slice(0, 8)
    .map(lectureCard);

  const sections = db.childrenOf(null).map(sectionCard);
  return { continueListening, newlyAdded, sections };
}

// --- Section page ------------------------------------------------------------
export async function getSectionPage(sectionId: string): Promise<SectionPageData> {
  await delay();
  const s = db.getSectionById(sectionId);
  if (!s) throw new Error(`section not found: ${sectionId}`);

  const parent = s.parent_id ? db.getSectionById(s.parent_id) : undefined;
  const { total, completed } = db.rollup(sectionId);
  const subsections = db.childrenOf(sectionId).map(sectionCard);

  const lectures: LectureRow[] = db.lectures
    .filter((l) => l.section_id === sectionId && l.status === 'published')
    .sort((a, b) => a.order - b.order)
    .map((l) => ({
      id: l.id,
      title: l.title,
      durationSec: l.duration_sec ?? 0,
      sheikhName: db.sheikhName(l.sheikh_id),
      status: progressStatus(l.id),
      positionSec: db.progress[l.id]?.position_sec ?? 0,
      order: l.order,
    }));

  return {
    section: {
      id: s.id,
      title: s.title,
      description: s.description,
      coverLetter: s.cover_letter,
      coverImage: s.cover_image,
      showHeader: s.show_header,
    },
    parentTitle: parent?.title ?? null,
    sheikhNames: db.sheikhNamesIn(sectionId),
    rollup: {
      total,
      completed,
      progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    subsections,
    lectures,
    attachments: db.attachmentsForSection(sectionId).map((a) => toAttachment(a)),
  };
}

// --- Player ------------------------------------------------------------------
export async function getLecturePlayback(lectureId: string): Promise<LecturePlayback> {
  await delay();
  const l = db.getLectureById(lectureId);
  if (!l) throw new Error(`lecture not found: ${lectureId}`);
  const parent = l.section_id ? db.getSectionById(l.section_id) : undefined;
  return {
    id: l.id,
    title: l.title,
    sheikhName: db.sheikhName(l.sheikh_id),
    eyebrow: eyebrowFor(l),
    sectionTitle: parent?.title ?? null,
    sectionId: l.section_id ?? null,
    order: l.order,
    durationSec: l.duration_sec ?? 0,
    audioUrl: l.audio_path,
    positionSec: db.progress[l.id]?.position_sec ?? 0,
    attachments: db.attachmentsForLecture(l.id).map((a) => toAttachment(a)),
  };
}

/** The next published lecture in the same section (immediately-higher order). */
export async function getNextLecture(
  sectionId: string | null,
  currentOrder: number,
): Promise<{ id: string } | null> {
  await delay();
  if (!sectionId) return null;
  const next = db.lectures
    .filter(
      (l) => l.section_id === sectionId && l.status === 'published' && l.order > currentOrder,
    )
    .sort((a, b) => a.order - b.order)[0];
  return next ? { id: next.id } : null;
}

/** The previous published lecture in the same section (immediately-lower order). */
export async function getPreviousLecture(
  sectionId: string | null,
  currentOrder: number,
): Promise<{ id: string } | null> {
  await delay();
  if (!sectionId) return null;
  const prev = db.lectures
    .filter(
      (l) => l.section_id === sectionId && l.status === 'published' && l.order < currentOrder,
    )
    .sort((a, b) => b.order - a.order)[0];
  return prev ? { id: prev.id } : null;
}

// --- Attachments -------------------------------------------------------------
export async function listSectionAttachments(sectionId: string): Promise<Attachment[]> {
  await delay();
  return db.attachmentsForSection(sectionId).map((a) => toAttachment(a));
}

export async function listLectureAttachments(lectureId: string): Promise<Attachment[]> {
  await delay();
  return db.attachmentsForLecture(lectureId).map((a) => toAttachment(a));
}

export async function getAttachment(id: string): Promise<Attachment> {
  await delay();
  const a = db.getAttachmentById(id);
  if (!a) throw new Error(`attachment not found: ${id}`);
  return toAttachment(a, true);
}

/** Mock file "upload": there's no bucket, so the local uri stands in for the
 *  storage path (it's directly viewable). Live returns an `attachments` path. */
export async function uploadAttachmentFile(file: {
  uri: string;
  name: string;
  mimeType?: string | null;
}): Promise<string> {
  await delay();
  return file.uri;
}

export async function createAttachment(input: CreateAttachmentInput): Promise<Attachment> {
  await delay();
  const created = db.addAttachment({
    type: input.type,
    title: input.title,
    description: input.description ?? null,
    // In mock the displayable url is either the external link or the local uri
    // returned by uploadAttachmentFile (stored here as storagePath).
    url: input.url ?? input.storagePath ?? null,
    body: input.body ?? null,
    section_id: input.owner.kind === 'section' ? input.owner.id : null,
    lecture_id: input.owner.kind === 'lecture' ? input.owner.id : null,
  });
  return toAttachment(created, true);
}

export async function deleteAttachment(id: string): Promise<void> {
  await delay();
  db.removeAttachment(id);
}

export async function reorderAttachments(
  _owner: AttachmentOwnerRef,
  orderedIds: string[],
): Promise<void> {
  await delay();
  db.reorderAttachments(orderedIds);
}

export async function getLecturesByIds(ids: string[]): Promise<LectureCard[]> {
  await delay();
  return ids
    .map((id) => db.getLectureById(id))
    .filter((l): l is db.DLecture => !!l)
    .map(lectureCard);
}

// --- Progress ----------------------------------------------------------------
/** Any in-progress (not completed, position > 0) lesson? (§7 dispatcher). */
export async function hasResumableLesson(): Promise<boolean> {
  return Object.values(db.progress).some((p) => !p.completed && p.position_sec > 0);
}

/** Most-recent in-progress lesson as a resume target (bubble). */
export async function getResumeTarget(): Promise<
  { lectureId: string; positionSec: number; title: string; durationSec: number; updatedAt: string } | null
> {
  const entry = Object.entries(db.progress).find(([, p]) => !p.completed && p.position_sec > 0);
  if (!entry) return null;
  const [lectureId, p] = entry;
  const lec = db.getLectureById(lectureId);
  return {
    lectureId,
    positionSec: p.position_sec,
    title: lec?.title ?? 'تابع درسك',
    durationSec: lec?.duration_sec ?? 0,
    updatedAt: p.updated_at,
  };
}

export async function getLectureProgress(lectureId: string) {
  const p = db.progress[lectureId];
  return p ? { position_sec: p.position_sec, completed: p.completed } : null;
}

export async function saveLectureProgress(args: {
  lectureId: string;
  positionSec: number;
  durationSec: number;
}): Promise<Badge[]> {
  // Listened delta = forward movement since the last saved position, capped so a
  // scrub forward doesn't count as listening. (Single integration point for the
  // رحلتي العلمية daily feed — the player UI is untouched.)
  const prevPos = db.progress[args.lectureId]?.position_sec ?? 0;
  const wasCompleted = db.progress[args.lectureId]?.completed ?? false;
  const firstTouch = db.progress[args.lectureId] === undefined;
  db.setProgress(args.lectureId, args.positionSec, args.durationSec);
  const completed = db.progress[args.lectureId]?.completed ?? false;
  const justCompleted = completed && !wasCompleted;
  const delta = Math.max(0, Math.min(args.positionSec - prevPos, MAX_LISTEN_TICK_SEC));

  // Local notifications (feature B) — same single save seam feature C feeds.
  // Fire-and-forget so a scheduling error never blocks the save or badge return.
  // (The lib no-ops on web / without permission, so the emulator never blocks.)
  const title = db.getLectureById(args.lectureId)?.title ?? 'تابع درسك';

  // Resume ladder: in-progress → schedule the nudge ladder, completed → cancel.
  if (completed) {
    void cancelResumeReminder(args.lectureId);
  } else if (db.prefEnabled('resume_reminder')) {
    void scheduleResumeReminders({
      lectureId: args.lectureId,
      lectureTitle: title,
      positionSec: args.positionSec,
      durationSec: args.durationSec,
      noncompletionEnabled: db.prefEnabled('noncompletion_gentle'),
    });
  }

  // Unfinished-series reminder — any started-but-unfinished section, re-evaluated
  // on first-touch or completion (the moments the remaining count changes).
  const sectionId = db.getLectureById(args.lectureId)?.section_id ?? null;
  if (sectionId && (firstTouch || justCompleted)) {
    const { total, completed: done } = db.rollup(sectionId);
    const remaining = Math.max(0, total - done);
    if (remaining > 0) {
      if (db.prefEnabled('resume_series')) {
        const sectionTitle = db.getSectionById(sectionId)?.title ?? 'سلسلتك العلمية';
        void scheduleSeriesReminder(sectionId, sectionTitle, remaining);
      }
    } else {
      void cancelSeriesReminder(sectionId); // section finished
    }
  }

  // Completion praise — immediate, only on the crossing into completed.
  if (justCompleted && db.prefEnabled('completion_praise')) {
    void presentCompletionPraise(title);
  }

  return recordListening({ lectureId: args.lectureId, deltaSec: delta });
}

// --- Journey · رحلتي العلمية -------------------------------------------------
/** Merge a catalog definition with this user's earned state. */
function toBadge(def: BadgeDef): Badge {
  const earned = db.userBadges.find((b) => b.badge_key === def.key);
  return {
    key: def.key,
    titleAr: def.titleAr,
    descAr: def.descAr,
    threshold: def.threshold,
    kind: def.kind,
    earned: !!earned,
    earnedAt: earned?.earned_at ?? null,
  };
}

/** Earn any newly-qualified badges; return only the ones just earned. */
function evaluateBadges(): Badge[] {
  const completed = db.completedLecturesCount();
  const longest = db.longestStreak();
  const newly: Badge[] = [];
  for (const def of BADGES) {
    if (db.hasBadge(def.key)) continue;
    const qualifies =
      def.kind === 'completed' ? completed >= def.threshold : longest >= def.threshold;
    if (qualifies) {
      db.earnBadge(def.key);
      newly.push(toBadge(def));
    }
  }
  return newly;
}

export async function getJourneySummary(): Promise<JourneySummary> {
  await delay();
  const metric = db.weeklyGoal.metric;
  return {
    completedLectures: db.completedLecturesCount(),
    totalSeconds: db.totalSecondsListened(),
    streak: { current: db.currentStreak(), longest: db.longestStreak() },
    activeDays: db.activeDaysCount(),
    week: {
      metric,
      target: db.weeklyGoal.target,
      current: db.weekProgressCurrent(metric),
    },
  };
}

export async function getWeeklyGoal(): Promise<WeeklyGoal> {
  await delay();
  return { metric: db.weeklyGoal.metric, target: db.weeklyGoal.target };
}

export async function setWeeklyGoal(metric: GoalMetric, target: number): Promise<void> {
  await delay();
  db.setWeeklyGoal(metric, target);
}

export async function getBadges(): Promise<Badge[]> {
  await delay();
  return BADGES.map(toBadge);
}

/** Upsert today's listening + re-evaluate badges. Returns newly-earned badges. */
export async function recordListening(args: {
  lectureId: string | null;
  deltaSec: number;
}): Promise<Badge[]> {
  db.recordDailyListening(args.lectureId, args.deltaSec);
  return evaluateBadges();
}

// --- Notifications · الإشعارات -----------------------------------------------
function toNotificationItem(n: db.DNotification): NotificationItem {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    read: n.read_at !== null,
    createdAt: n.created_at,
  };
}

/** In mock mode the token is fake; we just record that registration ran. */
export async function registerPushToken(_token: string, _platform: string): Promise<void> {
  await delay();
  // No-op store in mock — the live path upserts public.push_tokens.
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  await delay();
  // Absence of an override = ON, so the resolved map is always exhaustive.
  return NOTIFICATION_TYPES.reduce((acc, type) => {
    acc[type] = db.prefEnabled(type);
    return acc;
  }, {} as NotificationPrefs);
}

export async function setNotificationPref(
  type: NotificationType,
  enabled: boolean,
): Promise<void> {
  await delay();
  db.setNotificationPref(type, enabled);
}

export async function listNotifications(): Promise<NotificationItem[]> {
  await delay();
  return [...db.notifications]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(toNotificationItem);
}

export async function markNotificationRead(id: string): Promise<void> {
  await delay();
  db.markNotificationRead(id);
}

export async function markAllRead(): Promise<void> {
  await delay();
  db.markAllNotificationsRead();
}

export async function isSectionFollowed(sectionId: string): Promise<boolean> {
  await delay();
  return db.isFollowed(sectionId);
}

export async function followSection(sectionId: string): Promise<void> {
  await delay();
  db.addFollow(sectionId);
}

export async function unfollowSection(sectionId: string): Promise<void> {
  await delay();
  db.removeFollow(sectionId);
}

// --- Admin -------------------------------------------------------------------
export async function getSectionsFlat(): Promise<FlatSectionNode[]> {
  await delay();
  const out: FlatSectionNode[] = [];
  const walk = (parentId: string | null, depth: number, path: string[]) => {
    for (const s of db.childrenOf(parentId)) {
      const p = [...path, s.title];
      out.push({ id: s.id, title: s.title, parentId, depth, path: p });
      walk(s.id, depth + 1, p);
    }
  };
  walk(null, 0, []);
  return out;
}

export async function getSectionsEditData(): Promise<SectionEditData[]> {
  await delay();
  return db.sections.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    parentId: s.parent_id,
    order: s.order,
    showHeader: s.show_header,
  }));
}

export async function getUnclassifiedLectures(): Promise<UnclassifiedItem[]> {
  await delay();
  return db.lectures
    .filter((l) => l.status === 'unclassified')
    .map((l) => ({
      id: l.id,
      title: l.title,
      sheikhName: db.sheikhName(l.sheikh_id),
      durationSec: l.duration_sec ?? 0,
      createdAt: l.created_at,
    }));
}

export async function getAdminLectures(): Promise<AdminLectureRow[]> {
  await delay();
  return db.lectures.map((l) => ({
    id: l.id,
    title: l.title,
    sectionTitle: l.section_id ? db.getSectionById(l.section_id)?.title ?? null : null,
    sectionId: l.section_id,
    sheikhId: l.sheikh_id,
    sheikhName: db.sheikhName(l.sheikh_id),
    status: l.status,
    durationSec: l.duration_sec ?? 0,
    order: l.order,
  }));
}

export async function getSheikhs(): Promise<SheikhOption[]> {
  await delay();
  return db.sheikhs.map((s) => ({ id: s.id, name: s.name }));
}

export async function createSheikh(name: string): Promise<SheikhOption> {
  await delay();
  const s = db.addSheikh(name.trim());
  return { id: s.id, name: s.name };
}

export async function updateSheikh(id: string, name: string): Promise<void> {
  await delay();
  db.updateSheikh(id, name.trim());
}

export async function deleteSheikh(id: string): Promise<void> {
  await delay();
  db.removeSheikh(id);
}

export async function createLecture(input: {
  title: string;
  sectionId: string | null;
  sheikhId: string | null;
  order: number;
  durationSec?: number | null;
  status: AppLectureStatus;
  /** Ignored in mock — the live path uploads it to the `lectures` bucket. */
  audioFile?: { uri: string; name: string; mimeType?: string | null } | null;
}) {
  await delay();
  return db.addLecture({
    title: input.title,
    section_id: input.sectionId,
    sheikh_id: input.sheikhId,
    order: input.order,
    duration_sec: input.durationSec ?? null,
    status: input.status,
  });
}

export async function setLectureStatus(id: string, status: AppLectureStatus) {
  await delay();
  db.setLectureStatus(id, status);
}

export async function getNextLectureOrder(sectionId: string): Promise<number> {
  await delay();
  const orders = db.lectures
    .filter((l) => l.section_id === sectionId)
    .map((l) => l.order ?? 0);
  return (orders.length ? Math.max(...orders) : 0) + 1;
}

export async function classifyLecture(id: string, sectionId: string, order: number) {
  await delay();
  db.classifyLecture(id, sectionId, order);
}

export async function updateLecture(
  id: string,
  input: {
    title?: string;
    sectionId?: string | null;
    sheikhId?: string | null;
    order?: number;
    status?: AppLectureStatus;
  },
): Promise<void> {
  await delay();
  db.updateLecture(id, {
    title: input.title,
    // `unclassified` ⇒ no section (mirrors the live status mapping).
    section_id: input.status === 'unclassified' ? null : input.sectionId,
    sheikh_id: input.sheikhId,
    order: input.order,
    status: input.status,
  });
}

export async function deleteLecture(id: string): Promise<void> {
  await delay();
  db.removeLecture(id);
}

export async function createSection(input: {
  title: string;
  parentId: string | null;
  description?: string | null;
  coverLetter?: string;
  showHeader?: boolean;
}) {
  await delay();
  return db.addSection({
    title: input.title,
    parent_id: input.parentId,
    description: input.description ?? null,
    cover_letter: input.coverLetter,
    show_header: input.showHeader,
  });
}

export async function updateSection(
  id: string,
  input: {
    title?: string;
    description?: string | null;
    parentId?: string | null;
    order?: number;
    showHeader?: boolean;
  },
): Promise<void> {
  await delay();
  db.updateSection(id, {
    title: input.title,
    description: input.description,
    parent_id: input.parentId,
    order: input.order,
    show_header: input.showHeader,
  });
}

export async function deleteSection(id: string): Promise<void> {
  await delay();
  db.removeSection(id);
}
