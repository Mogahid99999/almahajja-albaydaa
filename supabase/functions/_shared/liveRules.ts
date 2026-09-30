// Live sessions «الحلقة» (V23 §5) — the PURE rules shared by the `live-token`
// and `live-control` edge functions, unit-tested in tests/functions/.
//
// No imports at all (so the app's tsc/jest load it without
// `allowImportingTsExtensions`): the LiveKit SDK, Supabase and crypto stay in
// the functions; everything that decides WHO gets WHAT lives here.
//
// Schema: migrations 0134 live_sessions · 0135 live_participants (+
// live_moderation_log, live_identity) · 0138 set_live_session_status ·
// 0141 live_participants.hand_at (P4 hand rate limit).
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
//   If an egress dies mid-session (0146 live_recording_parts) the worker
//   recovers its partial file and calls live-control `resume_recording`
//   (service role only, logged `resume_recording`) — a new egress, same settings.
//   Guests LISTEN only (owner 2026-09-28): a guest never raises a hand, is
//   never approved, never gets a speaker token — enforced here, not in the UI.
//
// P4: participant attributes (g/r/h/hid) and the LiveKit name are SERVER-ONLY.
// No token or permission carries canUpdateOwnMetadata/canUpdateMetadata:
// LiveKit lets a participant holding it set ANY attribute and its own name
// (a listener could claim r=host, or rename himself). The hand goes through
// live-control `hand`; an identity change re-joins with a new token.

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

// ─── P7 rollout flag (app_config.live_enabled, migration 0145) ───────────────

/** 'off' → nobody · 'staff' → admin/publisher/sheikh rehearse · 'all' → everyone. */
export type LiveEnabledLevel = "off" | "staff" | "all";

/**
 * The stored app_config value → the level, like SQL live_enabled_level():
 * trimmed + lower-cased; a missing row / unknown value is 'off' (fail closed).
 */
export function parseLiveEnabledLevel(value: unknown): LiveEnabledLevel {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v === "all" || v === "staff" ? v : "off";
}

/**
 * May this caller get a live-token at all (SQL live_enabled_for_caller())?
 * 'all' → everyone (guests too); 'staff' → registered admin/publisher/sheikh
 * only; 'off' / missing / unknown → nobody.
 */
export function liveEnabledFor(level: unknown, appRole: string | null | undefined, isGuest = false): boolean {
  const lvl = parseLiveEnabledLevel(level);
  if (lvl === "all") return true;
  if (lvl === "staff") return !isGuest && isStaffRole(appRole);
  return false;
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
 * persists it; only an explicit `leave` or a demote clears it). Nobody is
 * roomAdmin — admin actions go through live-control. Publishing is limited to
 * the microphone by the functions (audio only). canUpdateOwnMetadata is false
 * for EVERY role (P4 — attributes and name are server-only, see the header).
 */
export const LIVE_GRANTS: Readonly<Record<LiveRole, LiveGrants>> = {
  listener: { canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false, roomAdmin: false },
  speaker: { canSubscribe: true, canPublish: true, canPublishData: false, canUpdateOwnMetadata: false, roomAdmin: false },
  host: { canSubscribe: true, canPublish: true, canPublishData: true, canUpdateOwnMetadata: false, roomAdmin: false },
  moderator: { canSubscribe: true, canPublish: true, canPublishData: true, canUpdateOwnMetadata: false, roomAdmin: false },
};

/** Access-token lifetime (§5.1: 2 h). */
export const TOKEN_TTL = "2h";

/**
 * Permission set for UpdateParticipant when a moderator approves (true) or
 * demotes (false) a speaker. LiveKit replaces the WHOLE permission, so every
 * field is spelled out; the function adds canPublishSources = [MICROPHONE].
 * canUpdateMetadata stays false (P4: attributes/name are server-only).
 */
export function speakerPermission(canPublish: boolean) {
  return {
    canSubscribe: true,
    canPublish,
    canPublishData: false,
    canUpdateMetadata: false,
    hidden: false,
  };
}

/**
 * The caller's role in THIS session. A stored `speaker` (approved earlier)
 * survives a re-join after a network drop — a blip must not silently demote
 * him; an explicit `leave` / a demote is what resets the stored role. A guest
 * is always a listener (guests listen only — also covers a guest approved by a
 * P2 server before the rule was enforced).
 */
