// =============================================================================
// live-control — the server side of every live-session state or permission
// change (PLAN_LIVE_V23 §5.2). verify_jwt=true. Every action needs a USER JWT
// and is staff only, except `leave` (anyone), `hand` (a registered user on
// himself) and a speaker stepping himself down (D1) — except `auto_end`, which
// ONLY the service-role key may call (the media worker: D4 host absent 10 min,
// or LiveKit room_finished).
//
// P4: participant attributes (g/r/h/hid) and names are SERVER-ONLY — no token
// or permission grants canUpdateOwnMetadata/canUpdateMetadata, so every
// attribute change (hand included) happens here. Guests LISTEN only (owner
// 2026-09-28): a guest raising a hand, or a guest target of `approve`, is
// 403 guest_cannot_speak (is_anonymous read fresh from auth.users).
//
// Secrets: LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET /
// LIVEKIT_ROOM_PREFIX ('stg_' | 'prd_') + the default SUPABASE_* ones.
//
// Input { action, sessionId, identity?, trackSid?, allow?, reason?, up? }
// Output { ok: true, status, ...action result } · error { error: code, detail? }
//   open_green          scheduled → green; CreateRoom (auto_create is off)
//   start               green → live; CreateRoom + audio-only RoomComposite
//                       egress to the VPS DISK (owner rule: a recording is
//                       never lost): /recordings/<env>/{room_name}-{time}.ogg,
//                       no manifest, Opus 64 kbps / 48 kHz. The media worker
//                       backs it up to R2 and compresses it. Notifications
//                       (live_start) are whatever set_live_session_status does
//                       — P5 (0139); `start` does not depend on them.
//   end                 live → ended (StopEgress → DeleteRoom); scheduled/green
//                       → cancelled. The egress_ended webhook → media worker
//                       → recording job → draft lecture.
//   auto_end            service role only, { sessionId, reason:
//                       'host_absent' | 'room_finished' }: same as end for a
//                       live/green session; a no-op (200) for one already over.
//   resume_recording    service role only (0146), { sessionId, reason?:
//                       'egress_failed' | 'egress_ended' }: the session's egress
//                       died while it is still live (the worker has already
//                       marked that part dead/recovered/lost) → a NEW
//                       RoomComposite egress with exactly the `start` settings,
//                       registered by add_live_recording_part (next seq, becomes
//                       live_sessions.egress_id so `end` stops it). 409
//                       invalid_state when the session is not live, a part is
//                       still `recording`, or the room is gone (never recreated
//                       just to record silence). → { ok, status, egressId, seq }.
//   approve             listener → speaker: canPublish (mic only), r=speaker,
//                       h=0. A guest target → 403 guest_cannot_speak.
//   reject              h=0 + data message {t:'rejected'} to that participant
//   mute                MutePublishedTrack(mic) — the speaker keeps permission
//                       and may reopen (decision 6)
//   demote              speaker → listener (moderators; or himself — step_down).
//                       If he is out of the room (network drop) the DB role
//                       still changes, so his re-join token is a listener's.
//   set_allow_requests  «استقبال طلبات التحدث» → session row + room metadata
//   host_leave          the host hands the session to a moderator present
//   leave               marks left_at (an explicit leave drops speaker status;
//                       a network drop does NOT — live-token keeps a stored
//                       speaker a speaker on re-join)
//   hand                { sessionId, up: boolean } — the CALLER's own hand
//                       (identity ignored), live sessions only. up:true: a
//                       listener only (else 409 invalid_target), guests 403
//                       guest_cannot_speak, «استقبال طلبات التحدث» off 409
//                       requests_closed, ≤ 1 toggle / 5 s (0141 hand_at, 429
//                       rate_limited). up:false: anyone, idempotent, never
//                       rate-limited (also fine when he already left the
//                       room). Sets h = raise time in epoch seconds / '0';
//                       → { ok, status, hand: boolean, handAt: seconds | null }.
//                       Not in live_moderation_log.
//
// Every lifecycle transition goes through set_live_session_status (0138,
// service role: D3 guard, timestamps, fan-outs). Every moderation action is
// appended to live_moderation_log (0135).
//
// Pure rules: ../_shared/liveRules.ts (tests/functions/liveRules.test.ts).
// =============================================================================
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  DataPacket_Kind,
  EgressClient,
  AudioCodec,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptions,
  RoomServiceClient,
  TrackSource,
} from "npm:livekit-server-sdk@2.19.1";

