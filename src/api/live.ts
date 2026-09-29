/**
 * Live audio sessions «البث المباشر» (V23 — PLAN_LIVE_V23 §4/§5). The only place
 * that talks to the live backend:
 *  - reads: rpc get_live_now / get_live_by_code, the `live_sessions_public` view
 *    (safe columns, public statuses, section gender scope — 0134/0138), and the
 *    staff-only rpc get_live_participants (D2: moderators see real names);
 *  - edge functions: `live-token` (LiveKit JWT, §5.1) and `live-control`
 *    (state/permission changes, §5.2).
 *
 * The room itself (LiveKit) lives in src/lib/liveClient.ts; the store in
 * src/stores/liveStore.ts.
 */
import { supabase } from '@/lib/supabase';

export type LiveStatus =
  | 'scheduled'
  | 'green'
  | 'live'
  | 'ended'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface LiveSessionPublic {
  id: string;
  sectionId: string;
  sectionTitle: string | null;
  sheikhId: string | null;
  sheikhName: string | null;
  title: string;
  status: LiveStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  shareCode: string;
  /** Only staff reads carry it (live_sessions); 0 from the public reads. */
  peakListeners: number;
}

/** Staff only (get_live_now `green`): the open green room, to get back into it (P4). */
export interface LiveGreenRoom {
  id: string;
  title: string;
  sectionId: string;
  isMine: boolean;
}

export interface LiveNow {
  live: LiveSessionPublic | null;
  upcoming: LiveSessionPublic[];
  /** Upcoming session ids I asked «ذكّرني» for. */
  remindedIds: string[];
  /** Extra (not in the P3 contract): staff's current green room, null for everyone else. */
  green?: LiveGreenRoom | null;
}

const LIVE_STATUSES: readonly LiveStatus[] = [
  'scheduled',
  'green',
  'live',
  'ended',
  'processing',
  'ready',
  'failed',
  'cancelled',
];

export function isLiveStatus(x: unknown): x is LiveStatus {
  return typeof x === 'string' && (LIVE_STATUSES as readonly string[]).includes(x);
}

/** Session statuses after which a room can never be (re)entered. */
export const LIVE_OVER_STATUSES: ReadonlySet<LiveStatus> = new Set<LiveStatus>([
  'ended',
  'processing',
  'ready',
  'failed',
  'cancelled',
]);

/** A live_sessions-shaped row from any of the reads (jsonb RPCs or the view). */
type RawLiveRow = {
  id?: unknown;
  title?: unknown;
  section_id?: unknown;
  section_title?: unknown;
  sheikh_id?: unknown;
  sheikh_name?: unknown;
  status?: unknown;
  scheduled_at?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  share_code?: unknown;
  peak_listeners?: unknown;
  sections?: { title?: unknown } | null;
  sheikhs?: { name?: unknown } | null;
};

const str = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 ? x : null);

/** snake_case row → LiveSessionPublic; null when it has no id. */
export function mapLiveSession(raw: RawLiveRow | null | undefined, fallbackStatus: LiveStatus): LiveSessionPublic | null {
  const id = str(raw?.id);
  if (!raw || !id) return null;
  const peak = Number(raw.peak_listeners ?? 0);
  return {
    id,
    sectionId: str(raw.section_id) ?? '',
    sectionTitle: str(raw.section_title) ?? str(raw.sections?.title),
    sheikhId: str(raw.sheikh_id),
    sheikhName: str(raw.sheikh_name) ?? str(raw.sheikhs?.name),
    title: str(raw.title) ?? '',
    status: isLiveStatus(raw.status) ? raw.status : fallbackStatus,
    scheduledAt: str(raw.scheduled_at),
    startedAt: str(raw.started_at),
    endedAt: str(raw.ended_at),
    shareCode: str(raw.share_code) ?? '',
    peakListeners: Number.isFinite(peak) && peak > 0 ? Math.floor(peak) : 0,
  };
}

