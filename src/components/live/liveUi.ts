/**
 * Shared, PURE helpers for the live-listening UI (PLAN_LIVE_V23 §7, §15).
 * No React, no store access — so the Home card, the mini-bar, the room and the
 * sheets all word things the same way and tests can pin the copy.
 */
import type { Href } from 'expo-router';

import type { CurrentUser } from '@/api/auth';
import { colors } from '@/constants/theme';
import { arNum, toArabicDigits } from '@/lib/format';

/**
 * The prototype's extra tones for «الحلقة» (no new brand colours — tints of the
 * app's teal/brass/sand, copied from the approved prototype CSS).
 */
export const LIVE = {
  /** `.lm` live marker on sand / on teal. */
  marker: colors.stateDanger,
  markerOnTeal: '#e39580',
  /** `.pav` person tile backgrounds. */
  tintBrother: '#eef0e9',
  tintSister: '#efe6d3',
  tintMe: '#f1e2c2',
  /** Board: inner floor, rug bands, lattice, labels. */
  floor: '#f7f1e4',
  latticeFill: '#efe2c4',
  latticeLine: '#a9834c',
  labelSisters: '#94703a',
  /** Soft ink for disabled bars in the signal pill. */
  dimInk: 'rgba(43,39,35,0.18)',
} as const;

/**
 * The room route. Cast because Expo's generated typed-routes file only learns
 * `app/live/[id].tsx` after the next `expo start` regenerates it.
 */
export function liveRoomHref(id: string): Href {
  return { pathname: '/live/[id]', params: { id } } as unknown as Href;
}

/** `r` attribute of a participant (supabase/functions/_shared/liveRules.ts LiveRole). */
export type LiveRoleKind = 'host' | 'moderator' | 'speaker' | 'listener';

export function roleKind(role: unknown): LiveRoleKind {
  if (role === 'host') return 'host';
  if (role === 'moderator') return 'moderator';
  if (role === 'speaker') return 'speaker';
  return 'listener';
}

export type Sex = 'm' | 'f';

/** Accepts the room attribute ('m'|'f') or the profile value ('male'|'female'). */
export function sexOf(g: unknown): Sex {
  return g === 'f' || g === 'female' ? 'f' : 'm';
}

/**
 * The app's existing staff check (app/admin/_layout.tsx): a registered admin,
 * publisher or sheikh. These are the live moderators who see real names (D2).
 */
export function isLiveStaff(user: Pick<CurrentUser, 'role' | 'isGuest'> | null | undefined): boolean {
  return (
    !!user &&
    !user.isGuest &&
    (user.role === 'admin' || user.role === 'publisher' || user.role === 'sheikh')
  );
}

/** What other listeners see for a sister who chose «بدون اسم» (§7.7). */
export const HIDDEN_SISTER_NAME = 'طالبة';

// ─── §15 copy ────────────────────────────────────────────────────────────────

export const LIVE_COPY = {
  connecting: 'جارٍ الدخول إلى الحلقة…',
  reconnecting: 'جارٍ إعادة الاتصال…',
  poor: 'الاتصال ضعيف · قد يتقطع الصوت قليلاً',
  hostdrop: 'انقطع اتصال الشيخ مؤقتاً. ابقَ في الحلقة، يُستأنف الصوت تلقائياً عند عودته.',
  offline: 'انقطع اتصالك بالإنترنت. سنعيدك إلى الحلقة تلقائياً عند عودته.',
  failed: 'تعذّر الدخول إلى الحلقة',
  ended: 'انتهى المجلس',
  endedThanks: 'جزاكم الله خيراً على الحضور',
  leave: 'مغادرة الحلقة',
  request: 'طلب الكلمة',
  nobody: 'لا أحد يتحدث الآن',
  meSpeaking: 'أنت تتحدث الآن',
  liveNow: 'مباشر الآن',
  listen: 'استمع',
  backToRoom: 'العودة إلى الحلقة',
  sheikhSpeaking: 'الشيخ يتحدث',
} as const;