import {
  auditAction,
  authorizeLiveAction,
  canSpeak,
  canTarget,
  envFromRoomPrefix,
  HAND_RATE_LIMIT_MS,
  handAttribute,
  handVerdict,
  isBanned,
  isEnvRoom,
  isSystemAction,
  jwtRoleClaim,
  LIVE_ERROR_STATUS,
  type LiveActor,
  type LiveErrorCode,
  type LiveStatus,
  parseLiveControlRequest,
  preauthorizeLiveAction,
  RECORDING_AUDIO,
  recordingFilepath,
  recordingPartRpcErrorCode,
  REJECTED_MESSAGE,
  ROOM_DEPARTURE_TIMEOUT_S,
  ROOM_EMPTY_TIMEOUT_S,
  ROOM_MAX_PARTICIPANTS,
  roomMetadata,
  safeEqual,
  speakerPermission,
  statusAfter,
  statusRpcErrorCode,
  TARGETED_ACTIONS,
} from "../_shared/liveRules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LIVEKIT_URL = Deno.env.get("LIVEKIT_URL")!; // https://live.almahajja.app
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY")!;
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET")!;
const ROOM_PREFIX = Deno.env.get("LIVEKIT_ROOM_PREFIX") ?? ""; // 'stg_' | 'prd_'
const RECORDING_ENV = envFromRoomPrefix(ROOM_PREFIX); // 'stg' | 'prd'

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const rooms = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const egress = new EgressClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const encoder = new TextEncoder();

type Session = {
  id: string;
  status: LiveStatus;
  room_name: string;
  host_user_id: string | null;
  allow_requests: boolean;
  egress_id: string | null;
};
type Participant = { user_id: string; identity: string; role: string; left_at: string | null };

class LiveFail extends Error {
  constructor(readonly code: LiveErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    return await handle(req);
  } catch (e) {
    if (e instanceof LiveFail) return fail(e.code, e.message);
    return fail("server_error", (e as Error).message);
  }
});