/** get_live_now (0138): the live session, the next 3 scheduled + my «ذكّرني» flags. */
export async function getLiveNow(): Promise<LiveNow> {
  const { data, error } = await supabase.rpc('get_live_now');
  if (error) throw error;
  const j = (data ?? {}) as {
    live?: RawLiveRow | null;
    upcoming?: (RawLiveRow & { reminded?: unknown })[] | null;
    green?: { id?: unknown; title?: unknown; section_id?: unknown; is_mine?: unknown } | null;
  };
  const upcomingRaw = Array.isArray(j.upcoming) ? j.upcoming : [];
  const upcoming: LiveSessionPublic[] = [];
  const remindedIds: string[] = [];
  for (const row of upcomingRaw) {
    const s = mapLiveSession(row, 'scheduled');
    if (!s) continue;
    upcoming.push(s);
    if (row.reminded === true) remindedIds.push(s.id);
  }
  const greenId = str(j.green?.id);
  return {
    live: mapLiveSession(j.live, 'live'),
    upcoming,
    remindedIds,
    green:
      j.green && greenId
        ? {
            id: greenId,
            title: str(j.green.title) ?? '',
            sectionId: str(j.green.section_id) ?? '',
            isMine: j.green.is_mine === true,
          }
        : null,
  };
}

/**
 * One session. Students/guests read `live_sessions_public` (public statuses +
 * their section gender scope); staff fall back to the table itself (RLS: staff
 * only), which also sees `green` rooms and carries peak_listeners.
 */
