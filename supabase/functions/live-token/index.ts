// =============================================================================
// live-token — mint a LiveKit access token for a live session «الحلقة»
// (PLAN_LIVE_V23 §5.1). verify_jwt=true; guests (anonymous sessions) allowed.
//
// Secrets: LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET /
// LIVEKIT_ROOM_PREFIX ('stg_' | 'prd_') + the default SUPABASE_* ones.
//
// Input  { sessionId, identityChoice?: 'named' | 'hidden' }
// Output { token, url (wss), roomName, identity, role, name, hidden, gender }
//
// Steps (§5.1):
//  1. caller + ban (auth.users.banned_until, fresh via the admin API) → 403
//  1b. P7 rollout flag app_config.live_enabled ('off' | 'staff' | 'all'; a
//     missing row = 'off'), read with the service client BEFORE anything about
//     the session: not on for this caller → 403 live_disabled. 'staff' admits
//     admin/publisher/sheikh only; guests and students need 'all'
//     (liveEnabledFor — same rule as SQL live_enabled_for_caller, 0145).
//  2. session: `green` admits host/moderators only, `live` everyone (409 else)
//  3. profile gender → 'm'/'f'; missing → 409 gender_required (client shows
//     GenderPrompt, then retries); a non-staff viewer must also pass the
//     section's gender scope (section_visible_to_viewer, like live_sessions_public)
//  4. identity = live_identity(session, user) — salted, computed in SQL (0135)
//  5. upsert live_participants (service role) with the REAL display name and
//     hidden_name (D2, changed 2026-09-28: moderators read real names via the
//     staff-only get_live_participants RPC). The LiveKit `name` — broadcast to
//     everyone — stays «طالبة» for a hidden sister; guests are «ضيف»/«ضيفة».
//  6. green room: rooms are NOT auto-created on our LiveKit (auto_create:false),
//     so CreateRoom (idempotent) before the host/moderators join
//  7. AccessToken (2 h) with the §5.1 grants; publishing = microphone only.
//     P4: canUpdateOwnMetadata is false for every role — attributes (g/r/h/hid)
//     and the name are server-only (a participant holding that grant could set
//     r=host or rename himself); the hand goes through live-control `hand`, and
//     a sister's identity change is a new call here (new token, same identity).
//
// Re-join (network drop → new call here): the role comes from the stored
// live_participants.role, so an approved SPEAKER keeps canPublish + r=speaker;
// the webhook's participant_left never touches role (0138 live_room_event) —
// only an explicit live-control `leave` or a demote does. The new token's hand
// starts down (h=0). A guest is always a listener (guests listen only).
// 0163: a «متحدث دائم» (live_permanent_speakers) joins every session as a
// speaker (mic closed) unless a moderator demoted him in this one.
//
// Pure rules: ../_shared/liveRules.ts (tests/functions/liveRules.test.ts).
//
// LOAD V24 (2026-10-05): a join used to cost two GoTrue calls + 6 PostgREST
// round trips — at a live start that is thousands of requests against the
// same small instance the joiners need. Now: the session JWT (ES256) is
// verified locally against the project JWKS (fetched once per isolate, cached;
// a legacy HS256 token still goes to GoTrue), and steps 1–4 read everything in
// ONE service-role RPC, live_join_context (0155). Same rules, same order.
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import { AccessToken, RoomServiceClient, TrackSource } from "npm:livekit-server-sdk@2.19.1";

import {
  canJoin,
  isBanned,
  isEnvRoom,
  isLiveIdentity,
  jwtHeaderAlg,
  LIVE_ERROR_STATUS,
  liveEnabledFor,
  liveGrantsFor,
  liveGender,
  liveRoleFor,
  livekitWsUrl,
  type LiveErrorCode,
  parseLiveJoinContext,
  parseLiveTokenRequest,
  participantAttributes,
  participantDisplayName,
  resolveHiddenName,
  ROOM_DEPARTURE_TIMEOUT_S,
  ROOM_EMPTY_TIMEOUT_S,
  ROOM_MAX_PARTICIPANTS,
  realDisplayName,
  roomMetadata,
  TOKEN_TTL,
} from "../_shared/liveRules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LIVEKIT_URL = Deno.env.get("LIVEKIT_URL")!; // https://live.almahajja.app
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY")!;
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET")!;
const ROOM_PREFIX = Deno.env.get("LIVEKIT_ROOM_PREFIX") ?? ""; // 'stg_' | 'prd_'

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const rooms = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
// Project signing keys (ES256). jose caches them and refetches on an unknown kid.
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