async function handle(req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("unauthorized");
  const bearer = authHeader.replace(/^Bearer\s+/i, "");

  let parsed;
  try {
    parsed = parseLiveControlRequest(await req.json());
  } catch {
    return fail("bad_request", "invalid json");
  }
  if (!parsed.ok) return fail("bad_request", parsed.error);
  const r = parsed.value;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Who is calling ──────────────────────────────────────────────────────────
  const system = await isServiceRole(bearer);
  // auto_end / resume_recording are the service role's ONLY actions, and only the service role's.
  if (system !== isSystemAction(r.action)) return fail("forbidden");
  let userId: string | null = null;
  let appRole: string | null = null;
  let isGuest = false;
  if (!system) {
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: caller, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller?.user) return fail("unauthorized");
    userId = caller.user.id;
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    if (!authUser?.user) return fail("unauthorized");
    const u = authUser.user as { banned_until?: string | null; is_anonymous?: boolean };
    if (isBanned(u.banned_until, Date.now())) return fail("banned");
    isGuest = u.is_anonymous === true;
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    appRole = profile?.role ?? null;
    const pre = preauthorizeLiveAction(r.action, { appRole, isGuest }, { up: r.up ?? undefined });
    if (!pre.ok) return fail(pre.code);
  }

  // ── Session, caller and target ────────────────────────────────────────────────
  const { data: session, error: sErr } = await admin
    .from("live_sessions")
    .select("id, status, room_name, host_user_id, allow_requests, egress_id")
    .eq("id", r.sessionId)
    .maybeSingle<Session>();
  if (sErr) return fail("server_error", sErr.message);
  if (!session) return fail("not_found");
  if (!isEnvRoom(session.room_name, ROOM_PREFIX)) return fail("server_error", "room of another environment");

  const callerPart = userId ? await participantBy(admin, session.id, "user_id", userId) : null;
  const target = r.identity ? await participantBy(admin, session.id, "identity", r.identity) : null;
  if (TARGETED_ACTIONS.includes(r.action) && !target) return fail("not_present");
  // `hand` acts on the caller: he must have joined (live-token wrote his row).
  if (r.action === "hand" && !callerPart) return fail("not_present");
  const targetIsSelf = !!target && !!userId && target.user_id === userId;

  const actor: LiveActor = system
    ? { kind: "system" }
    : {
      kind: "user",
      appRole,
      isGuest,
      isHost: !!userId && userId === session.host_user_id,
      liveRole: callerPart?.role ?? null,
    };
  const authz = authorizeLiveAction(r.action, actor, { targetIsSelf, up: r.up ?? undefined });
  if (!authz.ok) return fail(authz.code);
  if (target && r.action !== "leave") {
    const t = canTarget(r.action, target.role);
    if (!t.ok) return fail(t.code);
  }
  if (r.action === "hand") {
    const t = canTarget("hand", callerPart!.role, { up: r.up === true });
    if (!t.ok) return fail(t.code);
  }
  const transition = statusAfter(r.action, session.status);
  if (!transition.ok) return fail(transition.code);
  // auto_end on a session that is already over (or never opened): idempotent.
  if (r.action === "auto_end" && transition.next === session.status) {
    return json({ ok: true, status: session.status, noop: true });
  }

  const room = session.room_name;
  let result: Record<string, unknown> = {};
  let auditTarget: string | null = target?.identity ?? null;

  switch (r.action) {
    case "open_green": {
      await setStatus(admin, session.id, "green");
      await ensureRoom(room, session.allow_requests);
      break;
    }

    case "start": {
      if (!RECORDING_ENV) return fail("server_error", "LIVEKIT_ROOM_PREFIX must be stg_ or prd_");
      await ensureRoom(room, session.allow_requests);
      const info = await startRecordingEgress(room, RECORDING_ENV);
      try {
        // → live: started_at, egress_id (+ whatever notifications the RPC does).
        await setStatus(admin, session.id, "live", info.egressId);
      } catch (e) {
        // Don't leave a recording running for a session that never went live.
        await egress.stopEgress(info.egressId).catch(() => undefined);
        throw e;
      }
      result = { egressId: info.egressId };
      break;
    }

    case "end":
    case "auto_end": {
      if (transition.next === "ended") {
        if (session.egress_id) {
          // Already stopped/complete is fine — the webhook still carries the file.
          await egress.stopEgress(session.egress_id).catch((e) => logLk("stopEgress", e));
        }
        await rooms.deleteRoom(room).catch((e) => logLk("deleteRoom", e));
        await setStatus(admin, session.id, "ended");
      } else {
        await rooms.deleteRoom(room).catch((e) => logLk("deleteRoom", e));
        await setStatus(admin, session.id, "cancelled");
      }
      if (r.action === "auto_end") result = { reason: r.reason };
      break;
    }

    case "resume_recording": {
      if (!RECORDING_ENV) return fail("server_error", "LIVEKIT_ROOM_PREFIX must be stg_ or prd_");
      // The dead part must be settled first (the worker marks it); one egress at a time.
      const { data: last, error: lastErr } = await admin
        .from("live_recording_parts")
        .select("seq, status")
        .eq("session_id", session.id)
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle<{ seq: number; status: string }>();
      if (lastErr) return fail("server_error", lastErr.message);
      if (last?.status === "recording") return fail("invalid_state", "recording_active");
      // Never recreate a room that is gone just to record silence into it.
      const existing = await lk(() => rooms.listRooms([room]));
      if (!existing.some((x) => x.name === room)) return fail("invalid_state", "room_gone");

      const info = await startRecordingEgress(room, RECORDING_ENV);
      let seq: number;
      try {
        const { data, error } = await admin.rpc("add_live_recording_part", {
          p_session: session.id,
          p_egress_id: info.egressId,
        });
        if (error) throw new LiveFail(recordingPartRpcErrorCode(error.message), error.message);
        seq = Number(data);
      } catch (e) {
        // Ended meanwhile / another resume won: don't leave a stray egress running.
        await egress.stopEgress(info.egressId).catch(() => undefined);
        throw e;
      }
      result = { egressId: info.egressId, seq };
      break;
    }

    case "approve": {
      // Guests listen only (owner 2026-09-28). Read fresh: the row can't tell,
      // and a guest who registers since keeps the same user id.
      const { data: targetUser, error: tuErr } = await admin.auth.admin.getUserById(target!.user_id);
      if (tuErr || !targetUser?.user) return fail("server_error", tuErr?.message ?? "target user not found");
      const speak = canSpeak({ isGuest: (targetUser.user as { is_anonymous?: boolean }).is_anonymous === true });
      if (!speak.ok) return fail(speak.code);
      await lk(() => rooms.updateParticipant(room, target!.identity, {
        permission: { ...speakerPermission(true), canPublishSources: [TrackSource.MICROPHONE] },
        attributes: { r: "speaker", h: "0" },
      }));
      await setRole(admin, session.id, target!.identity, "speaker");
      break;
    }

    case "reject": {
      await lk(() => rooms.updateParticipant(room, target!.identity, { attributes: { h: "0" } }));
      await lk(() => rooms.sendData(room, encoder.encode(REJECTED_MESSAGE), DataPacket_Kind.RELIABLE, {
        destinationIdentities: [target!.identity],
        topic: "control",
      }));
      break;
    }

    case "mute": {
      let trackSid = r.trackSid;
      if (!trackSid) {
        const p = await lk(() => rooms.getParticipant(room, target!.identity));
        trackSid = p.tracks.find((t) => t.source === TrackSource.MICROPHONE)?.sid ?? null;
      }
      if (!trackSid) return fail("no_track");
      await lk(() => rooms.mutePublishedTrack(room, target!.identity, trackSid!, true));
      result = { trackSid };
      break;
    }

    case "demote": {
      try {
        await lk(() => rooms.updateParticipant(room, target!.identity, {
          permission: { ...speakerPermission(false), canPublishSources: [TrackSource.MICROPHONE] },
          attributes: { r: "listener", h: "0" },
        }));
      } catch (e) {
        // Out of the room (network drop, or stepping down after dropping out):
        // the DB role still changes, so his re-join token (live-token reads
        // live_participants.role) is a listener's — a demote must stick.
        if (!(e instanceof LiveFail && e.code === "not_present")) throw e;
      }
      await setRole(admin, session.id, target!.identity, "listener");
      break;
    }

    case "set_allow_requests": {
      const { error } = await admin
        .from("live_sessions")
        .update({ allow_requests: r.allow })
        .eq("id", session.id);
      if (error) return fail("server_error", error.message);
      if (session.status === "green" || session.status === "live") {
        await rooms.updateRoomMetadata(room, roomMetadata(r.allow === true)).catch((e) => logLk("updateRoomMetadata", e));
      }
      result = { allowRequests: r.allow };
      break;
    }

    case "host_leave": {
      const present = new Set((await lk(() => rooms.listParticipants(room))).map((p) => p.identity));
      let next: Participant | null = null;
      if (target) {
        next = present.has(target.identity) ? target : null; // role checked by canTarget
      } else {
        const { data: mods } = await admin
          .from("live_participants")
          .select("user_id, identity, role, left_at")
          .eq("session_id", session.id)
          .eq("role", "moderator")
          .is("left_at", null);
        next = ((mods ?? []) as Participant[]).find((m) => present.has(m.identity) && m.user_id !== userId) ?? null;
      }
      if (!next) return fail("no_moderator_present");

      // Only the current host may hand over (guards a double tap / race).
      const { data: moved, error } = await admin
        .from("live_sessions")
        .update({ host_user_id: next.user_id })
        .eq("id", session.id)
        .eq("host_user_id", userId!)
        .select("id");
      if (error) return fail("server_error", error.message);
      if (!moved?.length) return fail("invalid_state");
      await setRole(admin, session.id, next.identity, "host");
      if (callerPart) await setRole(admin, session.id, callerPart.identity, "moderator");
      await rooms.updateParticipant(room, next.identity, { attributes: { r: "host" } }).catch((e) => logLk("updateParticipant", e));
      if (callerPart) {
        await rooms.updateParticipant(room, callerPart.identity, { attributes: { r: "moderator" } })
          .catch((e) => logLk("updateParticipant", e));
      }
      auditTarget = next.identity;
      result = { hostIdentity: next.identity };
      break;
    }

    case "leave": {
      if (callerPart) {
        const { error } = await admin
          .from("live_participants")
          .update({
            left_at: new Date().toISOString(),
            ...(callerPart.role === "speaker" ? { role: "listener" } : {}),
          })
          .eq("session_id", session.id)
          .eq("user_id", callerPart.user_id);
        if (error) return fail("server_error", error.message);
      }
      break;
    }

    case "hand": {
      // The caller's own hand (authz: guests can't raise; canTarget: listeners only raise).
      const up = r.up === true;
      const me = callerPart!;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      // hand_at (0141) is only ever read/written here — the other actions don't
      // depend on the column.
      let prevHandAt: string | null = null;
      if (up) {
        const { data: row, error } = await admin
          .from("live_participants")
          .select("hand_at")
          .eq("session_id", session.id)
          .eq("user_id", me.user_id)
          .maybeSingle<{ hand_at: string | null }>();
        if (error) return fail("server_error", error.message);
        prevHandAt = row?.hand_at ?? null;
      }
      const v = handVerdict({
        up,
        allowRequests: session.allow_requests,
        lastToggleMs: prevHandAt ? Date.parse(prevHandAt) : null,
        nowMs,
      });
      if (!v.ok) return fail(v.code);

      if (up) {
        // Claim the rate-limit slot atomically: a concurrent raise re-evaluates
        // this WHERE against the row we just updated, and loses.
        const cutoff = new Date(nowMs - HAND_RATE_LIMIT_MS).toISOString();
        const { data: claimed, error } = await admin
          .from("live_participants")
          .update({ hand_at: nowIso })
          .eq("session_id", session.id)
          .eq("user_id", me.user_id)
          .or(`hand_at.is.null,hand_at.lte."${cutoff}"`)
          .select("user_id");
        if (error) return fail("server_error", error.message);
        if (!claimed?.length) return fail("rate_limited");
      }

      const h = handAttribute(up, nowMs);
      try {
        await lk(() => rooms.updateParticipant(room, me.identity, { attributes: { h } }));
      } catch (e) {
        if (up) {
          // The hand never went up — give the slot back so he can retry at once.
          const { error: rbErr } = await admin
            .from("live_participants")
            .update({ hand_at: prevHandAt })
            .eq("session_id", session.id)
            .eq("user_id", me.user_id)
            .eq("hand_at", nowIso);
          if (rbErr) console.error(`live-control hand rollback: ${rbErr.message}`);
          throw e;
        }
        // Lowering after he left the room: nothing is up (a new token starts at h=0).
        if (!(e instanceof LiveFail && e.code === "not_present")) throw e;
      }
      if (!up) {
        const { error } = await admin
          .from("live_participants")
          .update({ hand_at: nowIso })
          .eq("session_id", session.id)
          .eq("user_id", me.user_id);
        if (error) return fail("server_error", error.message);
      }
      result = { hand: up, handAt: up ? Number(h) : null };
      break;
    }
  }

  // Audit (best-effort: the action already happened).
  const logged = auditAction(r.action, { targetIsSelf, next: transition.next });
  if (logged) {
    const { error } = await admin.from("live_moderation_log").insert({
      session_id: session.id,
      actor_user_id: userId,
      target_identity: auditTarget,
      action: logged,
      detail: r.action === "set_allow_requests"
        ? { allow: r.allow }
        : r.action === "auto_end"
        ? { reason: r.reason, from: session.status }
        : r.action === "resume_recording"
        ? { reason: r.reason, previous_egress: session.egress_id, ...result }
        : {},
    });
    if (error) console.error(`live-control audit: ${error.message}`);
  }

  return json({ ok: true, status: transition.next, ...result });
}