export async function getLiveSession(id: string): Promise<LiveSessionPublic | null> {
  const { data, error } = await supabase
    .from('live_sessions_public')
    .select(
      'id, section_id, sheikh_id, title, status, scheduled_at, started_at, ended_at, share_code, sections(title), sheikhs(name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (data) return mapLiveSession(data as RawLiveRow, 'live');

  const { data: staffRow, error: staffErr } = await supabase
    .from('live_sessions')
    .select(
      'id, section_id, sheikh_id, title, status, scheduled_at, started_at, ended_at, share_code, peak_listeners, sections(title), sheikhs(name)',
    )
    .eq('id', id)
    .maybeSingle();
  // A student is simply denied by RLS (no row) — only a real failure throws.
  if (staffErr) throw staffErr;
  return mapLiveSession(staffRow as RawLiveRow | null, 'live');
}

const SHARE_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** «ABC-234» / « abc234 » → «ABC234»; null when it can't be a share code. */
export function normalizeShareCode(code: string): string | null {
  const c = (code ?? '').replace(/[\s-]/g, '').toUpperCase();
  return SHARE_CODE_RE.test(c) ? c : null;
}

/**
 * Share links (§9.3): get_live_by_code, then the full row when the viewer can
 * read it. A session in a gender-scoped section the viewer can't see
 * (`restricted`) — or an unknown / cancelled code — is null.
 */
export async function getLiveByCode(code: string): Promise<LiveSessionPublic | null> {
  const normalized = normalizeShareCode(code);
  if (!normalized) return null;
  const { data, error } = await supabase.rpc('get_live_by_code', { p_code: normalized });
  if (error) throw error;
  const j = data as (RawLiveRow & { restricted?: unknown }) | null;
  if (!j || j.restricted === true || !str(j.id)) return null;
  const full = await getLiveSession(j.id as string).catch(() => null);
  if (full) return full;
  // Coarse public status (scheduled | live | ended) and no section id — enough
  // to show the card and join by id.
  return mapLiveSession({ ...j, share_code: normalized }, 'ended');
}

// ─── live-token (§5.1) ─────────────────────────────────────────────────────────

export type LiveTokenErrorCode =
  | 'gender_required'
  | 'not_open'
  | 'banned'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'unknown';

const TOKEN_ERROR_TEXT: Record<LiveTokenErrorCode, string> = {
  gender_required: 'يرجى تحديد الجنس للدخول إلى الحلقة.',
  not_open: 'المجلس غير متاح الآن.',
  banned: 'لا يمكنك الدخول إلى الحلقة.',
  forbidden: 'لا يمكنك الدخول إلى هذه الحلقة.',
  not_found: 'لم نجد هذا المجلس.',
  network: 'تعذّر الدخول إلى الحلقة',
  unknown: 'تعذّر الدخول إلى الحلقة',
};

/** Why a join failed; `message` is calm Arabic copy the UI may show as is. */
export class LiveTokenError extends Error {
  readonly code: LiveTokenErrorCode;
  constructor(code: LiveTokenErrorCode, message?: string) {
    super(message ?? TOKEN_ERROR_TEXT[code]);
    this.name = 'LiveTokenError';
    this.code = code;
    Object.setPrototypeOf(this, LiveTokenError.prototype);
  }
}

export interface LiveToken {
  token: string;
  /** wss://live.almahajja.app */
  url: string;
  roomName: string;
  identity: string;
  role: 'listener' | 'speaker' | 'host' | 'moderator';
  /** LiveKit `name` everyone in the room sees. */
  name: string;
  hidden: boolean;
  gender: 'm' | 'f';
}

/** live-token server error code (liveRules.ts LiveErrorCode) → the client's code. */
export function mapLiveTokenErrorCode(serverCode: string | null | undefined, httpStatus?: number): LiveTokenErrorCode {
  switch (serverCode) {
    case 'gender_required':
      return 'gender_required';
    case 'not_open':
    case 'ended':
      return 'not_open';
    case 'banned':
      return 'banned';
    case 'forbidden':
    case 'not_visible':
    case 'unauthorized':
      return 'forbidden';
    case 'not_found':
      return 'not_found';
    default:
      break;
  }
  if (serverCode) return 'unknown';
  if (httpStatus === 401 || httpStatus === 403) return 'forbidden';
  if (httpStatus === 404) return 'not_found';
  return 'unknown';
}

/** Edge-function call bound (functions are unbounded in supabase.ts). */
const LIVE_TOKEN_TIMEOUT_MS = 20_000;
const LIVE_CONTROL_TIMEOUT_MS = 20_000;
/**
 * Hard deadline on the WHOLE invoke. `timeout` only bounds the fetch; before it
 * supabase-js awaits the auth session (GoTrue's lock), which can wait with no
 * bound after the app was backgrounded (e.g. behind the OS mic-permission
 * dialog) — a join / re-join loop awaiting that would hang silently forever.
 */
const INVOKE_DEADLINE_EXTRA_MS = 5_000;

/** Rejects with `onTimeout()` if `p` hasn't settled within `ms`. */
export function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(onTimeout()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** The `{ error }` code + HTTP status of a failed functions.invoke, or a transport failure. */
async function readFunctionError(
  error: unknown,
): Promise<{ transport: boolean; code: string | null; status?: number }> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<unknown> } };
  if (e?.name === 'FunctionsFetchError') return { transport: true, code: null };
  if (e?.name === 'FunctionsRelayError') return { transport: false, code: null };
  let code: string | null = null;
  try {
    const body = (await e?.context?.json?.()) as { error?: unknown } | undefined;
    if (typeof body?.error === 'string') code = body.error;
  } catch {
    // not JSON — fall back to the HTTP status
  }
  return { transport: false, code, status: e?.context?.status };
}

const TOKEN_ROLES = ['listener', 'speaker', 'host', 'moderator'] as const;

/**
 * A LiveKit token for `sessionId` (§5.1). `identityChoice` is a sister's
 * «باسمي» / «بدون اسم» (ignored by the server for brothers). Every failure is a
 * {@link LiveTokenError}; `gender_required` means: show GenderPrompt, then retry.
 */
