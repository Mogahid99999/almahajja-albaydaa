/**
 * Pure helpers + copy for the staff «البث المباشر» screen and the live items of
 * «المحاضرات الواردة» (PLAN_LIVE_V23 §8, §15 `admin` row). No React — so the
 * screen, the cards and the tests word things the same way.
 */
import type { CurrentUser } from '@/api/auth';
import type { LiveAdminSession, LiveIntervention, LiveInterventionStint } from '@/api/liveAdmin';
import { colors } from '@/constants/theme';
import { arDuration, arNum } from '@/lib/format';
import { arClock, arDayLabel } from '@/components/live/liveUi';

/** §15 `admin` (ship exactly) + the rest of this screen's copy. */
export const ADMIN_LIVE_COPY = {
  fromLive: 'من بث مباشر',
  required: 'مطلوب منك: العنوان النهائي والشيخ',
  compressing: 'جارٍ الضغط على الخادم',
  // D7 (owner, 2026-09-29): hosting from the browser comes later.
  webStart: 'يبدأ البث من تطبيق الهاتف',
  webStartSub: 'افتح التطبيق على هاتفك، ثم «البث المباشر» من القائمة، واختر القسم.',
  webRoom: 'تُفتح الحلقة من تطبيق الهاتف',
  startTitle: 'ابدأ مجلساً مباشراً',
  startSub: 'اختر القسم الذي يُحفظ فيه التسجيل، ثم تنتقل إلى غرفة التجهيز لتختبر الميكروفون.',
  startCta: 'ابدأ مجلساً مباشراً',
  pickSection: 'اختر القسم...',
  activeBlocks: 'يوجد بث مباشر قائم الآن، ولا يُفتح بثّان معاً',
  liveNow: 'مباشر الآن',
  openRoom: 'فتح الحلقة',
  openGreen: 'فتح غرفة التجهيز',
  inGreen: 'في غرفة التجهيز',
  cancel: 'إلغاء المجلس',
  endLive: 'إنهاء البث للجميع',
  ending: 'جارٍ إنهاء البث…',
  retry: 'إعادة المعالجة',
  deleteRecording: 'حذف التسجيل',
  deletingRecording: 'جارٍ الحذف…',
  recordingDeleted: 'حُذف التسجيل',
  deleteRecordingTitle: 'حذف تسجيل هذا المجلس؟',
  deleteRecordingBody:
    'يُحذف التسجيل نهائياً: المسودة في «الواردة» والملف الصوتي ونسخة البث الأصلية. لا يمكن التراجع.',
  openInbox: 'فتح في الواردة',
  download: 'تنزيل التسجيل الأصلي',
  downloading: 'جارٍ التنزيل…',
  publish: 'نشر',
  publishQuiet: 'نشر بدون إشعار',
  saveDraft: 'حفظ دون نشر',
  change: 'تغيير',
  undoChange: 'تراجع',
  autoOrder: 'الترتيب تلقائي',
  finalTitle: 'العنوان النهائي',
  sheikh: 'الشيخ',
  suggested: 'مقترح',
  interventions: 'المداخلات',
  noInterventions: 'لم يتحدث أحد غير الشيخ في هذا المجلس',
  notifyStudents: 'إشعار الطلاب',
  notifyOn: 'سيصل إشعار لجميع الطلاب عند النشر',
  notifyOff: 'ستُضاف المحاضرة إلى القسم بهدوء — دون إشعار',
  titleRule: 'العنوان من ٣ إلى ٢٠٠ حرف',
  pickSheikh: 'اختر الشيخ...',
} as const;

export type PillTone = 'live' | 'progress' | 'ok' | 'wait' | 'warn' | 'danger' | 'muted';

export const PILL_COLORS: Record<PillTone, { bg: string; fg: string }> = {
  live: { bg: 'rgba(184,92,74,0.12)', fg: colors.stateDanger },
  progress: { bg: 'rgba(44,97,87,0.10)', fg: colors.primaryTeal600 },
  ok: { bg: 'rgba(31,138,91,0.10)', fg: colors.stateSuccess },
  wait: { bg: 'rgba(176,137,79,0.12)', fg: colors.accentBrassMuted },
  warn: { bg: 'rgba(176,137,79,0.16)', fg: colors.accentBrassMuted },
  danger: { bg: 'rgba(184,92,74,0.10)', fg: colors.stateDanger },
  muted: { bg: colors.surfaceInset, fg: colors.textMuted },
};