/**
 * Is the bearer the service role? Either the exact key this function was given,
 * or a JWT whose `service_role` claim PostgREST accepts: the claim is proven by
 * calling live_identity (0135), which is granted to service_role only — so a
 * forged/unsigned token can never pass, whatever the gateway's verify_jwt.
 * (The worker's key need not be byte-identical to the injected one.)
 */
async function isServiceRole(bearer: string): Promise<boolean> {
  if (SERVICE_ROLE_KEY && safeEqual(bearer, SERVICE_ROLE_KEY)) return true;
  if (jwtRoleClaim(bearer) !== "service_role") return false;
  const probe = createClient(SUPABASE_URL, bearer, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const nil = "00000000-0000-0000-0000-000000000000";
  const { error } = await probe.rpc("live_identity", { p_session: nil, p_user: nil });
  return !error;
}

async function participantBy(
  admin: SupabaseClient,
  sessionId: string,
  column: "user_id" | "identity",
  value: string,
): Promise<Participant | null> {
  const { data, error } = await admin
    .from("live_participants")
    .select("user_id, identity, role, left_at")
    .eq("session_id", sessionId)
    .eq(column, value)
    .maybeSingle<Participant>();
  if (error) throw new LiveFail("server_error", error.message);
  return data ?? null;
}

/** Lifecycle transitions: set_live_session_status (0138) — D3, timestamps, fan-outs. */
async function setStatus(admin: SupabaseClient, sessionId: string, status: LiveStatus, egressId?: string) {
  const { error } = await admin.rpc("set_live_session_status", {
    p_session: sessionId,
    p_status: status,
    p_egress_id: egressId ?? null,
  });
  if (error) throw new LiveFail(statusRpcErrorCode(error.message), error.message);
}

async function setRole(admin: SupabaseClient, sessionId: string, identity: string, role: string) {
  const { error } = await admin
    .from("live_participants")
    .update({ role })
    .eq("session_id", sessionId)
    .eq("identity", identity);
  if (error) throw new LiveFail("server_error", error.message);
}

/**
 * The session recording (`start`, and `resume_recording` after a crash — the
 * SAME settings): audio-only RoomComposite to a local file on the VPS (no s3
 * block: nothing can lose the recording between egress and R2 — the worker
 * uploads it and keeps it until done), /recordings/<env>/{room_name}-{time}.ogg,
 * no manifest, Opus 64 kbps / 48 kHz (`advanced` options; OGG is Opus-only).
 */
function startRecordingEgress(room: string, env: "stg" | "prd") {
  return lk(() => egress.startRoomCompositeEgress(
    room,
    {
      file: new EncodedFileOutput({
        fileType: EncodedFileType.OGG,
        filepath: recordingFilepath(env),
        disableManifest: true,
      }),
    },
    {
      audioOnly: true,
      encodingOptions: new EncodingOptions({
        audioCodec: AudioCodec.OPUS,
        audioBitrate: RECORDING_AUDIO.bitrateKbps,
        audioFrequency: RECORDING_AUDIO.frequencyHz,
      }),
    },
  ));
}

/** CreateRoom is idempotent; our server has auto_create off, so every join needs it first. */
async function ensureRoom(room: string, allowRequests: boolean) {
  await lk(() => rooms.createRoom({
    name: room,
    emptyTimeout: ROOM_EMPTY_TIMEOUT_S,
    departureTimeout: ROOM_DEPARTURE_TIMEOUT_S,
    maxParticipants: ROOM_MAX_PARTICIPANTS,
    metadata: roomMetadata(allowRequests),
  }));
}

/** Run a LiveKit call; a 404 means the participant/room isn't there. */
async function lk<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isNotFound(e)) throw new LiveFail("not_present", (e as Error).message);
    throw new LiveFail("livekit_error", (e as Error).message);
  }
}

function isNotFound(e: unknown): boolean {
  const err = e as { status?: number; code?: string; message?: string };
  return err?.status === 404 || err?.code === "not_found" || /not.?found/i.test(err?.message ?? "");
}

function logLk(call: string, e: unknown) {
  if (!isNotFound(e)) console.error(`live-control ${call}: ${(e as Error)?.message ?? e}`);
}

function fail(code: LiveErrorCode, detail?: string): Response {
  const status = LIVE_ERROR_STATUS[code];
  if (status >= 500) console.error(`live-control ${code}: ${detail ?? ""}`);
  return json(status < 500 && detail && detail !== code ? { error: code, detail } : { error: code }, status);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