export function liveRoleFor(input: {
  userId: string;
  appRole: string | null | undefined;
  isGuest: boolean;
  hostUserId: string | null | undefined;
  /** live_participants.role from an earlier join (keeps an approved speaker a speaker). */
  storedRole?: string | null;
}): LiveRole {
  if (input.isGuest) return "listener";
  if (input.hostUserId && input.userId === input.hostUserId) return "host";
  if (isStaffRole(input.appRole)) return "moderator";
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

/**
 * LiveKit participant attributes (§5.1): g gender · r role · h hand · hid hidden.
 * Server-set only (no grant lets a participant write them). A fresh token
 * starts with the hand down.
 */
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
  "hand",
  "auto_end",
  "resume_recording",
] as const;
export type LiveAction = (typeof LIVE_ACTIONS)[number];

/**
 * Actions ONLY the service role (the media worker) may call — and the only
 * ones it may call: `auto_end` (D4) and `resume_recording` (0146: a new egress
 * after the previous one died mid-session). Every other action needs a user JWT.
 */
export const SYSTEM_ACTIONS: readonly LiveAction[] = ["auto_end", "resume_recording"];

export function isSystemAction(action: LiveAction): boolean {
  return SYSTEM_ACTIONS.includes(action);
}

/** Why the media worker ends a session (auto_end body). */
export const AUTO_END_REASONS = ["host_absent", "room_finished"] as const;
export type AutoEndReason = (typeof AUTO_END_REASONS)[number];

/** Why the worker resumes the recording (resume_recording body, optional; audit detail). */
export const RESUME_REASONS = ["egress_failed", "egress_ended"] as const;
export type ResumeReason = (typeof RESUME_REASONS)[number];

export function isLiveAction(x: unknown): x is LiveAction {
  return typeof x === "string" && (LIVE_ACTIONS as readonly string[]).includes(x);
}

/** Actions that act on another participant (`identity` required). `hand` acts on the caller himself. */
export const TARGETED_ACTIONS: readonly LiveAction[] = ["approve", "reject", "mute", "demote"];

export type LiveActor =
  /** The service role — the media worker (auto_end / resume_recording only). */
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
 * Owner rule (2026-09-28): guests LISTEN only — register to speak. A guest
 * never raises a hand and is never approved (the approve target is read fresh
 * from auth.users.is_anonymous). Its own code so the client can invite the
 * guest to register instead of showing a generic refusal.
 */
export function canSpeak(who: { isGuest: boolean }): Verdict<"guest_cannot_speak"> {
  return who.isGuest ? { ok: false, code: "guest_cannot_speak" } : OK;
}

/**
 * Action → who may perform it (§5.2 «staff only except leave/hand»; D1).
 *  - leave: anyone in the session.
 *  - hand: anyone registered, on HIMSELF; a guest may only lower
 *    (`up: false`) — raising is `guest_cannot_speak`. Whether his live role
 *    may raise is canTarget('hand', …, { up }).
 *  - demote: moderators, or a speaker stepping HIMSELF down (D1).
 *  - approve / reject / mute / set_allow_requests: moderators (admin/sheikh/publisher).
 *  - open_green / start / end: the host, or a content manager (admin/publisher —
 *    the same people cancel_live_session trusts).
 *  - host_leave: the host (hands the session to a moderator present).
 *  - auto_end / resume_recording: ONLY the system (service-role key — the
 *    media worker: D4 host absent / room_finished; an egress that died while
 *    the session is live). The system can do nothing else: every other action
 *    needs a user JWT.
 */
