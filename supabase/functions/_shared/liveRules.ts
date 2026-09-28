// Live sessions «الحلقة» (V23 §5) — the PURE rules shared by the `live-token`
// and `live-control` edge functions, unit-tested in tests/functions/.
//
// No imports at all (so the app's tsc/jest load it without
// `allowImportingTsExtensions`): the LiveKit SDK, Supabase and crypto stay in
// the functions; everything that decides WHO gets WHAT lives here.
//
// Schema: migrations 0134 live_sessions · 0135 live_participants (+
// live_moderation_log, live_identity) · 0138 set_live_session_status.
// The participant identity is computed IN SQL (live_identity: salted sha256,
// the salt never leaves the DB) — this module only validates its shape.
//
// Owner decisions (PLAN_LIVE_V23 §1.2, confirmed/changed 2026-09-28):
//   D1 only moderators (admin/sheikh/publisher, incl. the host) demote others;
//      a speaker may step down himself.
//   D2 (CHANGED) moderators see every real name: live_participants.display_name
//      always stores the REAL name (+ hidden_name when a sister chose «بدون
//      اسم»); moderators read it via the staff-only get_live_participants RPC.
//      The LiveKit participant `name` — broadcast to EVERYONE in the room —
//      stays «طالبة» for a hidden sister.
//   D3 at most ONE green/live session (0134 unique index; mapped to 409 here).
//   D4 host absent 10 min → the media worker calls live-control `auto_end`
//      with the service-role key (also on room_finished); logged `auto_end`.
//   A live recording must never be lost: egress writes to the VPS disk
//   (/recordings/<env>/…); the media worker backs it up to R2 and compresses.

export type LiveRole = "listener" | "speaker" | "host" | "moderator";
export type LiveStatus =
  | "scheduled" | "green" | "live" | "ended" | "processing" | "ready" | "failed" | "cancelled";
export type LiveGender = "m" | "f";
export type IdentityChoice = "named" | "hidden";

/** Moderate a live (plan §5.1 «moderator»): admin, publisher, sheikh. */
export function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "publisher" || role === "sheikh";
}

/** Content manager (is_content_manager()): admin or publisher. */
export function isContentManagerRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "publisher";
}

// ─── Tokens (§5.1) ───────────────────────────────────────────────────────────

export type LiveGrants = {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canUpdateOwnMetadata: boolean;
  roomAdmin: boolean;
};

/**
 * §5.1 grants table. `speaker` = a listener a moderator approved; a
 * reconnecting speaker's new token keeps the mic (live_participants.role
 * persists it). Nobody is roomAdmin — admin actions go through live-control.
 * Publishing is limited to the microphone by the functions (audio only).
 */
export const LIVE_GRANTS: Readonly<Record<LiveRole, LiveGrants>> = {
  listener: { canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: true, roomAdmin: false },
  speaker: { canSubscribe: true, canPublish: true, canPublishData: false, canUpdateOwnMetadata: true, roomAdmin: false },
  host: { canSubscribe: true, canPublish: true, canPublishData: true, canUpdateOwnMetadata: true, roomAdmin: false },
  moderator: { canSubscribe: true, canPublish: true, canPublishData: true, canUpdateOwnMetadata: true, roomAdmin: false },
};

/** Access-token lifetime (§5.1: 2 h). */
export const TOKEN_TTL = "2h";

/**
 * Permission set for UpdateParticipant when a moderator approves (true) or
 * demotes (false) a speaker. LiveKit replaces the WHOLE permission, so every
 * field is spelled out; the function adds canPublishSources = [MICROPHONE].
 */
export function speakerPermission(canPublish: boolean) {
  return {
    canSubscribe: true,
    canPublish,
    canPublishData: false,
    canUpdateMetadata: true,
    hidden: false,
  };
}

/** The caller's role in THIS session. */
export function liveRoleFor(input: {
  userId: string;
  appRole: string | null | undefined;
  isGuest: boolean;
  hostUserId: string | null | undefined;
  /** live_participants.role from an earlier join (keeps an approved speaker a speaker). */
  storedRole?: string | null;
}): LiveRole {
  if (!input.isGuest && input.hostUserId && input.userId === input.hostUserId) return "host";
  if (!input.isGuest && isStaffRole(input.appRole)) return "moderator";
  if (input.storedRole === "speaker") return "speaker";
  return "listener";
}

export type JoinCheck = { ok: true } | { ok: false; code: "not_open" | "ended" };