/** «يتحدث» / «تتحدث» (§11: gendered verbs). */
export function speakVerb(g: Sex): 'يتحدث' | 'تتحدث' {
  return g === 'f' ? 'تتحدث' : 'يتحدث';
}

/** room.now: «يتحدث الآن: {name}» · «تتحدث الآن: {name}» · «أنت تتحدث الآن» · «لا أحد يتحدث الآن». */
export function nowSpeakingLine(
  speaker: { name: string; gender: Sex; isMe: boolean } | null,
): string {
  if (!speaker) return LIVE_COPY.nobody;
  if (speaker.isMe) return LIVE_COPY.meSpeaking;
  return `${speakVerb(speaker.gender)} الآن: ${speaker.name}`;
}

/** home.card: «بدأ منذ {n} دقيقة». */
export function startedAgoLine(startedAt: string | null | undefined, nowMs: number): string | null {
  if (!startedAt) return null;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return null;
  const n = Math.max(1, Math.floor((nowMs - t) / 60_000));
  return `بدأ منذ ${arNum(n)} دقيقة`;
}

/** home.card: «{count} في الحلقة». */
export function inRoomLine(count: number): string {
  return `${arNum(count)} في الحلقة`;
}

// ─── Errors from join() ─────────────────────────────────────────────────────

/** `LiveTokenError.code` (src/api/live.ts). */
export type LiveErrorCode =
  | 'gender_required'
  | 'not_open'
  | 'banned'
  | 'forbidden'
  | 'not_found'
  | 'live_disabled'
  | 'network'
  | 'unknown';

const ERROR_CODES: readonly LiveErrorCode[] = [
  'gender_required',
  'not_open',
  'banned',
  'forbidden',
  'not_found',
  'live_disabled',
  'network',
  'unknown',
];

/** Duck-typed so a plain `{ code }` rejection works as well as the error class. */
export function liveErrorCode(e: unknown): LiveErrorCode {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return ERROR_CODES.includes(code as LiveErrorCode) ? (code as LiveErrorCode) : 'unknown';
}

// ─── Session status ─────────────────────────────────────────────────────────

