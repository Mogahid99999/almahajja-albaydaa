-- =============================================================================
-- 0141_live_hands.sql
-- المَحجّة البَيْضَاء — V23 P4: «طلب الكلمة» (raise hand) goes through the server.
--
-- P4 makes every LiveKit participant attribute (g / r / h / hid) and the
-- participant name SERVER-ONLY: no token or permission carries
-- canUpdateOwnMetadata / canUpdateMetadata any more, because LiveKit lets a
-- participant holding that grant set ANY attribute and its own name (a listener
-- could claim r=host — the client seats the sheikh by attribute r — or rename
-- himself). So the hand is raised and lowered by the live-control edge function
-- (action `hand`, { sessionId, up }), which sets h = the raise time in epoch
-- seconds ('0' = down) with RoomService.UpdateParticipant.
--
-- live_participants.hand_at: when this participant last toggled his hand
-- (raise or lower), written by live-control (service role). It backs the §10
-- server-side rate limit — at most one toggle per 5 s per participant
-- (liveRules HAND_RATE_LIMIT_MS; 429 rate_limited). A raise claims the slot
-- with a conditional UPDATE (hand_at is null or older than the window), so two
-- concurrent raises cannot both pass. Lowering is never refused (a hand must
-- never be trapped up) but still records hand_at. NULL = never toggled.
-- Whether the hand is up NOW lives only in the room (attribute h); a fresh
-- token starts with it down. Not logged in live_moderation_log (its action
-- check list has no `hand` — a participant's own request isn't a moderation act).
--
-- No RLS change: live_participants is already service-role only (0135 — RLS
-- on, no policies, all privileges revoked from public/anon/authenticated), and
-- nothing exposes the new column (get_live_participants, 0138, lists its
-- columns explicitly).
--
-- Deploy order: apply this BEFORE deploying the P4 live-control (its `hand`
-- action reads/writes hand_at; the other actions never touch the column).
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

alter table public.live_participants
  add column if not exists hand_at timestamptz;

comment on column public.live_participants.hand_at is
  'V23 P4: last hand toggle (raise or lower) via live-control `hand` — server-side rate limit, 1 toggle / 5 s. NULL = never toggled.';