export async function fetchLiveToken(
  sessionId: string,
  identityChoice?: 'named' | 'hidden',
): Promise<LiveToken> {
  let result: { data: unknown; error: unknown };
  try {
    result = await withDeadline(
      supabase.functions.invoke('live-token', {
        body: identityChoice ? { sessionId, identityChoice } : { sessionId },
        timeout: LIVE_TOKEN_TIMEOUT_MS,
      }),
      LIVE_TOKEN_TIMEOUT_MS + INVOKE_DEADLINE_EXTRA_MS,
      () => new LiveTokenError('network'),
    );
  } catch {
    throw new LiveTokenError('network');
  }
  if (result.error) {
    const f = await readFunctionError(result.error);
    throw new LiveTokenError(f.transport ? 'network' : mapLiveTokenErrorCode(f.code, f.status));
  }
  const d = (result.data ?? {}) as Record<string, unknown>;
  const role = TOKEN_ROLES.find((r) => r === d.role);
  if (
    typeof d.token !== 'string' ||
    !d.token ||
    typeof d.url !== 'string' ||
    !d.url ||
    typeof d.identity !== 'string' ||
    !d.identity ||
    !role ||
    (d.gender !== 'm' && d.gender !== 'f')
  ) {
    throw new LiveTokenError('unknown');
  }
  return {
    token: d.token,
    url: d.url,
    roomName: typeof d.roomName === 'string' ? d.roomName : '',
    identity: d.identity,
    role,
    name: typeof d.name === 'string' ? d.name : '',
    hidden: d.hidden === true,
    gender: d.gender,
  };
}

// ─── live-control (§5.2) ───────────────────────────────────────────────────────

/** A refused/failed live-control call; `code` is the server's (liveRules LiveErrorCode) or 'network'. */
export class LiveControlError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'LiveControlError';
    this.code = code;
    Object.setPrototypeOf(this, LiveControlError.prototype);
  }
}

/**
 * Call live-control: `{ action, ...body }` — body carries `sessionId` and the
 * action's fields (identity, trackSid, allow). P3 only uses `leave`.
 */
export async function liveControl(
  action: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status?: LiveStatus }> {
  let result: { data: unknown; error: unknown };
  try {
    result = await withDeadline(
      supabase.functions.invoke('live-control', {
        body: { ...body, action },
        timeout: LIVE_CONTROL_TIMEOUT_MS,
      }),
      LIVE_CONTROL_TIMEOUT_MS + INVOKE_DEADLINE_EXTRA_MS,
      () => new LiveControlError('network'),
    );
  } catch {
    throw new LiveControlError('network');
  }
  if (result.error) {
    const f = await readFunctionError(result.error);
    throw new LiveControlError(f.transport ? 'network' : (f.code ?? 'unknown'));
  }
  const d = (result.data ?? {}) as { ok?: unknown; status?: unknown };
  return { ok: d.ok === true, status: isLiveStatus(d.status) ? d.status : undefined };
}

// ─── Hosting (P4) ──────────────────────────────────────────────────────────────

/**
 * create_live_session (0138) — sheikh / admin / publisher, from the section page
 * (the recording lands in that section). Starts now: the caller goes straight
 * to the green room. Server errors (D3 «بث آخر قائم», title length…) come back
 * as the Postgres error with an Arabic message.
 */
export async function createLiveSession(input: {
  sectionId: string;
  title: string;
  /** «إشعار للجميع عند البدء». */
  notify?: boolean;
  allowRequests?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_live_session', {
    p_section: input.sectionId,
    p_title: input.title,
    p_notify: input.notify ?? true,
    p_allow_requests: input.allowRequests ?? true,
  });
  if (error) throw error;
  return data as string;
}

/** cancel_live_session (0138) — a scheduled or green session only (a live one ends through live-control). */
export async function cancelLiveSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_live_session', { p_session: sessionId });
  if (error) throw error;
}