export function authorizeLiveAction(
  action: LiveAction,
  actor: LiveActor,
  opts: { targetIsSelf?: boolean; /** hand: raise (true) / lower (false); missing = raise. */ up?: boolean } = {},
): Verdict<"forbidden" | "guest_cannot_speak"> {
  const forbidden = { ok: false, code: "forbidden" } as const;
  if (actor.kind === "system") return isSystemAction(action) ? OK : forbidden;
  if (isSystemAction(action)) return forbidden;
  if (action === "hand") return opts.up === false ? OK : canSpeak(actor);
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
 * only ever `leave`, step down (`demote` himself) or toggle his own `hand` —
 * the host of a session is always staff (create_live_session / host_leave).
 * No user may `auto_end` or `resume_recording`. A guest raising a hand is refused here already
 * (guest_cannot_speak); lowering stays allowed (idempotent).
 */
export function preauthorizeLiveAction(
  action: LiveAction,
  caller: { appRole: string | null | undefined; isGuest: boolean },
  opts: { /** hand: raise (true) / lower (false); missing = raise. */ up?: boolean } = {},
): Verdict<"forbidden" | "guest_cannot_speak"> {
  const forbidden = { ok: false, code: "forbidden" } as const;
  if (isSystemAction(action)) return forbidden;
  if (action === "hand") return opts.up === false ? OK : canSpeak(caller);
  if (!caller.isGuest && isStaffRole(caller.appRole)) return OK;
  return action === "leave" || action === "demote" ? OK : forbidden;
}

/**
 * Who an action may be aimed at: approve/reject a listener; mute a speaker or
 * moderator (never the host); demote a speaker only (staff aren't demoted);
 * hand the host role to a moderator. `hand` is aimed at the caller himself:
 * only a listener raises (a speaker already has the word; staff never ask);
 * anyone may lower (idempotent).
 */
export function canTarget(
  action: LiveAction,
  targetRole: string | null | undefined,
  opts: { /** hand: raise (true) / lower (false); missing = raise. */ up?: boolean } = {},
): Verdict<"invalid_target"> {
  const bad = { ok: false, code: "invalid_target" } as const;
  switch (action) {
    case "hand":
      return opts.up === false || targetRole === "listener" ? OK : bad;
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
 *   approve/reject/mute/demote/host_leave/hand  live only, unchanged
 *   leave       any, unchanged
 *   auto_end    live → ended · green → cancelled · anything else unchanged
 *               (idempotent: the worker may retry, or both host_absent and
 *               room_finished may fire)
 *   resume_recording  live only, unchanged (a new egress for a live session)
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
    case "hand":
      return status === "live" ? same() : bad;
    case "leave":
      return same();
    case "auto_end":
      if (status === "live") return { ok: true, next: "ended" };
      if (status === "green") return { ok: true, next: "cancelled" };
      return same();
    case "resume_recording":
      return status === "live" ? same() : bad;
  }
}

/**
 * live_moderation_log.action (0135 check list) for an action, or null when it
 * isn't logged (`leave`, `hand` — a participant's own request isn't a
 * moderation act; its last toggle is live_participants.hand_at). A speaker
 * demoting himself is `step_down`; ending a session that never went live is
 * `cancel`; the worker's end is `auto_end`; its new egress after a crash is
 * `resume_recording` (0146 adds it to the check list).
 */
export function auditAction(
  action: LiveAction,
  ctx: { targetIsSelf?: boolean; next?: LiveStatus } = {},
): string | null {
  if (action === "leave" || action === "hand") return null;
  if (action === "auto_end" || action === "resume_recording") return action;
  if (action === "end") return ctx.next === "cancelled" ? "cancel" : "end";
  if (action === "demote" && ctx.targetIsSelf) return "step_down";
  return action;
}

// ─── Hand «طلب التحدث» (P4) ────────────────────────────────────────────────────

/** §10: at most one hand toggle per 5 s per participant (server-side, 0141 hand_at). */
export const HAND_RATE_LIMIT_MS = 5_000;

/**
 * Was the participant's last toggle (live_participants.hand_at, ms) less than
 * the window ago? null/unknown = never toggled = free.
 */
export function handRateLimited(
  lastMs: number | null | undefined,
  nowMs: number,
  windowMs = HAND_RATE_LIMIT_MS,
): boolean {
  return lastMs != null && Number.isFinite(lastMs) && nowMs - lastMs < windowMs;
}

/**
 * The session-level checks of a hand toggle, after authorizeLiveAction /
 * canTarget / statusAfter: raising needs «استقبال طلبات التحدث» on
 * (requests_closed) and the rate limit (rate_limited). Lowering is always
 * allowed — never trap a hand up (it still records hand_at, so a raise right
 * after a lower waits the window).
 */
export function handVerdict(input: {
  up: boolean;
  allowRequests: boolean;
  lastToggleMs: number | null | undefined;
  nowMs: number;
}): Verdict<"requests_closed" | "rate_limited"> {
  if (!input.up) return OK;
  if (!input.allowRequests) return { ok: false, code: "requests_closed" };
  if (handRateLimited(input.lastToggleMs, input.nowMs)) return { ok: false, code: "rate_limited" };
  return OK;
}

/**
 * The `h` attribute value: raised → the raise time in epoch SECONDS (always
 * > 1, so the client's parseHand orders requests oldest first); lowered → '0'.
 */
export function handAttribute(up: boolean, nowMs: number): string {
  return up ? String(Math.floor(nowMs / 1000)) : "0";
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

/** Room metadata clients read for «استقبال طلبات التحدث». */
export function roomMetadata(allowRequests: boolean): string {
  return JSON.stringify({ allowRequests });
}

/** Data message a rejected participant receives (§5.2 reject). */
export const REJECTED_MESSAGE = JSON.stringify({ t: "rejected" });

// ─── Errors ──────────────────────────────────────────────────────────────────

export type LiveErrorCode =
  | "bad_request" | "unauthorized" | "forbidden" | "banned" | "not_found" | "not_visible"
  | "live_disabled"
  | "guest_cannot_speak" | "gender_required" | "not_open" | "ended" | "invalid_state" | "invalid_target"
  | "another_live_active" | "not_present" | "no_track" | "no_moderator_present"
  | "requests_closed" | "rate_limited" | "livekit_error" | "server_error"
  // comments (0147)
  | "guest_cannot_comment" | "not_live" | "blocked" | "blocked_words" | "too_long" | "empty";

export const LIVE_ERROR_STATUS: Readonly<Record<LiveErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  banned: 403,
  not_visible: 403,
  /** P7 app_config.live_enabled is not on for this caller (liveEnabledFor). */
  live_disabled: 403,
  /** Guests listen only (owner 2026-09-28): a guest raising a hand, or being approved. */
  guest_cannot_speak: 403,
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
  /** hand up while «استقبال طلبات التحدث» is off. */
  requests_closed: 409,
  /** hand toggled again within HAND_RATE_LIMIT_MS · a comment within COMMENT_RATE_LIMIT_MS (0147). */
  rate_limited: 429,
  livekit_error: 502,
  server_error: 500,
  /** Comments (0147): guests read, they don't write («سجّل أولاً»). */
  guest_cannot_comment: 403,
  /** Comments are written while the session is `live` only (green included → refused). */
  not_live: 409,
  /** A moderator blocked this author from commenting in this session. */
  blocked: 403,
  /** contains_blocked_word (0052). */
  blocked_words: 400,
  /** More than COMMENT_MAX_CHARS characters (after trimming). */
  too_long: 400,
  /** Nothing but whitespace. */
  empty: 400,
};

/**
 * Map an add_live_recording_part (0146) error to our code: the session is no
 * longer live / another egress already records / part cap → 409 invalid_state
 * (the worker reads it as "nothing to resume").
 */
export function recordingPartRpcErrorCode(message: string | null | undefined): LiveErrorCode {
  const m = message ?? "";
  if (m.includes("not found")) return "not_found";
  if (m.includes("is not live") || m.includes("already running") || m.includes("too many recording parts")) {
    return "invalid_state";
  }
  return "server_error";
}

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
  /** auto_end (required) · resume_recording (optional, audit detail). */
  reason: AutoEndReason | ResumeReason | null;
  /** hand: raise (true) / lower (false). */
  up: boolean | null;
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
  const reasons: readonly unknown[] = b.action === "resume_recording" ? RESUME_REASONS : AUTO_END_REASONS;
  if (reason !== null && !reasons.includes(reason)) {
    return { ok: false, error: "invalid reason" };
  }
  if (b.action === "auto_end" && reason === null) return { ok: false, error: "reason required" };
  const up = b.up ?? null;
  if (up !== null && typeof up !== "boolean") return { ok: false, error: "invalid up" };
  if (b.action === "hand" && up === null) return { ok: false, error: "up required" };
  return {
    ok: true,
    value: {
      action: b.action,
      sessionId: b.sessionId,
      // `hand` acts on the caller himself — an identity in the body is ignored.
      identity: b.action === "hand" ? null : identity as string | null,
      trackSid: trackSid as string | null,
      allow: typeof allow === "boolean" ? allow : null,
      reason: reason as AutoEndReason | ResumeReason | null,
      up: typeof up === "boolean" ? up : null,
    },
  };
}

