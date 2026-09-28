-- =============================================================================
-- 0136_live_social.sql
-- المَحجّة البَيْضَاء — V23 P2: «ذكّرني» and buddy-invite TABLES.
--
-- (PLAN_LIVE_V23 §4 "0134_live_social" — renumbered, and split: this file only
-- creates the two tables so get_live_now (0138) can report my «ذكّرني» flag.
-- Everything notification-related — the live_start / live_reminder / live_invite
-- enum values, prefs, fan-outs, the reminders cron and the write RPCs
-- set_live_reminder / invite_buddy_to_live — is phase P5:
-- 0139_live_notifications.sql. Until then nothing writes these tables.)
--
-- * live_reminders — «ذكّرني» on a scheduled session.
-- * live_buddy_invites — the primary key enforces «once per buddy per session».
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. «ذكّرني» ---------------------------------------------------------------------------
create table if not exists public.live_reminders (
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index if not exists live_reminders_user_idx on public.live_reminders (user_id);

alter table public.live_reminders enable row level security;
revoke all on table public.live_reminders from public, anon, authenticated;
grant select on table public.live_reminders to authenticated;
grant select, insert, update, delete on table public.live_reminders to service_role;

-- Own rows only (the «ذكّرني» toggle state). Writes: set_live_reminder (0139).
drop policy if exists live_reminders_select_own on public.live_reminders;
create policy live_reminders_select_own on public.live_reminders
  for select to authenticated
  using (user_id = auth.uid());

-- 2. Buddy invites --------------------------------------------------------------------
create table if not exists public.live_buddy_invites (
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  from_user  uuid not null references auth.users (id) on delete cascade,
  to_user    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, from_user, to_user),
  check (from_user <> to_user)
);
create index if not exists live_buddy_invites_to_idx on public.live_buddy_invites (to_user);

alter table public.live_buddy_invites enable row level security;
revoke all on table public.live_buddy_invites from public, anon, authenticated;
grant select on table public.live_buddy_invites to authenticated;
grant select, insert, update, delete on table public.live_buddy_invites to service_role;

-- The inviter sees whom they already invited (to show «أُرسلت الدعوة»).
-- Writes: invite_buddy_to_live (0139).
drop policy if exists live_buddy_invites_select_own on public.live_buddy_invites;
create policy live_buddy_invites_select_own on public.live_buddy_invites
  for select to authenticated
  using (from_user = auth.uid());