/** Statuses after the broadcast (liveRules LiveStatus): the room shows «انتهى المجلس». */
export function isEndedStatus(status: unknown): boolean {
  return (
    status === 'ended' ||
    status === 'processing' ||
    status === 'ready' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

// ─── Dates (upcoming tiles, section pin) ────────────────────────────────────

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** Day label for a scheduled session: «اليوم» / «غداً» / weekday name. */
export function arDayLabel(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const today = new Date(nowMs);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diff === 0) return 'اليوم';
  if (diff === 1) return 'غداً';
  return WEEKDAYS[d.getDay()];
}

/** 12-hour clock with ص/م, Arabic-Indic digits: «٨:٣٠ م». */
export function arClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${toArabicDigits(`${h}:${m}`)} ${h24 < 12 ? 'ص' : 'م'}`;
}

/** Elapsed clock for the room pill («٤٢:١٣»). */
export function elapsedSec(startedAt: string | null | undefined, nowMs: number): number | null {
  if (!startedAt) return null;
  const t = Date.parse(startedAt);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 1000)) : null;
}

const EMPTY: readonly never[] = [];

/** Normalises the staff-participants hook result: an array, or a query `{ data }`. */
export function asList<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const data = typeof res === 'object' && res !== null ? (res as { data?: unknown }).data : undefined;
  return Array.isArray(data) ? (data as T[]) : EMPTY;
}

/** The fields of `LiveStaffParticipant` this UI reads (identity → real name). */
export type StaffName = { identity: string; displayName: string | null; hiddenName: boolean };

export const NO_STAFF_NAMES: ReadonlyMap<string, StaffName> = new Map();

/**
 * The name one viewer sees for one person — the single place that applies D2:
 * staff get the real name (from the staff-only RPC); everyone else gets the
 * LiveKit name, «طالبة» for a sister who chose «بدون اسم».
 */
export function visibleName(
  id: string,
  p: { name?: string | null; gender?: unknown; hidden?: boolean | null },
  isStaff: boolean,
  staff: ReadonlyMap<string, StaffName>,
): string {
  if (isStaff) {
    const real = staff.get(id)?.displayName;
    if (real) return real;
  }
  const f = sexOf(p.gender) === 'f';
  if (p.hidden && f) return HIDDEN_SISTER_NAME;
  return p.name || (f ? 'مستمعة' : 'مستمع');
}

export function staffNameMap(list: readonly unknown[]): Map<string, StaffName> {
  const out = new Map<string, StaffName>();
  for (const row of list) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as { identity?: unknown; displayName?: unknown; hiddenName?: unknown };
    if (typeof r.identity !== 'string') continue;
    out.set(r.identity, {
      identity: r.identity,
      displayName: typeof r.displayName === 'string' && r.displayName.trim() ? r.displayName : null,
      hiddenName: r.hiddenName === true,
    });
  }
  return out;
}

// ─── P4: speaking & moderation (PLAN_LIVE_V23 §7.6, §15) ─────────────────────

/** The host's green room (typed routes learn it on the next `expo start`). */
export function liveGreenHref(id: string): Href {
  return { pathname: '/live/green/[id]', params: { id } } as unknown as Href;
}

export const LIVE_P4_COPY = {
  requestPending: 'بانتظار الإذن · إلغاء',
  requestsClosed: 'لا يستقبل المشرفون طلبات الكلمة الآن',
  micOn: 'الميكروفون مفتوح',
  micOff: 'الميكروفون مغلق',
  micOpenA11y: 'فتح الميكروفون',
  micCloseA11y: 'إغلاق الميكروفون',
  stepDown: 'العودة إلى الاستماع',
  approve: 'السماح بالكلمة',
  reject: 'الاعتذار',
  mute: 'إغلاق الميكروفون',
  allowRequests: 'استقبال طلبات الكلمة',
  requests: 'طلبات الكلمة',
  manage: 'إدارة المجلس',
  leaveKeep: 'أغادر ويستمر البث',
  endAll: 'إنهاء البث للجميع',
  endConfirm: 'إنهاء البث للجميع؟',
  endUndo: 'ينتهي البث خلال ثوانٍ',
  undo: 'تراجع',
  notifyAll: 'إشعار للجميع عند البدء',
  startLive: 'ابدأ مجلساً مباشراً',
  backToGreen: 'العودة إلى غرفة التجهيز',
  greenRoom: 'غرفة التجهيز',
  startBroadcast: 'ابدأ البث',
  cancel: 'إلغاء',
  guestCannotSpeak: 'الضيف يستمع فقط، ولا يمكن إعطاؤه الكلمة',
} as const;

/** One-shot room messages (liveStore `notice.kind` → §15 copy). */
export const NOTICE_COPY = {
  hand_raised: 'رفعت يدك. يراها المشرفون في مكانك من الحلقة',
  accepted: 'صرت من المتحدثين. افتح الميكروفون وأغلقه متى شئت. المجلس يُسجَّل وصوتك ضمنه',
  rejected: 'اعتذر المشرف عن إعطائك الكلمة الآن',
  muted: 'أغلق المشرف ميكروفونك، وتستطيع فتحه متى احتجت',
  demoted: 'أعادك المشرف إلى الاستماع. ارفع يدك من جديد إن أردت الكلمة',
  requests_closed: 'لا يستقبل المشرفون طلبات الكلمة الآن',
  rate_limited: 'انتظر قليلاً ثم حاول مجدداً',
  mic_denied: 'اسمح للتطبيق باستخدام الميكروفون لتتحدث',
  failed: 'تعذّر تنفيذ الطلب. حاول مرة أخرى',
} as const;

export type NoticeKind = keyof typeof NOTICE_COPY;

export function noticeText(kind: unknown): string | null {
  return typeof kind === 'string' && kind in NOTICE_COPY ? NOTICE_COPY[kind as NoticeKind] : null;
}

/** «طلب الكلمة» client rate limit: the button rests this long after each toggle. */
export const HAND_COOLDOWN_MS = 5000;
/** The «إنهاء البث للجميع» undo window (§7.6). */
export const END_UNDO_MS = 5000;
/** How long a room notice stays up. */
export const NOTICE_MS = 6000;

/** The room's host and moderators run it (approve/reject/mute/demote, the requests switch). */
export function isModeratorRole(role: unknown): boolean {
  return role === 'host' || role === 'moderator';
}

/**
 * «إنهاء البث للجميع»: the session's host, or a content manager (admin /
 * publisher) — liveRules authorizeLiveAction `end`.
 */
export function canEndForAll(
  liveRole: unknown,
  user: Pick<CurrentUser, 'role' | 'isGuest'> | null | undefined,
): boolean {
  if (liveRole === 'host') return true;
  return !!user && !user.isGuest && (user.role === 'admin' || user.role === 'publisher');
}

/**
 * Who may open a live from a section page: create_live_session allows
 * is_content_manager() or is_sheikh() — admin, publisher, sheikh — the same set
 * as {@link isLiveStaff}.
 */
export function canStartLive(user: Pick<CurrentUser, 'role' | 'isGuest'> | null | undefined): boolean {
  return isLiveStaff(user);
}

type PersonLike = {
  role?: unknown;
  hand?: boolean | null;
  handAt?: number | null;
  micOn?: boolean | null;
  isMe?: boolean | null;
};

/** Raised hands the moderators take, oldest first (`handAt`; 0/null = an old server's '1' → first). */
export function requestQueue(people: Readonly<Record<string, PersonLike>>): string[] {
  const out: { id: string; at: number; i: number }[] = [];
  let i = 0;
  for (const [id, p] of Object.entries(people)) {
    i++;
    if (!p || !p.hand || p.isMe || roleKind(p.role) !== 'listener') continue;
    out.push({ id, at: typeof p.handAt === 'number' && Number.isFinite(p.handAt) ? p.handAt : 0, i });
  }
  out.sort((a, b) => a.at - b.at || a.i - b.i);
  return out.map((x) => x.id);
}

/** On the floor now (speakers + moderators; not the host, not me) — ManageSheet. */
export function currentSpeakers(people: Readonly<Record<string, PersonLike>>): string[] {
  return Object.entries(people)
    .filter(([, p]) => !!p && !p.isMe && (roleKind(p.role) === 'speaker' || roleKind(p.role) === 'moderator'))
    .map(([id]) => id);
}

/** Other moderators present — who the host can hand the session to («أغادر ويستمر البث»). */
export function otherModerators(people: Readonly<Record<string, PersonLike>>): string[] {
  return Object.entries(people)
    .filter(([, p]) => !!p && !p.isMe && roleKind(p.role) === 'moderator')
    .map(([id]) => id);
}

export type ModerationAction = 'approve' | 'reject' | 'mute' | 'demote';

/**
 * What a moderator may do to one person (liveRules canTarget): approve/reject a
 * listener's raised hand; mute a speaker or a moderator (never the host);
 * demote a speaker only (moderators are staff — never demoted). Nothing on myself.
 */
export function moderationActionsFor(p: PersonLike | null | undefined): ModerationAction[] {
  if (!p || p.isMe) return [];
  const kind = roleKind(p.role);
  if (kind === 'listener') return p.hand ? ['approve', 'reject'] : [];
  if (kind === 'speaker') return p.micOn ? ['mute', 'demote'] : ['demote'];
  if (kind === 'moderator') return p.micOn ? ['mute'] : [];
  return [];
}

/** Action button label; «إعادته / إعادتها إلى الاستماع» follows the target's gender. */
export function moderationLabel(action: ModerationAction, g: Sex): string {
  switch (action) {
    case 'approve':
      return LIVE_P4_COPY.approve;
    case 'reject':
      return LIVE_P4_COPY.reject;
    case 'mute':
      return LIVE_P4_COPY.mute;
    case 'demote':
      return g === 'f' ? 'إعادتها إلى الاستماع' : 'إعادته إلى الاستماع';
  }
}

/** «يطلب الكلمة» / «تطلب الكلمة», with how long ago the hand went up. */
export function handLine(g: Sex, handAt: number | null | undefined, nowMs: number): string {
  const verb = g === 'f' ? 'تطلب الكلمة' : 'يطلب الكلمة';
  if (!handAt) return verb;
  const min = Math.floor((nowMs / 1000 - handAt) / 60);
  return min >= 1 ? `${verb} · منذ ${arNum(min)} دقيقة` : `${verb} · الآن`;
}

/** A live-control refusal (LiveControlError.code) → one short Arabic line. */
export function controlErrorText(e: unknown, g: Sex = 'm'): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  switch (code) {
    case 'guest_cannot_speak':
      return LIVE_P4_COPY.guestCannotSpeak;
    case 'not_present':
      return g === 'f' ? 'غادرت الحلقة' : 'غادر الحلقة';
    case 'invalid_target':
      return 'تغيّر الحال في الحلقة، حاول مرة أخرى';
    case 'forbidden':
      return 'لا تملك صلاحية هذا الإجراء';
    case 'no_moderator_present':
      return 'لا يوجد مشرف آخر في الحلقة الآن';
    case 'another_live_active':
      return 'يوجد بث مباشر قائم الآن، ولا يُفتح بثّان معاً';
    case 'ended':
      return LIVE_COPY.ended;
    case 'invalid_state':
    case 'not_open':
      return 'لا يمكن ذلك في حال المجلس الآن';
    case 'network':
      return 'تعذّر الاتصال. تحقّق من الشبكة ثم حاول مرة أخرى';
    case 'banned':
      return 'لا يمكنك دخول هذا المجلس';
    case 'no_track':
      return g === 'f' ? 'ميكروفونها مغلق أصلاً' : 'ميكروفونه مغلق أصلاً';
    case 'requests_closed':
      return NOTICE_COPY.requests_closed;
    case 'rate_limited':
      return NOTICE_COPY.rate_limited;
    default:
      return NOTICE_COPY.failed;
  }
}

/** The server's own Arabic message when it has one (create_live_session / cancel), else `fallback`. */
export function rpcErrorText(e: unknown, fallback: string): string {
  const msg = typeof e === 'object' && e !== null ? (e as { message?: unknown }).message : undefined;
  return typeof msg === 'string' && /[؀-ۿ]/.test(msg) ? msg.trim() : fallback;
}

/** create_live_session title rule (3–200 chars, trimmed). */
export function isValidLiveTitle(title: string): boolean {
  const t = title.trim();
  return t.length >= 3 && t.length <= 200;
}

/** Green-room meter: how many of `bars` segments a 0..1 level lights. */
export function meterBars(level: number, bars: number): number {
  const l = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  return Math.round(l * bars);
}

// ─── P5: share links, native intents, buddy invite (PLAN_LIVE_V23 §9, §15) ───

/** D8: public share links live on go.almahajja.app (App Links / Universal Links + fallback page). */
export const LIVE_SHARE_HOST = 'go.almahajja.app';

/** «https://go.almahajja.app/live/{share_code}» (D8). */
export function liveShareLink(shareCode: string): string {
  return `https://${LIVE_SHARE_HOST}/live/${encodeURIComponent(shareCode.trim())}`;
}