// ─── Comments «التعليقات والأسئلة أثناء البث» (migration 0147) ────────────────
//
// Owner decisions (final, 2026-09-30): everyone in the room sees the list;
// guests can't write (guest_cannot_comment); a brother posts named or «بدون
// اسم»; a sister who joined hidden is ALWAYS nameless (SQL forces it); «بدون
// اسم» is hidden from everyone incl. sheikh/admins — no read, no broadcast and
// no response ever carries a user id or a nameless author's name. SQL
// (live_post_comment & co.) is the authority; these rules only refuse early.
//
// Separate from LIVE_ACTIONS on purpose: live-control routes a comment action
// to its own handler before parseLiveControlRequest (different body fields).

export const COMMENT_ACTIONS = ["comment", "comment_delete", "comment_answered", "comment_block"] as const;
export type CommentAction = (typeof COMMENT_ACTIONS)[number];

export function isCommentAction(x: unknown): x is CommentAction {
  return typeof x === "string" && (COMMENT_ACTIONS as readonly string[]).includes(x);
}

export const COMMENT_KINDS = ["comment", "question"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

/** live_comments.body check (0147): 1–300 characters after trimming. */
export const COMMENT_MAX_CHARS = 300;
/** live_post_comment (0147): one comment per 10 s per user per session. */
export const COMMENT_RATE_LIMIT_MS = 10_000;
/** LiveKit data topic of the comment stream (JSON: {t:'add',c} | {t:'del',id} | {t:'ans',id,answered}). */
export const COMMENTS_TOPIC = "comments";

export type LiveCommentRequest =
  | { action: "comment"; sessionId: string; kind: CommentKind; text: string; anonymous: boolean }
  | { action: "comment_delete" | "comment_block"; sessionId: string; commentId: string }
  | { action: "comment_answered"; sessionId: string; commentId: string; answered: boolean };

/**
 * The body of a comment action. The text itself is only type-checked here
 * (empty / too_long have their own codes — commentTextVerdict).
 */
export function parseLiveCommentRequest(
  body: unknown,
): { ok: true; value: LiveCommentRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isCommentAction(b.action)) return { ok: false, error: "invalid action" };
  if (typeof b.sessionId !== "string" || !UUID_RE.test(b.sessionId)) return { ok: false, error: "sessionId required" };
  const sessionId = b.sessionId;
  if (b.action === "comment") {
    if (typeof b.kind !== "string" || !(COMMENT_KINDS as readonly string[]).includes(b.kind)) {
      return { ok: false, error: "invalid kind" };
    }
    if (typeof b.text !== "string") return { ok: false, error: "text required" };
    if (typeof b.anonymous !== "boolean") return { ok: false, error: "anonymous required" };
    return {
      ok: true,
      value: { action: "comment", sessionId, kind: b.kind as CommentKind, text: b.text, anonymous: b.anonymous },
    };
  }
  if (typeof b.commentId !== "string" || !UUID_RE.test(b.commentId)) return { ok: false, error: "commentId required" };
  const commentId = b.commentId;
  if (b.action === "comment_answered") {
    if (typeof b.answered !== "boolean") return { ok: false, error: "answered required" };
    return { ok: true, value: { action: "comment_answered", sessionId, commentId, answered: b.answered } };
  }
  return { ok: true, value: { action: b.action, sessionId, commentId } };
}