export interface SessionState {
  tone: PillTone;
  label: string;
  /** 0..1 while the recording is being compressed; null otherwise. */
  progress: number | null;
  /** A second, calmer line (e.g. the job error, «التسجيل الأصلي محفوظ»). */
  note: string | null;
}

/** An ended session with no job yet after this long has lost its recording file. */
const WAIT_FOR_FILE_MS = 2 * 60 * 60 * 1000;

/** Where a session (and its recording) stands, in one pill + optional progress. */
export function sessionState(s: LiveAdminSession, nowMs: number): SessionState {
  if (s.recordingDeleted) {
    return { tone: 'muted', label: ADMIN_LIVE_COPY.recordingDeleted, progress: null, note: null };
  }
  switch (s.status) {
    case 'live':
      return { tone: 'live', label: ADMIN_LIVE_COPY.liveNow, progress: null, note: null };
    case 'green':
      return { tone: 'wait', label: ADMIN_LIVE_COPY.inGreen, progress: null, note: null };
    case 'scheduled':
      return {
        tone: 'muted',
        label: s.scheduledAt ? `${arDayLabel(s.scheduledAt, nowMs)} · ${arClock(s.scheduledAt)}` : 'مجدول',
        progress: null,
        note: null,
      };
    case 'cancelled':
      return { tone: 'muted', label: 'أُلغي', progress: null, note: null };
    case 'ended': {
      const endedMs = s.endedAt ? Date.parse(s.endedAt) : NaN;
      if (Number.isFinite(endedMs) && nowMs - endedMs > WAIT_FOR_FILE_MS) {
        return {
          tone: 'warn',
          label: 'لم يصل ملف التسجيل',
          progress: null,
          note: s.rawLocal || s.rawBackup ? null : 'راجع خادم البث: لم يُسجَّل ملف لهذا المجلس',
        };
      }
      return { tone: 'wait', label: 'بانتظار ملف التسجيل', progress: null, note: null };
    }
    case 'processing': {
      const job = s.job;
      if (!job || job.status === 'queued') {
        return {
          tone: 'progress',
          label: `${ADMIN_LIVE_COPY.compressing} · في الانتظار`,
          progress: 0,
          note: job && job.attempts > 0 ? `محاولة ${arNum(job.attempts + 1)} من ٣` : null,
        };
      }
      if (job.status === 'failed') {
        // Transient: the job failed for good, the session flips to 'failed' next.
        return { tone: 'danger', label: 'تعذّرت معالجة التسجيل', progress: null, note: job.error };
      }
      const p = job.status === 'running' ? job.progress : 1;
      return {
        tone: 'progress',
        label: `${ADMIN_LIVE_COPY.compressing} · ${arNum(Math.floor(p * 100))}٪`,
        progress: p,
        note: null,
      };
    }
    case 'failed':
      return {
        tone: 'danger',
        label: 'تعذّرت معالجة التسجيل',
        progress: null,
        note: s.rawLocal || s.rawBackup
          ? `التسجيل الأصلي محفوظ${s.job?.error ? ` · ${s.job.error}` : ''}`
          : (s.job?.error ?? null),
      };
    case 'ready':
      if (!s.lectureId) return { tone: 'muted', label: 'حُذفت المحاضرة', progress: null, note: null };
      if (s.lectureNeedsTitle) {
        return { tone: 'wait', label: 'جاهز · بانتظار العنوان والشيخ', progress: null, note: null };
      }
      if (s.lectureStatus === 'published') return { tone: 'ok', label: 'منشورة', progress: null, note: null };
      return { tone: 'muted', label: 'محفوظة دون نشر', progress: null, note: null };
    default:
      return { tone: 'muted', label: '—', progress: null, note: null };
  }
}

/** create_live_session: content manager or sheikh (a registered, non-guest one). */
export function canHost(user: Pick<CurrentUser, 'role' | 'isGuest'> | null | undefined): boolean {
  return !!user && !user.isGuest && (user.role === 'admin' || user.role === 'publisher' || user.role === 'sheikh');
}

/** is_content_manager(): admin | publisher — finalize, retry, raw download, cancel any. */
/** 0160 is_lecture_manager: the sheikh also manages lectures (incoming queue, live recordings). */
export function isLectureManager(user: Pick<CurrentUser, 'role' | 'isGuest'> | null | undefined): boolean {
  return !!user && !user.isGuest && (user.role === 'admin' || user.role === 'publisher' || user.role === 'sheikh');
}

