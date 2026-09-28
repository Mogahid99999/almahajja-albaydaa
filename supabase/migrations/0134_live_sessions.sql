-- =============================================================================
-- 0134_live_sessions.sql
-- المَحجّة البَيْضَاء — V23 P2: «البث المباشر» sessions.
--
-- (PLAN_LIVE_V23 §4 "0132_live_sessions" — renumbered after media_jobs 0132 + 0133.)
-- Apply 0134→0138 in order, each in its own transaction. Notifications (enum
-- values, fan-outs, reminders cron) are P5: 0139_live_notifications.sql — nothing
-- in 0134–0138 depends on it.
--
-- One row per live «مجلس». Lifecycle (status):
--   scheduled ─open_green─► green ─start─► live ─end─► ended
--        │                    │                        │
--        └──► cancelled ◄─────┘         (egress file known)
--   processing (media_jobs live_recording) ─► ready (lecture created) | failed
--   failed ─retry_live_recording─► processing
-- Transitions happen server-side only (0138): create_live_session /
-- cancel_live_session / retry_live_recording (staff) and set_live_session_status /
-- enqueue_live_recording / create_live_lecture / live_room_event (service role —
-- the live-control edge function and the media worker).
--
-- Read model:
--   * Staff (content manager or sheikh) SELECT the table directly (all columns).
--   * Everyone else (students, guests) reads `live_sessions_public`: safe columns
--     only (no raw paths / egress_id / host_user_id), public statuses only, and the
--     section gender scope (0072 section_visible_to_viewer) applied — or the
--     definer RPCs get_live_now / get_live_by_code (0138).
--
-- D3 (one concurrent live, VPS budget §3.6): at most ONE row may be in
-- status green|live at any time — enforced by the partial unique index
-- live_sessions_one_active (authoritative, race-free); the RPCs pre-check it only
-- to raise a friendly Arabic error (and first cancel green rooms idle > 3 h).
--
-- Owner rule (replaces D5) — a live recording is never lost:
--   raw_path            the egress file on the VPS disk
--                       (/recordings/<stg|prd>/<room>-<time>.ogg); the worker's
--                       input. Kept on every failure; staff can retry.
--   raw_backup_key      the R2 copy (live-raw/<basename>) the worker uploads.
--   lecture_published_at set by a trigger on lectures (0137) while the lecture
--                       is published; cleared when it is unpublished.
--   raw_deleted_at      the worker deletes the local raw ONLY when the lecture has
--                       been published ≥ 7 days AND raw_backup_key is set
--                       (live_raws_due_for_deletion / mark_live_raw_deleted, 0138).
--
-- Room names are env-prefixed ('prd_' / 'stg_') because both environments share
-- one LiveKit server (§3.5); the prefix lives in the private live_config row,
-- detected at migration time from push_config.url (0131 — holds the project's
-- own functions URL). The identity salt for live_participants (0135) lives in
-- the same row.
--
-- Also adds the media_jobs.live_session_id FK promised by 0132.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Status enum --------------------------------------------------------------------
do $$ begin
  create type public.live_status as enum
    ('scheduled', 'green', 'live', 'ended', 'processing', 'ready', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

-- 2. Private per-environment config (one row) --------------------------------------
create table if not exists public.live_config (
  id            boolean primary key default true check (id),
  room_prefix   text not null check (room_prefix in ('prd_', 'stg_')),
  identity_salt text not null
);
alter table public.live_config enable row level security;
revoke all on table public.live_config from public, anon, authenticated;

do $$
declare
  v_url text;
begin
  if exists (select 1 from public.live_config) then
    return;  -- re-run: keep the existing prefix + salt
  end if;
  if to_regclass('public.push_config') is not null then
    execute 'select url from public.push_config limit 1' into v_url;
  end if;
  insert into public.live_config (room_prefix, identity_salt)
  values (
    case when coalesce(v_url, '') like '%prpyxnxgkpspjoxvcaro%' then 'prd_' else 'stg_' end,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  );
end $$;

-- 3. Table ------------------------------------------------------------------------------
create table if not exists public.live_sessions (
  id                   uuid primary key default gen_random_uuid(),
  section_id           uuid not null references public.sections (id) on delete cascade,
  sheikh_id            uuid references public.sheikhs (id) on delete set null,
  title                text not null check (length(btrim(title)) between 3 and 200),  -- preliminary title
  status               public.live_status not null default 'scheduled',
  scheduled_at         timestamptz,
  started_at           timestamptz,
  ended_at             timestamptz,
  host_user_id         uuid references auth.users (id) on delete set null,
  allow_requests       boolean not null default true,
  notify_all           boolean not null default true,
  room_name            text not null unique,   -- live_config.room_prefix || 12 hex
  share_code           text not null unique
                       check (share_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'),
  egress_id            text,
  raw_path             text check (raw_path is null or raw_path like '/recordings/%'),
  raw_backup_key       text check (raw_backup_key is null or raw_backup_key like 'live-raw/%'),
  raw_deleted_at       timestamptz,
  lecture_id           uuid references public.lectures (id) on delete set null,
  lecture_published_at timestamptz,
  peak_listeners       int not null default 0 check (peak_listeners >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint live_sessions_scheduled_has_time
    check (status <> 'scheduled' or scheduled_at is not null)
);

comment on table public.live_sessions is
  'V23 live audio sessions («البث المباشر»). Staff read the table; everyone else reads live_sessions_public or the 0138 RPCs. Writes: 0138 RPCs + the live-control edge function (service role).';

-- D3: one green-or-live session at a time (authoritative guard).
create unique index if not exists live_sessions_one_active
  on public.live_sessions ((true))
  where status in ('green', 'live');

create index if not exists live_sessions_section_idx
  on public.live_sessions (section_id);
create index if not exists live_sessions_upcoming_idx
  on public.live_sessions (scheduled_at)
  where status = 'scheduled';
create index if not exists live_sessions_raw_due_idx
  on public.live_sessions (lecture_published_at)
  where raw_path is not null and raw_deleted_at is null;
create index if not exists live_sessions_sheikh_idx
  on public.live_sessions (sheikh_id);
create index if not exists live_sessions_lecture_idx
  on public.live_sessions (lecture_id);

drop trigger if exists live_sessions_set_updated_at on public.live_sessions;
create trigger live_sessions_set_updated_at
  before update on public.live_sessions
  for each row execute function public.set_updated_at();

-- 4. RLS: staff read everything; no client writes -----------------------------------
alter table public.live_sessions enable row level security;

revoke all on table public.live_sessions from public, anon, authenticated;
grant select on table public.live_sessions to authenticated;
grant select, insert, update, delete on table public.live_sessions to service_role;

drop policy if exists live_sessions_select_staff on public.live_sessions;
create policy live_sessions_select_staff on public.live_sessions
  for select to authenticated
  using (public.is_content_manager() or public.is_sheikh());

-- 5. Public read model -----------------------------------------------------------------
-- A definer view (runs as its owner, so it can read past the staff-only RLS
-- above) that exposes only safe columns + public statuses + the gender scope of
-- the viewer. security_barrier keeps caller-supplied predicates from being
-- pushed below the filter. lecture_id only once that lecture is published.
create or replace view public.live_sessions_public
with (security_barrier = true) as
select s.id,
       s.section_id,
       s.sheikh_id,
       s.title,
       s.status,
       s.scheduled_at,
       s.started_at,
       s.ended_at,
       s.allow_requests,
       s.share_code,
       case when s.lecture_published_at is not null then s.lecture_id end as lecture_id,
       s.created_at
  from public.live_sessions s
 where s.status in ('scheduled', 'live', 'ended', 'processing', 'ready')
   and public.section_visible_to_viewer(
         s.section_id,
         (select p.gender from public.profiles p where p.id = auth.uid())
       );

revoke all on table public.live_sessions_public from public, anon, authenticated;
grant select on table public.live_sessions_public to authenticated;

-- 6. media_jobs.live_session_id FK (column created by 0132) --------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_jobs_live_session_id_fkey'
  ) then
    alter table public.media_jobs
      add constraint media_jobs_live_session_id_fkey
      foreign key (live_session_id) references public.live_sessions (id) on delete set null;
  end if;
end $$;

create index if not exists media_jobs_live_session_idx
  on public.media_jobs (live_session_id);