// ─── Staff (D2) ────────────────────────────────────────────────────────────────

export interface LiveStaffParticipant {
  identity: string;
  /** The REAL name, even for a sister who chose «بدون اسم» (D2). Empty for guests. */
  displayName: string;
  hiddenName: boolean;
  gender: 'm' | 'f';
  role: string;
  joinedAt: string;
  leftAt: string | null;
  spokeSeconds: number;
}

/** get_live_participants (0138) — content managers + sheikhs only; others get an error. */
export async function getLiveParticipantsForStaff(sessionId: string): Promise<LiveStaffParticipant[]> {
  const { data, error } = await supabase.rpc('get_live_participants', { p_session: sessionId });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const spoke = Number(r.spoke_seconds ?? 0);
    return {
      identity: r.identity,
      displayName: r.display_name ?? '',
      hiddenName: r.hidden_name === true,
      gender: r.gender === 'f' ? 'f' : 'm',
      role: r.role,
      joinedAt: r.joined_at,
      leftAt: r.left_at ?? null,
      spokeSeconds: Number.isFinite(spoke) && spoke > 0 ? Math.round(spoke) : 0,
    };
  });
}

// ─── P5: «ذكّرني», buddy invite (PLAN_LIVE_V23 §9, migration 0142) ────────────
// `as never`: the 0142 RPCs reach database.generated.ts only at the next regen.

/** set_live_reminder (0142) — «ذكّرني» on/off (registered only). Resolves to the new state. */
export async function setLiveReminder(sessionId: string, on: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'set_live_reminder' as never,
    { p_session: sessionId, p_on: on } as never,
  );
  if (error) throw error;
  return (data as unknown) === true;
}

/**
 * invite_buddy_to_live outcome: 'sent' (notified), 'muted' (recorded, but the
 * buddy's buddy_activity pref is off), 'already' (invited before — once per
 * buddy per session, server-enforced). The UI treats all three as «أُرسلت».
 */
export type LiveInviteResult = 'sent' | 'muted' | 'already';

/** invite_buddy_to_live (0142) — the inviter must be registered, in the room, and paired. */
export async function inviteBuddyToLive(sessionId: string, buddyId: string): Promise<LiveInviteResult> {
  const { data, error } = await supabase.rpc(
    'invite_buddy_to_live' as never,
    { p_session: sessionId, p_buddy: buddyId } as never,
  );
  if (error) throw error;
  const r = data as unknown;
  return r === 'muted' || r === 'already' ? r : 'sent';
}

/** One of MY buddies sitting in the room now (get_live_buddies_present, 0142). */
export interface LiveBuddyPresent {
  buddyId: string;
  /** Their LiveKit identity in this session (liveStore `people` key). */
  identity: string;
}

/**
 * «رفيقك · حسن»: my own accepted buddies who are in this room now — never
 * anyone else, never a sister who chose «بدون اسم». Empty for guests / before
 * I entered the room.
 */
export async function getLiveBuddiesPresent(sessionId: string): Promise<LiveBuddyPresent[]> {
  const { data, error } = await supabase.rpc(
    'get_live_buddies_present' as never,
    { p_session: sessionId } as never,
  );
  if (error) throw error;
  const rows = Array.isArray(data) ? (data as { buddy_id?: unknown; identity?: unknown }[]) : [];
  const out: LiveBuddyPresent[] = [];
  for (const r of rows) {
    const buddyId = str(r?.buddy_id);
    const identity = str(r?.identity);
    if (buddyId && identity) out.push({ buddyId, identity });
  }
  return out;
}

/** Buddies I already invited to this session (own rows only — RLS, 0136). */
export async function getLiveInvitedBuddyIds(sessionId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('live_buddy_invites')
    .select('to_user')
    .eq('session_id', sessionId);
  if (error) throw error;
  return (data ?? []).map((r) => r.to_user).filter((x): x is string => typeof x === 'string');
}