/** Characters as Postgres counts them (code points, not UTF-16 units — an emoji is one). */
export function commentLength(text: string): number {
  return Array.from(text.trim()).length;
}

/** Same rule as the live_comments.body check: 1–300 characters after trimming. */
export function commentTextVerdict(text: string): Verdict<"empty" | "too_long"> {
  const n = commentLength(text);
  if (n === 0) return { ok: false, code: "empty" };
  if (n > COMMENT_MAX_CHARS) return { ok: false, code: "too_long" };
  return OK;
}

/**
 * May this caller moderate the comments of a session (0147
 * live_comment_is_moderator)? Its host, its moderators (staff who joined get
 * live role `moderator`), or any content manager (admin/publisher) — never a guest.
 */
export function canModerateComments(actor: {
  appRole: string | null | undefined;
  isGuest: boolean;
  isHost: boolean;
  liveRole: string | null | undefined;
}): boolean {
  if (actor.isGuest) return false;
  return actor.isHost || actor.liveRole === "host" || actor.liveRole === "moderator" ||
    isContentManagerRole(actor.appRole);
}

/**
 * First gate, before any lookup: a guest may write nothing (a comment is
 * guest_cannot_comment — the UI invites him to register); delete is for any
 * registered user (author vs moderator is SQL's call); answered / block need
 * a staff role (the host and a session's moderators are always staff).
 */
export function preauthorizeCommentAction(
  action: CommentAction,
  caller: { appRole: string | null | undefined; isGuest: boolean },
): Verdict<"forbidden" | "guest_cannot_comment"> {
  if (caller.isGuest) return action === "comment" ? { ok: false, code: "guest_cannot_comment" } : { ok: false, code: "forbidden" };
  if (action === "comment" || action === "comment_delete") return OK;
  return isStaffRole(caller.appRole) ? OK : { ok: false, code: "forbidden" };
}