export function isContentManager(user: Pick<CurrentUser, 'role' | 'isGuest'> | null | undefined): boolean {
  return !!user && !user.isGuest && (user.role === 'admin' || user.role === 'publisher');
}

/** cancel_live_session: scheduled/green; a content manager any, a sheikh his own. */
export function canCancel(s: LiveAdminSession, manager: boolean): boolean {
  return (s.status === 'scheduled' || s.status === 'green') && (manager || s.isMine);
}

/**
 * «إنهاء البث للجميع» on a LIVE session: its host, or a content manager (admin /
 * publisher) — liveRules authorizeLiveAction `end`. A green room is closed with
 * «إلغاء المجلس» instead ({@link canCancel}).
 */
export function canEndLive(s: LiveAdminSession, manager: boolean): boolean {
  return s.status === 'live' && (manager || s.isMine);
}

/** The end confirmation: where the recording goes. */
export function endLiveMessage(s: Pick<LiveAdminSession, 'title' | 'sectionTitle'>): string {
  const where = s.sectionTitle ? `قسم ${s.sectionTitle}` : 'قسم المجلس';
  return `ينتهي «${s.title}» عند جميع الحاضرين، ويُحفظ التسجيل في ${where}.`;
}

/** «بدأ منذ ساعة و١٢ دقيقة» — a friendlier elapsed line than liveUi's minutes-only one. */
export function startedAgo(startedAt: string | null, nowMs: number): string | null {
  if (!startedAt) return null;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(1, Math.floor((nowMs - t) / 60_000));
  if (min < 60) return `بدأ منذ ${arNum(min)} دقيقة`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hours = h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${arNum(h)} ساعات`;
  return m ? `بدأ منذ ${hours} و${arNum(m)} دقيقة` : `بدأ منذ ${hours}`;
}

/** «١٢ في الحلقة». */
export function attendeesLine(n: number): string {
  return `${arNum(n)} في الحلقة`;
}

/** «حضره ٤٢». */
export function peakLine(n: number): string | null {
  return n > 0 ? `حضره ${arNum(n)}` : null;
}

/** Real name for staff (D2), with a note when a sister chose «بدون اسم». */
export function interventionName(i: Pick<LiveIntervention, 'displayName' | 'hiddenName' | 'gender'>): string {
  const name = i.displayName.trim() || (i.gender === 'f' ? 'مشاركة' : 'مشارك');
  return i.hiddenName ? `${name} (اختارت «بدون اسم»)` : name;
}

/** «١٢:٣٠–١٤:٤٥» from the start of the broadcast (≈ the recording's timeline). */
export function stintLine(st: LiveInterventionStint): string | null {
  if (st.fromSec === null) return null;
  return st.toSec !== null && st.toSec > st.fromSec
    ? `${arDuration(st.fromSec)}–${arDuration(st.toSec)}`
    : `من ${arDuration(st.fromSec)}`;
}

/** «عند ١٢:٣٠–١٤:٤٥ · ٣٤:١٠ · تحدّث ٢:١٥». */
export function interventionLine(i: LiveIntervention): string {
  const parts: string[] = [];
  const stints = i.stints.map(stintLine).filter((x): x is string => !!x);
  if (stints.length) parts.push(`عند ${stints.join(' · ')}`);
  if (i.spokeSeconds > 0) parts.push(`${i.gender === 'f' ? 'تحدّثت' : 'تحدّث'} ${arDuration(i.spokeSeconds)}`);
  else if (!stints.length) parts.push(i.gender === 'f' ? 'سُمح لها بالتحدث' : 'سُمح له بالتحدث');
  if (i.role === 'moderator') parts.push(i.gender === 'f' ? 'مشرفة' : 'مشرف');
  return parts.join(' · ');
}

/** «٣ مداخلات» with the Arabic number agreement. */
export function interventionsCount(n: number): string {
  if (n === 1) return 'مداخلة واحدة';
  if (n === 2) return 'مداخلتان';
  if (n >= 3 && n <= 10) return `${arNum(n)} مداخلات`;
  return `${arNum(n)} مداخلة`;
}

/** create/finalize title rule (3–200 chars trimmed) — same as the RPCs. */
export function isValidFinalTitle(title: string): boolean {
  const t = title.trim();
  return t.length >= 3 && t.length <= 200;
}