/** §5.1 step 1: `green` admits host/moderators only; `live` admits everyone. */
export function canJoin(status: string, role: LiveRole): JoinCheck {
  if (status === "live") return { ok: true };
  if (status === "green") {
    return role === "host" || role === "moderator" ? { ok: true } : { ok: false, code: "not_open" };
  }
  if (status === "scheduled") return { ok: false, code: "not_open" };
  return { ok: false, code: "ended" };
}

/** profiles.gender ('male'|'female') → the room attribute (0135 live_gender_code); null = 409 gender_required. */
export function liveGender(profileGender: string | null | undefined): LiveGender | null {
  if (profileGender === "male") return "m";
  if (profileGender === "female") return "f";
  return null;
}

/**
 * Whether the participant's name is hidden. Only a sister may hide (decision 3,
 * 0135 live_participants_hidden_only_f); a brother is always named. A sister
 * who has not chosen yet is hidden — the privacy-preserving default (the
 * client asks on first entry and sends the choice).
 */
export function resolveHiddenName(
  gender: LiveGender,
  choice?: IdentityChoice | null,
  stored?: boolean | null,
): boolean {
  if (gender !== "f") return false;
  if (choice === "named") return false;
  if (choice === "hidden") return true;
  return stored ?? true;
}

export const HIDDEN_SISTER_NAME = "طالبة";
export const GUEST_NAMES: Readonly<Record<LiveGender, string>> = { m: "ضيف", f: "ضيفة" };
const FALLBACK_NAMES = {
  student: { m: "طالب", f: "طالبة" },
  staff: { m: "مشرف", f: "مشرفة" },
} as const;
const MAX_NAME_LENGTH = 60;
/** live_participants.display_name check (0135): ≤ 120 chars (a trigger re-copies the profile name anyway). */
const MAX_STORED_NAME_LENGTH = 120;

/**
 * The participant `name` everyone in the room sees (§5.1): the display name,
 * «طالبة» for a hidden sister, «ضيف»/«ضيفة» for a guest.
 */