/**
 * Per-session gate. The service role (media worker) has no comment action.
 *  - comment: registered + joined (live_participants row, else not_present).
 *  - comment_delete: any registered user; SQL allows only the author or a moderator.
 *  - comment_answered / comment_block: canModerateComments.
 */
export function authorizeCommentAction(
  action: CommentAction,
  actor: LiveActor,
): Verdict<"forbidden" | "guest_cannot_comment" | "not_present"> {
  const forbidden = { ok: false, code: "forbidden" } as const;
  if (actor.kind === "system") return forbidden;
  switch (action) {
    case "comment":
      if (actor.isGuest) return { ok: false, code: "guest_cannot_comment" };
      return actor.liveRole ? OK : { ok: false, code: "not_present" };
    case "comment_delete":
      return actor.isGuest ? forbidden : OK;
    case "comment_answered":
    case "comment_block":
      return canModerateComments(actor) ? OK : forbidden;
  }
}

/**
 * Writing needs a `live` session (green → not_live: the room is only the
 * host's green room). Delete / answered / block work in any status — staff may
 * clean up the list after the majlis too.
 */
export function commentStatusVerdict(action: CommentAction, status: string): Verdict<"not_live"> {
  if (action === "comment" && status !== "live") return { ok: false, code: "not_live" };
  return OK;
}

/** Broadcast to the room only while it can exist (green / live); the DB row is the truth either way. */
export function shouldBroadcastComments(status: string): boolean {
  return status === "green" || status === "live";
}

const COMMENT_RPC_CODES: readonly LiveErrorCode[] = [
  "not_found", "not_live", "guest_cannot_comment", "not_present", "blocked", "empty", "too_long",
  "blocked_words", "rate_limited", "forbidden", "invalid_target", "bad_request",
];

/** A 0147 refusal ('live_comment:<code>') → our code; anything else is a server error. */
export function commentRpcErrorCode(message: string | null | undefined): LiveErrorCode {
  const m = /live_comment:([a-z_]+)/.exec(message ?? "");
  const code = m?.[1] as LiveErrorCode | undefined;
  return code && COMMENT_RPC_CODES.includes(code) ? code : "server_error";
}

/**
 * live_moderation_log.action for a comment action (0147 check list), or null:
 * writing is not moderation, nor is an author deleting his own comment
 * (live_delete_comment says who deleted: by = 'author' | 'moderator').
 */
export function commentAuditAction(action: CommentAction, ctx: { by?: string | null } = {}): string | null {
  switch (action) {
    case "comment":
      return null;
    case "comment_delete":
      return ctx.by === "moderator" ? "comment_delete" : null;
    case "comment_answered":
    case "comment_block":
      return action;
  }
}

/** The public comment shape (0147 live_comment_json) — what the room receives. */
export type PublicLiveComment = {
  id: string;
  kind: CommentKind;
  text: string;
  /** null = «بدون اسم». */
  name: string | null;
  gender: LiveGender;
  answered: boolean;
  at: string;
};

/**
 * Whitelist a comment from SQL down to the public fields — defence in depth:
 * whatever the RPC returns, only these ever reach the room (never `mine`,
 * never an id of a person). null when malformed.
 */
export function toPublicComment(raw: unknown): PublicLiveComment | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  if (typeof r.id !== "string" || !r.id) return null;
  if (r.kind !== "comment" && r.kind !== "question") return null;
  if (typeof r.text !== "string" || !r.text) return null;
  if (r.name !== null && typeof r.name !== "string") return null;
  if (r.gender !== "m" && r.gender !== "f") return null;
  if (typeof r.answered !== "boolean") return null;
  if (typeof r.at !== "string" || !r.at) return null;
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    name: typeof r.name === "string" && r.name ? r.name : null,
    gender: r.gender,
    answered: r.answered,
    at: r.at,
  };
}

export type CommentsMessage =
  | { t: "add"; c: PublicLiveComment }
  | { t: "del"; id: string }
  | { t: "ans"; id: string; answered: boolean };

/** The data message body on topic COMMENTS_TOPIC (UTF-8 JSON). */
export function commentsMessage(msg: CommentsMessage): string {
  switch (msg.t) {
    case "add":
      return JSON.stringify({ t: "add", c: msg.c });
    case "del":
      return JSON.stringify({ t: "del", id: msg.id });
    case "ans":
      return JSON.stringify({ t: "ans", id: msg.id, answered: msg.answered });
  }
}
