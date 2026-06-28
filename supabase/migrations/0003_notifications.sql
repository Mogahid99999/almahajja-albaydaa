-- =============================================================================
-- 0003_notifications.sql
-- منصة دروس العلم الشرعي — Phase 2 · الإشعارات (notifications)
--
-- Push + in-app inbox for:
--   * new_lecture      — a lecture published in a FOLLOWED section subtree
--   * new_attachment   — an attachment added on a followed section/lecture
--   * new_quiz         — quizzes are still deferred; the type ships now so the
--                        pref + payload light up later with no migration
--   * resume_reminder  — "لديك درس لم تكمله" (scheduled locally on-device)
--
-- Tables here are ALL personal (one row per user): they copy the own-rows RLS
-- shape from `progress_own` in 0001 (using/with check = user_id = auth.uid()).
-- The cross-user FAN-OUT that inserts notifications into *other* users' rows is
-- NOT a client write — it runs in a SECURITY DEFINER function / Edge Function
-- (service role) at the §4 live cutover (see PLAN_PHASE2.md §2.2). In mock mode
-- the fan-out is faked locally in src/mock/api.ts.
--
-- File is numbered 0003 but lands AFTER 0004 chronologically — numbers are for
-- ordering only and the migrations are independent (0001 is never edited).
-- Idempotent: safe to re-run (do $$ … exception when duplicate_object + drops).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.notification_type as enum
    ('new_lecture', 'new_attachment', 'new_quiz', 'resume_reminder');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A student follows a section (root or nested). A follow implies the WHOLE
-- subtree under that node — resolved server-side at fan-out time by walking the
-- lecture's ancestor chain (reuse the recursive subtree pattern from 0001),
-- never by client tree-walking.
create table if not exists public.section_follows (
  user_id    uuid not null references auth.users (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, section_id)
);
create index if not exists section_follows_section_idx
  on public.section_follows (section_id);

-- Per-user device push tokens (Expo push token). Multiple devices per user; the
-- (user_id, token) PK makes re-registration idempotent.
create table if not exists public.push_tokens (
  user_id    uuid not null references auth.users (id) on delete cascade,
  token      text not null,
  platform   text not null default 'android',
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- Per-user, per-type on/off. ABSENCE of a row = default ON (the app + fan-out
-- both treat a missing row as enabled), so we never need to backfill defaults.
create table if not exists public.notification_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  type    public.notification_type not null,
  enabled boolean not null default true,
  primary key (user_id, type)
);

-- Delivered/queued notifications — the source for the in-app "الإشعارات" inbox
-- (render history + de-dupe). Resume reminders are scheduled locally and are
-- NOT stored here as content. `data` carries the deep-link payload, one of
-- {sectionId | lectureId | attachmentId}.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       public.notification_type not null,
  title      text not null,
  body       text not null,
  data       jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- =============================================================================
-- Row Level Security — all personal: own rows only (copies `progress_own`).
-- The fan-out INSERT into other users' notifications runs as service role
-- (SECURITY DEFINER / Edge Function), which bypasses these policies by design.
-- =============================================================================
alter table public.section_follows    enable row level security;
alter table public.push_tokens        enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notifications      enable row level security;

drop policy if exists section_follows_own on public.section_follows;
create policy section_follows_own on public.section_follows
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notification_prefs_own on public.notification_prefs;
create policy notification_prefs_own on public.notification_prefs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notifications: a user reads/updates (mark-read) only their own. They do NOT
-- insert their own content rows — fan-out is server-side — but the own-rows
-- policy is the same shape; inserts simply never originate from the client.
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.section_follows    to authenticated;
grant select, insert, update, delete on public.push_tokens        to authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;
grant select, insert, update, delete on public.notifications      to authenticated;

-- =============================================================================
-- DEFERRED to the §4 live cutover (NOT created here — design seam only):
--   * public.followers_of_section(p_section_id uuid) returns table(user_id uuid)
--       — SECURITY DEFINER; walks the ancestor chain of p_section_id and returns
--         distinct user_ids whose section_follows row matches the section or any
--         ancestor (subtree semantics), via a WITH RECURSIVE ancestor CTE.
--   * notify-on-publish — AFTER INSERT/UPDATE trigger on lectures (→published)
--       and AFTER INSERT on attachments; resolves followers_of_section, filters
--       by each follower's notification_prefs (missing row = ON), inserts
--       notifications rows, and POSTs to the Expo Push API using push_tokens.
-- These are the only live-only pieces; the client api branches throw NOT_LIVE
-- until then, exactly like features A and C.
-- =============================================================================