/**
 * §9.3 share message: «يُبث الآن: {title} · {session}، مع {sheikh}.\nاستمع في
 * المحجّة البيضاء:\n{link}». A missing section / sheikh drops its part only.
 */
export function liveShareMessage(
  s: { title: string; sectionTitle?: string | null; sheikhName?: string | null },
  link: string,
): string {
  const section = s.sectionTitle?.trim() ? ` · ${s.sectionTitle.trim()}` : '';
  const sheikh = s.sheikhName?.trim() ? `، مع ${s.sheikhName.trim()}` : '';
  return `يُبث الآن: ${s.title.trim()}${section}${sheikh}.\nاستمع في المحجّة البيضاء:\n${link}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARE_CODE_CHARS_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
/** Segments under /live that are routes, not share codes. */
const LIVE_RESERVED = new Set(['code', 'green']);
/**
 * A single segment right under /live, from the App/Universal Link
 * (https://go.almahajja.app/live/X), our scheme (riwaqalilm://live/X,
 * riwaqalilm:///live/X) or a bare path (/live/X). Query / hash / one trailing
 * slash are ignored.
 */
const LIVE_ONE_SEGMENT_RE =
  /^(?:https?:\/\/go\.almahajja\.app\/|riwaqalilm:\/\/\/?|\/)live\/([^/?#]+)\/?(?:[?#].*)?$/i;

/**
 * expo-router `redirectSystemPath` (app/+native-intent.tsx): the public URL is
 * /live/{code} but the app route for a code is /live/code/[code]. Maps
 * https://go.almahajja.app/live/<code> and riwaqalilm://live/<non-uuid> to
 * «/live/code/<code>»; everything else — /live/<uuid>, /live/green/<uuid>,
 * /live/code/<code>, other hosts and paths — comes back unchanged. Never throws.
 */
export function liveSystemPath(path: string): string {
  if (typeof path !== 'string') return path;
  const m = LIVE_ONE_SEGMENT_RE.exec(path.trim());
  if (!m) return path;
  let seg: string;
  try {
    seg = decodeURIComponent(m[1]).trim();
  } catch {
    return path;
  }
  if (!seg || UUID_RE.test(seg) || LIVE_RESERVED.has(seg.toLowerCase())) return path;
  const upper = seg.replace(/[\s-]/g, '').toUpperCase();
  const code = SHARE_CODE_CHARS_RE.test(upper) ? upper : seg;
  return `/live/code/${encodeURIComponent(code)}`;
}

/** §15 share + §9.2 buddy copy (gender follows the viewer — buddies are same-gender). */
export const LIVE_P5_COPY = {
  share: 'مشاركة رابط البث',
  shareExplain: 'من لديه التطبيق يدخل الحلقة مباشرة، ومن ليس لديه يُوجَّه إلى متجر جهازه.',
  shareAction: 'مشاركة',
  remind: 'ذكّرني',
  reminded: 'سنذكّرك',
  remindCancelA11y: 'إلغاء التذكير',
  remindFailed: 'تعذّر حفظ التذكير. حاول مرة أخرى',
  inviteFailed: 'تعذّر إرسال الدعوة. حاول مرة أخرى',
} as const;

/** «رفيقك» / «رفيقتك». */
export function buddyWord(g: Sex): 'رفيقك' | 'رفيقتك' {
  return g === 'f' ? 'رفيقتك' : 'رفيقك';
}

/** Highlight for a buddy sitting in the room: «رفيقك · حسن». */
export function buddyPresentLine(name: string, g: Sex): string {
  return `${buddyWord(g)} · ${name}`;
}

/** «رفيقك {name} ليس في الحلقة» · «رفيقتك {name} ليست في الحلقة». */
export function buddyAbsentLine(name: string, g: Sex): string {
  return g === 'f' ? `رفيقتك ${name} ليست في الحلقة` : `رفيقك ${name} ليس في الحلقة`;
}

/** The invite action: «ادعُه» / «ادعيها». */
export function inviteVerb(g: Sex): 'ادعُه' | 'ادعيها' {
  return g === 'f' ? 'ادعيها' : 'ادعُه';
}

/** «أُرسلت الدعوة إلى {name}». */
export function inviteSentLine(name: string): string {
  return `أُرسلت الدعوة إلى ${name}`;
}

/** BuddyInviteSheet title / sub and the ShareSheet row that opens it. */
export function inviteSheetTitle(g: Sex): string {
  return g === 'f' ? 'ادعي رفيقتك إلى الحلقة' : 'ادعُ رفيقك إلى الحلقة';
}

export function inviteSheetSub(g: Sex): string {
  return g === 'f'
    ? 'يصل رفيقتك إشعار بدعوتك إلى هذا المجلس، مرة واحدة لكل رفيقة.'
    : 'يصل رفيقك إشعار بدعوتك إلى هذا المجلس، مرة واحدة لكل رفيق.';
}