/** The caller's user id from a VERIFIED session JWT, or null (→ 401). */
async function verifiedUserId(authHeader: string): Promise<string | null> {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (jwtHeaderAlg(token) === "HS256") {
    // Legacy-signed token (or the anon key): GoTrue decides, as before.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await callerClient.auth.getUser();
    return error || !data?.user ? null : data.user.id;
  }
  try {
    const { payload } = await jwtVerify(token, JWKS, { audience: "authenticated" });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("unauthorized");
  const userId = await verifiedUserId(authHeader);
  if (!userId) return fail("unauthorized");

  let parsed;
  try {
    parsed = parseLiveTokenRequest(await req.json());
  } catch {
    return fail("bad_request", "invalid json");
  }
  if (!parsed.ok) return fail("bad_request", parsed.error);
  const { sessionId, identityChoice } = parsed.value;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1–4 read in one round trip (0155): fresh ban/guest flags from auth.users
  // (a JWT can outlive a ban / a registration), the P7 flag, the profile, the
  // session, the stored participant row, the section scope, the identity.
  const { data: rawCtx, error: ctxErr } = await admin.rpc("live_join_context", {
    p_session: sessionId,
    p_user: userId,
  });
  if (ctxErr) return fail("server_error", ctxErr.message);
  const ctx = parseLiveJoinContext(rawCtx);
  if (!ctx) return fail("server_error", "bad join context");

  // 1. Ban + guest flag.
  if (!ctx.user) return fail("unauthorized");
  if (isBanned(ctx.user.bannedUntil, Date.now())) return fail("banned");
  const isGuest = ctx.user.isAnonymous;

  // 1b. P7 rollout flag + the caller's app role.
  const profile = ctx.profile;
  if (!liveEnabledFor(ctx.flag, profile?.role, isGuest)) return fail("live_disabled");

  // 2. Session + who the caller is in it.
  const session = ctx.session;
  if (!session) return fail("not_found");
  if (!isEnvRoom(session.roomName, ROOM_PREFIX)) return fail("server_error", "room of another environment");
  const stored = ctx.stored;

  let role = liveRoleFor({
    userId,
    appRole: profile?.role,
    isGuest,
    hostUserId: session.hostUserId,
    storedRole: stored?.role,
    permanentSpeaker: ctx.permanentSpeaker,
    demotedHere: ctx.demotedHere,
  });
  const join = canJoin(session.status, role);
  if (!join.ok) return fail(join.code);

  // 3. Gender (and the section's gender scope for students/guests).
  const gender = liveGender(profile?.gender);
  if (!gender) return fail("gender_required");
  if ((role === "listener" || role === "speaker") && !ctx.visible) return fail("not_visible");

  // 4. Opaque, salted, per-session identity (SQL — the salt never leaves the DB).
  const identity = ctx.identity;
  if (!isLiveIdentity(identity)) return fail("server_error", "bad identity");

  // 5. Participant row.
  const hidden = resolveHiddenName(gender, identityChoice, stored?.hiddenName);
  const row = {
    session_id: sessionId,
    user_id: userId,
    identity,
    gender,
    hidden_name: hidden,
    display_name: realDisplayName(profile?.displayName),
    role,
    left_at: null,
  };
  let upErr: { message: string } | null = null;
  if (!stored) {
    ({ error: upErr } = await admin.from("live_participants").upsert(row, { onConflict: "session_id,user_id" }));
  } else {
    // A re-join must never undo a demote/approve that lands between the read
    // above and this write: write the role only if it is still the one read,
    // else re-derive it from the fresh row.
    const { data: hit, error } = await admin
      .from("live_participants")
      .update(row)
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .eq("role", stored.role)
      .select("user_id");
    upErr = error;
    if (!error && !hit?.length) {
      const { data: fresh, error: freshErr } = await admin
        .from("live_participants")
        .select("role")
        .eq("session_id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (freshErr) return fail("server_error", freshErr.message);
      role = liveRoleFor({
        userId,
        appRole: profile?.role,
        isGuest,
        hostUserId: session.hostUserId,
        storedRole: fresh?.role,
        permanentSpeaker: ctx.permanentSpeaker,
        demotedHere: ctx.demotedHere,
      });
      ({ error: upErr } = await admin
        .from("live_participants")
        .update({ ...row, role })
        .eq("session_id", sessionId)
        .eq("user_id", userId));
    }
  }
  if (upErr) return fail("server_error", upErr.message);
  const name = participantDisplayName({ isGuest, gender, hiddenName: hidden, role, displayName: profile?.displayName });

  // 6. The green room must exist before the host joins (auto_create: false).
  if (session.status === "green") {
    try {
      await rooms.createRoom({
        name: session.roomName,
        emptyTimeout: ROOM_EMPTY_TIMEOUT_S,
        departureTimeout: ROOM_DEPARTURE_TIMEOUT_S,
        maxParticipants: ROOM_MAX_PARTICIPANTS,
        metadata: roomMetadata(session.allowRequests),
      });
    } catch (e) {
      return fail("livekit_error", (e as Error).message);
    }
  }

  // 7. Token. 0157: listeners/speakers may send reactions (data, topic
  // "reactions") unless they are guests or a moderator stopped theirs.
  const reactionsBlocked = stored?.reactionsBlocked === true;
  const grants = liveGrantsFor(role, { isGuest, reactionsBlocked });
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: TOKEN_TTL,
    attributes: participantAttributes({ gender, role, hiddenName: hidden, reactionsBlocked }),
  });
  at.addGrant({
    roomJoin: true,
    room: session.roomName,
    canSubscribe: grants.canSubscribe,
    canPublish: grants.canPublish,
    canPublishData: grants.canPublishData,
    canUpdateOwnMetadata: grants.canUpdateOwnMetadata,
    roomAdmin: grants.roomAdmin,
    canPublishSources: [TrackSource.MICROPHONE],
  });
  const token = await at.toJwt();

  return json({
    token,
    url: livekitWsUrl(LIVEKIT_URL),
    roomName: session.roomName,
    identity,
    role,
    name,
    hidden,
    gender,
  });
});

function fail(code: LiveErrorCode, detail?: string): Response {
  const status = LIVE_ERROR_STATUS[code];
  if (status >= 500) console.error(`live-token ${code}: ${detail ?? ""}`);
  return json(status < 500 && detail && detail !== code ? { error: code, detail } : { error: code }, status);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
