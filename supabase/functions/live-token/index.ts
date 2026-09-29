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
//
// Pure rules: ../_shared/liveRules.ts (tests/functions/liveRules.test.ts).
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";
import { AccessToken, RoomServiceClient, TrackSource } from "npm:livekit-server-sdk@2.19.1";

import {
  canJoin,
  isBanned,
  isEnvRoom,
  isLiveIdentity,
  LIVE_ERROR_STATUS,
  LIVE_GRANTS,
  liveGender,
  liveRoleFor,
  livekitWsUrl,
  type LiveErrorCode,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("unauthorized");
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: caller, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !caller?.user) return fail("unauthorized");
  const userId = caller.user.id;

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

  // 1. Ban + guest flag, read fresh (a JWT can outlive a ban / a registration).
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  if (!authUser?.user) return fail("unauthorized");
  const u = authUser.user as { banned_until?: string | null; is_anonymous?: boolean };
  if (isBanned(u.banned_until, Date.now())) return fail("banned");
  const isGuest = u.is_anonymous === true;

  // 2. Session + who the caller is in it.
  const { data: session, error: sessionErr } = await admin
    .from("live_sessions")
    .select("id, status, room_name, host_user_id, section_id, allow_requests")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr) return fail("server_error", sessionErr.message);
  if (!session) return fail("not_found");
  if (!isEnvRoom(session.room_name, ROOM_PREFIX)) return fail("server_error", "room of another environment");

  const [{ data: profile }, { data: stored }] = await Promise.all([
    admin.from("profiles").select("role, gender, display_name").eq("id", userId).maybeSingle(),
    admin
      .from("live_participants")
      .select("role, hidden_name")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  let role = liveRoleFor({
    userId,
    appRole: profile?.role,
    isGuest,
    hostUserId: session.host_user_id,
    storedRole: stored?.role,
  });
  const join = canJoin(session.status, role);
  if (!join.ok) return fail(join.code);

  // 3. Gender (and the section's gender scope for students/guests).
  const gender = liveGender(profile?.gender);
  if (!gender) return fail("gender_required");
  if (role === "listener" || role === "speaker") {
    const { data: visible, error: visErr } = await callerClient.rpc("section_visible_to_viewer", {
      p_section_id: session.section_id,
      p_gender: profile?.gender ?? null,
    });
    if (visErr) return fail("server_error", visErr.message);
    if (!visible) return fail("not_visible");
  }

  // 4. Opaque, salted, per-session identity (SQL — the salt never leaves the DB).
  const { data: identity, error: idErr } = await admin.rpc("live_identity", {
    p_session: sessionId,
    p_user: userId,
  });
  if (idErr || !isLiveIdentity(identity)) return fail("server_error", idErr?.message ?? "bad identity");

  // 5. Participant row.
  const hidden = resolveHiddenName(gender, identityChoice, stored?.hidden_name);
  const row = {
    session_id: sessionId,
    user_id: userId,
    identity,
    gender,
    hidden_name: hidden,
    display_name: realDisplayName(profile?.display_name),
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
        hostUserId: session.host_user_id,
        storedRole: fresh?.role,
      });
      ({ error: upErr } = await admin
        .from("live_participants")
        .update({ ...row, role })
        .eq("session_id", sessionId)
        .eq("user_id", userId));
    }
  }
  if (upErr) return fail("server_error", upErr.message);
  const name = participantDisplayName({ isGuest, gender, hiddenName: hidden, role, displayName: profile?.display_name });

  // 6. The green room must exist before the host joins (auto_create: false).
  if (session.status === "green") {
    try {
      await rooms.createRoom({
        name: session.room_name,
        emptyTimeout: ROOM_EMPTY_TIMEOUT_S,
        departureTimeout: ROOM_DEPARTURE_TIMEOUT_S,
        maxParticipants: ROOM_MAX_PARTICIPANTS,
        metadata: roomMetadata(session.allow_requests),
      });
    } catch (e) {
      return fail("livekit_error", (e as Error).message);
    }
  }

  // 7. Token.
  const grants = LIVE_GRANTS[role];
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: TOKEN_TTL,
    attributes: participantAttributes({ gender, role, hiddenName: hidden }),
  });
  at.addGrant({
    roomJoin: true,
    room: session.room_name,
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
    roomName: session.room_name,
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
