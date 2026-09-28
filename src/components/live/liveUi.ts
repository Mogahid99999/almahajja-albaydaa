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
  | 'network'
  | 'unknown';

const ERROR_CODES: readonly LiveErrorCode[] = [
  'gender_required',
  'not_open',
  'banned',
  'forbidden',
  'not_found',
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
