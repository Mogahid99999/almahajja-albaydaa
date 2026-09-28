-- =============================================================================
-- 0135_live_participants.sql
-- المَحجّة البَيْضَاء — V23 P2: who was in a live session, and what moderators did.
--
-- (PLAN_LIVE_V23 §4 "0133_live_participants" — renumbered.)
--
-- live_participants: one row per (session, user), upserted by the live-token
-- edge function (service role) every time a token is minted, and kept current by
-- live_room_event (0138, the worker's LiveKit webhooks): present / left_at /
-- spoke_seconds. Used for moderation lookups (identity → user for abuse
-- handling), attendance stats, and the admin «مداخلات» list. NO direct client
-- access; staff read it through get_live_participants (0138).
--
-- identity: an opaque per-session id (first 16 hex of sha256(salt‖user‖session))
-- that is the LiveKit participant identity, so other clients never see user ids.
-- The salt (live_config.identity_salt, 0134) stops anyone who knows a user id
-- from computing where that user sits in a room.
--
-- D2 (owner decision 2026-09-28, CHANGED): moderators see every real name.
-- display_name ALWAYS holds the real profile name — a BEFORE trigger copies it
-- from profiles whatever the caller sent — and hidden_name only records that a
-- sister chose «بدون اسم» (she shows as «طالبة» to other listeners; the LiveKit
-- token name is the edge function's job). Real names reach staff only through
-- get_live_participants; students and guests never read this table.
--
-- live_moderation_log: append-only audit of live-control actions (approve,
-- reject, mute, demote, step_down, …) with timestamps — the source for
-- "interventions with timestamps" in the admin review (§8). Service role only.
--
-- gender uses the LiveKit attribute alphabet ('m' / 'f', §5.1), not the
-- profiles alphabet ('male' / 'female'); live_gender_code() maps it.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Participants ------------------------------------------------------------------
create table if not exists public.live_participants (
  session_id     uuid not null references public.live_sessions (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  identity       text not null check (identity ~ '^[0-9a-f]{16}$'),
  gender         text not null check (gender in ('m', 'f')),
  hidden_name    boolean not null default false,
  display_name   text check (display_name is null or length(display_name) <= 120),
  role           text not null default 'listener'
                 check (role in ('listener', 'speaker', 'host', 'moderator')),
  joined_at      timestamptz not null default now(),
  left_at        timestamptz,
  present        boolean not null default false,  -- in the LiveKit room now (webhooks)
  speaking_since timestamptz,                     -- mic track published since
  spoke_seconds  int not null default 0 check (spoke_seconds >= 0),
  primary key (session_id, user_id),
  constraint live_participants_identity_unique unique (session_id, identity),
  -- Only sisters may hide their name (decision 3).
  constraint live_participants_hidden_only_f check (not hidden_name or gender = 'f')
);

create index if not exists live_participants_user_idx
  on public.live_participants (user_id);

alter table public.live_participants enable row level security;
revoke all on table public.live_participants from public, anon, authenticated;
grant select, insert, update, delete on table public.live_participants to service_role;
-- (no policies: service role only)

-- D2: the stored name is always the real profile name (guests without one keep
-- whatever the caller sent, e.g. «ضيف»).
create or replace function public.live_participants_real_name()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  select nullif(btrim(p.display_name), '') into v_name
    from public.profiles p where p.id = new.user_id;
  new.display_name := left(coalesce(v_name, new.display_name), 120);
  return new;
end;
$$;
revoke all on function public.live_participants_real_name() from public, anon, authenticated;

drop trigger if exists live_participants_real_name on public.live_participants;
create trigger live_participants_real_name
  before insert or update of display_name, user_id on public.live_participants
  for each row execute function public.live_participants_real_name();

-- 2. Moderation audit log -------------------------------------------------------------
create table if not exists public.live_moderation_log (
  id               bigserial primary key,
  session_id       uuid not null references public.live_sessions (id) on delete cascade,
  actor_user_id    uuid references auth.users (id) on delete set null,
  target_identity  text,
  action           text not null check (action in (
                     'open_green', 'start', 'end', 'cancel', 'approve', 'reject',
                     'mute', 'demote', 'step_down', 'set_allow_requests', 'host_leave',
                     'auto_end')),
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists live_moderation_log_session_idx
  on public.live_moderation_log (session_id, created_at);

alter table public.live_moderation_log enable row level security;
revoke all on table public.live_moderation_log from public, anon, authenticated;
revoke all on sequence public.live_moderation_log_id_seq from public, anon, authenticated;
grant select, insert on table public.live_moderation_log to service_role;
grant usage on sequence public.live_moderation_log_id_seq to service_role;

-- 3. Helpers for the live-token edge function (service role) -------------------------
-- The opaque per-session identity. Deterministic, so a reconnect keeps the same
-- LiveKit identity (and the same row).
create or replace function public.live_identity(p_session uuid, p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select left(
           encode(
             sha256(convert_to(c.identity_salt || ':' || p_user::text || ':' || p_session::text, 'UTF8')),
             'hex'),
           16)
    from public.live_config c;
$$;
revoke all on function public.live_identity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.live_identity(uuid, uuid) to service_role;

-- profiles.gender ('male'/'female') → LiveKit attribute ('m'/'f'); null stays null
-- (the edge function answers 409 gender_required, §5.1).
create or replace function public.live_gender_code(p_gender text)
returns text
language sql immutable set search_path = public as $$
  select case p_gender when 'male' then 'm' when 'female' then 'f' end;
$$;
revoke all on function public.live_gender_code(text) from public, anon, authenticated;
grant execute on function public.live_gender_code(text) to service_role;