export function participantDisplayName(input: {
  isGuest: boolean;
  gender: LiveGender;
  hiddenName: boolean;
  role: LiveRole;
  displayName?: string | null;
}): string {
  if (input.isGuest) return GUEST_NAMES[input.gender];
  if (input.gender === "f" && input.hiddenName) return HIDDEN_SISTER_NAME;
  const name = (input.displayName ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  if (name) return name;
  const staff = input.role === "host" || input.role === "moderator";
  return FALLBACK_NAMES[staff ? "staff" : "student"][input.gender];
}

/**
 * What live_participants.display_name stores (D2, changed 2026-09-28): the
 * REAL profile name, hidden or not — moderators see it through the staff-only
 * get_live_participants RPC. NULL when the profile has none (guests).
 */
export function realDisplayName(profileName: string | null | undefined): string | null {
  const name = (profileName ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_STORED_NAME_LENGTH);
  return name || null;
}

/** LiveKit participant attributes (§5.1): g gender · r role · h hand · hid hidden. */
export function participantAttributes(input: {
  gender: LiveGender;
  role: LiveRole;
  hiddenName: boolean;
}): Record<string, string> {
  return { g: input.gender, r: input.role, h: "0", hid: input.hiddenName ? "1" : "0" };
}

/** Shape of the SQL-computed identity (live_identity, 0135): 16 lowercase hex. */
export function isLiveIdentity(x: unknown): x is string {
  return typeof x === "string" && /^[0-9a-f]{16}$/.test(x);
}

/** GoTrue ban (auth.users.banned_until) still in force? Banned users get 403 (§10). */
export function isBanned(bannedUntil: string | null | undefined, nowMs: number): boolean {
  if (!bannedUntil) return false;
  const until = Date.parse(bannedUntil);
  return Number.isFinite(until) && until > nowMs;
}

/** Rooms of this env only (`stg_` / `prd_` — 0134 live_config.room_prefix; the worker filters the same way). */
export function isEnvRoom(roomName: string | null | undefined, prefix: string): boolean {
  return !!prefix && typeof roomName === "string" && roomName.length > prefix.length && roomName.startsWith(prefix);
}

/** The client connects over WebSocket to the same host the server API uses. */
export function livekitWsUrl(apiUrl: string): string {
  return apiUrl
    .trim()
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://")
    .replace(/\/+$/, "");
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64url → UTF-8 string (no atob/Buffer dependency: Deno, browsers and jest alike). */
function base64UrlDecode(input: string): string | null {
  const s = input.replace(/-/g, "+").replace(/_/g, "/");
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/**
 * The `role` claim of a JWT, UNVERIFIED — a hint only. live-control never
 * trusts it alone: a `service_role` claim is then proven against PostgREST
 * with an RPC only the service role may execute.
 */
export function jwtRoleClaim(token: string | null | undefined): string | null {
  const parts = (token ?? "").split(".");
  if (parts.length !== 3) return null;
  const json = base64UrlDecode(parts[1]);
  if (!json) return null;
  try {
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Constant-time string comparison (service-role bearer check). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Control (§5.2) ──────────────────────────────────────────────────────────

export const LIVE_ACTIONS = [
  "open_green",
  "start",
  "end",
  "approve",
  "reject",
  "mute",
  "demote",
  "set_allow_requests",
  "host_leave",
  "leave",
  "auto_end",
] as const;
export type LiveAction = (typeof LIVE_ACTIONS)[number];

/** Why the media worker ends a session (auto_end body). */
export const AUTO_END_REASONS = ["host_absent", "room_finished"] as const;
export type AutoEndReason = (typeof AUTO_END_REASONS)[number];

export function isLiveAction(x: unknown): x is LiveAction {
  return typeof x === "string" && (LIVE_ACTIONS as readonly string[]).includes(x);
}

/** Actions that act on another participant (`identity` required). */
export const TARGETED_ACTIONS: readonly LiveAction[] = ["approve", "reject", "mute", "demote"];

export type LiveActor =
  /** The service role — the media worker (auto_end only). */
  | { kind: "system" }
  | {
    kind: "user";
    appRole: string | null | undefined;
    isGuest: boolean;
    /** live_sessions.host_user_id === caller. */
    isHost: boolean;
    /** The caller's live_participants.role in this session, if they joined. */
    liveRole: string | null;
  };

export type Verdict<C extends string> = { ok: true } | { ok: false; code: C };
const OK = { ok: true } as const;

/**
 * Action → who may perform it (§5.2 «staff only except leave»; D1).
 *  - leave: anyone in the session.
 *  - demote: moderators, or a speaker stepping HIMSELF down (D1).
 *  - approve / reject / mute / set_allow_requests: moderators (admin/sheikh/publisher).
 *  - open_green / start / end: the host, or a content manager (admin/publisher —
 *    the same people cancel_live_session trusts).
 *  - host_leave: the host (hands the session to a moderator present).
 *  - auto_end: ONLY the system (service-role key — the media worker: D4 host
 *    absent, room_finished). The system can do nothing else: every other
 *    action needs a user JWT.
 */
export function authorizeLiveAction(
  action: LiveAction,
  actor: LiveActor,
  opts: { targetIsSelf?: boolean } = {},
): Verdict<"forbidden"> {
  const forbidden = { ok: false, code: "forbidden" } as const;
  if (actor.kind === "system") return action === "auto_end" ? OK : forbidden;
  if (action === "auto_end") return forbidden;
  if (actor.isGuest) {
    return action === "leave" || (action === "demote" && opts.targetIsSelf && actor.liveRole === "speaker")
      ? OK
      : forbidden;
  }
  const staff = isStaffRole(actor.appRole);
  switch (action) {
    case "leave":
      return OK;
    case "demote":
      if (opts.targetIsSelf && actor.liveRole === "speaker") return OK;
      return staff ? OK : forbidden;
    case "approve":
    case "reject":
    case "mute":
    case "set_allow_requests":
      return staff ? OK : forbidden;
    case "open_green":
    case "start":
    case "end":
      return actor.isHost || isContentManagerRole(actor.appRole) ? OK : forbidden;
    case "host_leave":
      return actor.isHost ? OK : forbidden;
    default:
      return forbidden;
  }
}

/**
 * Session-independent first gate (before any lookup): a student or guest can
 * only ever `leave` or step down (`demote` himself) — the host of a session is
 * always staff (create_live_session / host_leave). No user may `auto_end`.
 */
export function preauthorizeLiveAction(
  action: LiveAction,
  caller: { appRole: string | null | undefined; isGuest: boolean },
): Verdict<"forbidden"> {
  const forbidden = { ok: false, code: "forbidden" } as const;
  if (action === "auto_end") return forbidden;
  if (!caller.isGuest && isStaffRole(caller.appRole)) return OK;
  return action === "leave" || action === "demote" ? OK : forbidden;
}

/**
 * Who an action may be aimed at: approve/reject a listener; mute a speaker or
 * moderator (never the host); demote a speaker only (staff aren't demoted);
 * hand the host role to a moderator.
 */
export function canTarget(action: LiveAction, targetRole: string | null | undefined): Verdict<"invalid_target"> {
  const bad = { ok: false, code: "invalid_target" } as const;
  switch (action) {
    case "approve":
    case "reject":
      return targetRole === "listener" ? OK : bad;
    case "mute":
      return targetRole === "speaker" || targetRole === "moderator" ? OK : bad;
    case "demote":
      return targetRole === "speaker" ? OK : bad;
    case "host_leave":
      return targetRole === "moderator" ? OK : bad;
    default:
      return OK;
  }
}

export type Transition = { ok: true; next: LiveStatus } | { ok: false; code: "invalid_state" };

/**
 * Session status after an action — the same graph set_live_session_status
 * (0138) enforces: scheduled→green|cancelled, green→live|cancelled, live→ended.
 *   open_green  scheduled → green (idempotent on green)
 *   start       green → live
 *   end         live → ended · scheduled/green → cancelled
 *   set_allow_requests  scheduled/green/live, unchanged
 *   approve/reject/mute/demote/host_leave  live only, unchanged
 *   leave       any, unchanged
 *   auto_end    live → ended · green → cancelled · anything else unchanged
 *               (idempotent: the worker may retry, or both host_absent and
 *               room_finished may fire)
 */
export function statusAfter(action: LiveAction, status: string): Transition {
  const bad = { ok: false, code: "invalid_state" } as const;
  const same = (): Transition => ({ ok: true, next: status as LiveStatus });
  switch (action) {
    case "open_green":
      return status === "scheduled" || status === "green" ? { ok: true, next: "green" } : bad;
    case "start":
      return status === "green" ? { ok: true, next: "live" } : bad;
    case "end":
      if (status === "live") return { ok: true, next: "ended" };
      if (status === "scheduled" || status === "green") return { ok: true, next: "cancelled" };
      return bad;
    case "set_allow_requests":
      return status === "scheduled" || status === "green" || status === "live" ? same() : bad;
    case "approve":
    case "reject":
    case "mute":
    case "demote":
    case "host_leave":
      return status === "live" ? same() : bad;
    case "leave":
      return same();
    case "auto_end":
      if (status === "live") return { ok: true, next: "ended" };
      if (status === "green") return { ok: true, next: "cancelled" };
      return same();
  }
}

/**
 * live_moderation_log.action (0135 check list) for an action, or null when it
 * isn't logged (`leave`). A speaker demoting himself is `step_down`; ending a
 * session that never went live is `cancel`; the worker's end is `auto_end`.
 */
export function auditAction(
  action: LiveAction,
  ctx: { targetIsSelf?: boolean; next?: LiveStatus } = {},
): string | null {
  if (action === "leave") return null;
  if (action === "auto_end") return "auto_end";
  if (action === "end") return ctx.next === "cancelled" ? "cancel" : "end";
  if (action === "demote" && ctx.targetIsSelf) return "step_down";
  return action;
}

/** D4: minutes of host absence before the worker ends the session. */
export const HOST_ABSENCE_END_MS = 10 * 60_000;

export function hostAbsenceExpired(hostLeftAtMs: number | null | undefined, nowMs: number, graceMs = HOST_ABSENCE_END_MS): boolean {
  return hostLeftAtMs != null && nowMs - hostLeftAtMs >= graceMs;
}

/**
 * LiveKit room settings (§3.5). The server runs with `auto_create: false`, so
 * the functions CreateRoom (idempotent) before anyone joins. The room survives
 * 10 min empty or after the last participant leaves (host drop, D4).
 */
export const ROOM_EMPTY_TIMEOUT_S = 600;
export const ROOM_DEPARTURE_TIMEOUT_S = 600;
export const ROOM_MAX_PARTICIPANTS = 1000;

/** `stg_` → `stg`, `prd_` → `prd`; null for anything else. */
export function envFromRoomPrefix(prefix: string | null | undefined): "stg" | "prd" | null {
  if (prefix === "stg_") return "stg";
  if (prefix === "prd_") return "prd";
  return null;
}

/**
 * Egress output (owner rule: a live recording must never be lost): written to
 * the VPS disk, NOT R2 — `/recordings/<env>/{room_name}-{time}.ogg` (egress
 * filename templates), manifest disabled. The media worker backs the file up
 * to R2 and compresses it.
 */
export function recordingFilepath(env: "stg" | "prd"): string {
  return `/recordings/${env}/{room_name}-{time}.ogg`;
}

/**
 * Recording audio (room-composite, audio_only): Opus 64 kbps, 48 kHz (Opus/OGG
 * runs at 48 kHz) → EncodingOptions { audioCodec: AudioCodec.OPUS,
 * audioBitrate: 64, audioFrequency: 48000 }, sent as the `advanced` options.
 */
export const RECORDING_AUDIO = { bitrateKbps: 64, frequencyHz: 48000 } as const;

/** Room metadata clients read for «استقبال طلبات الكلمة». */
export function roomMetadata(allowRequests: boolean): string {
  return JSON.stringify({ allowRequests });
}

/** Data message a rejected participant receives (§5.2 reject). */
export const REJECTED_MESSAGE = JSON.stringify({ t: "rejected" });

// ─── Errors ──────────────────────────────────────────────────────────────────

export type LiveErrorCode =
  | "bad_request" | "unauthorized" | "forbidden" | "banned" | "not_found" | "not_visible"
  | "gender_required" | "not_open" | "ended" | "invalid_state" | "invalid_target"
  | "another_live_active" | "not_present" | "no_track" | "no_moderator_present"
  | "livekit_error" | "server_error";

export const LIVE_ERROR_STATUS: Readonly<Record<LiveErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  banned: 403,
  not_visible: 403,
  not_found: 404,
  gender_required: 409,
  not_open: 409,
  ended: 409,
  invalid_state: 409,
  invalid_target: 409,
  another_live_active: 409,
  not_present: 409,
  no_track: 409,
  no_moderator_present: 409,
  livekit_error: 502,
  server_error: 500,
};

/** Map a set_live_session_status (0138) error message to our code. */
export function statusRpcErrorCode(message: string | null | undefined): LiveErrorCode {
  const m = message ?? "";
  if (m.includes("يوجد بث مباشر قائم")) return "another_live_active";
  if (m.includes("invalid live transition")) return "invalid_state";
  if (m.includes("not found")) return "not_found";
  return "server_error";
}

// ─── Request parsing ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACK_SID_RE = /^TR_[A-Za-z0-9]{1,64}$/;

export type LiveTokenRequest = { sessionId: string; identityChoice: IdentityChoice | null };

export function parseLiveTokenRequest(body: unknown): { ok: true; value: LiveTokenRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.sessionId !== "string" || !UUID_RE.test(b.sessionId)) return { ok: false, error: "sessionId required" };
  const c = b.identityChoice;
  if (c !== undefined && c !== null && c !== "named" && c !== "hidden") return { ok: false, error: "invalid identityChoice" };
  return { ok: true, value: { sessionId: b.sessionId, identityChoice: (c as IdentityChoice | undefined) ?? null } };
}

export type LiveControlRequest = {
  action: LiveAction;
  sessionId: string;
  /** Target participant (approve/reject/mute/demote), or the new host (host_leave, optional). */
  identity: string | null;
  /** mute: the microphone track; looked up when omitted. */
  trackSid: string | null;
  /** set_allow_requests. */
  allow: boolean | null;
  /** auto_end. */
  reason: AutoEndReason | null;
};

export function parseLiveControlRequest(body: unknown): { ok: true; value: LiveControlRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isLiveAction(b.action)) return { ok: false, error: "invalid action" };
  if (typeof b.sessionId !== "string" || !UUID_RE.test(b.sessionId)) return { ok: false, error: "sessionId required" };
  const identity = b.identity ?? null;
  if (identity !== null && !isLiveIdentity(identity)) return { ok: false, error: "invalid identity" };
  if (TARGETED_ACTIONS.includes(b.action) && identity === null) return { ok: false, error: "identity required" };
  const trackSid = b.trackSid ?? null;
  if (trackSid !== null && (typeof trackSid !== "string" || !TRACK_SID_RE.test(trackSid))) {
    return { ok: false, error: "invalid trackSid" };
  }
  const allow = b.allow ?? null;
  if (b.action === "set_allow_requests" && typeof allow !== "boolean") return { ok: false, error: "allow required" };
  const reason = b.reason ?? null;
  if (reason !== null && !(AUTO_END_REASONS as readonly unknown[]).includes(reason)) {
    return { ok: false, error: "invalid reason" };
  }
  if (b.action === "auto_end" && reason === null) return { ok: false, error: "reason required" };
  return {
    ok: true,
    value: {
      action: b.action,
      sessionId: b.sessionId,
      identity: identity as string | null,
      trackSid: trackSid as string | null,
      allow: typeof allow === "boolean" ? allow : null,
      reason: reason as AutoEndReason | null,
    },
  };
}
