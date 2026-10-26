-- =============================================================================
-- 0163 — «متحدث دائم في البثوث»: the main admin lets a listener speak in EVERY
-- live session without raising a hand or being approved, and without making
-- him a publisher/staff (owner 2026-10-26).
--
-- Server-only: live-token reads `permanent_speaker` from live_join_context and
-- mints a speaker token on join (mic closed, like an approved speaker). A
-- moderator may still demote him in one session: a `demote`/`step_down` in
-- live_moderation_log for his identity keeps him a listener for the rest of
-- THAT session (`demoted_here`). Guests never speak (liveRoleFor).
--
-- A separate table (not a profiles column) so no profile self-update policy
-- can ever flip it; RLS on with no client policies — only the admin RPCs below.
--
-- live_join_context body = the live prod definition (pg_get_functiondef,
-- 2026-10-26, identical to 0157) + the marked additions.
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Table ----------------------------------------------------------------------------
create table if not exists public.live_permanent_speakers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now()
);
comment on table public.live_permanent_speakers is
  '0163: users who join every live session as a speaker (granted by an admin from /admin/user/[id]).';
alter table public.live_permanent_speakers enable row level security;
revoke all on table public.live_permanent_speakers from public, anon, authenticated;

-- 2. Admin RPCs -------------------------------------------------------------------------
create or replace function public.admin_get_live_speaker(p_user uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return exists (select 1 from public.live_permanent_speakers where user_id = p_user);
end;
$$;

create or replace function public.admin_set_live_speaker(p_user uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_on then
    if exists (select 1 from auth.users u where u.id = p_user and coalesce(u.is_anonymous, false)) then
      raise exception 'guest_cannot_speak' using errcode = '22023';
    end if;
    insert into public.live_permanent_speakers (user_id, granted_by)
    values (p_user, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from public.live_permanent_speakers where user_id = p_user;
  end if;
  return p_on;
end;
$$;

revoke all on function public.admin_get_live_speaker(uuid) from public, anon;
revoke all on function public.admin_set_live_speaker(uuid, boolean) from public, anon;
grant execute on function public.admin_get_live_speaker(uuid) to authenticated;
grant execute on function public.admin_set_live_speaker(uuid, boolean) to authenticated;

-- 3. live_join_context: + permanent_speaker, demoted_here -----------------------------
create or replace function public.live_join_context(p_session uuid, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user', (select jsonb_build_object('banned_until', u.banned_until,
                                       'is_anonymous', coalesce(u.is_anonymous, false))
               from auth.users u where u.id = p_user),
    'flag', (select c.value from public.app_config c where c.key = 'live_enabled'),
    'profile', (select jsonb_build_object('role', p.role, 'gender', p.gender,
                                          'display_name', p.display_name)
                  from public.profiles p where p.id = p_user),
    'session', (select jsonb_build_object('id', s.id, 'status', s.status, 'room_name', s.room_name,
                                          'host_user_id', s.host_user_id, 'section_id', s.section_id,
                                          'allow_requests', s.allow_requests)
                  from public.live_sessions s where s.id = p_session),
    'stored', (select jsonb_build_object('role', lp.role, 'hidden_name', lp.hidden_name,
                                         'reactions_blocked', lp.reactions_blocked)  -- 0157
                 from public.live_participants lp
                where lp.session_id = p_session and lp.user_id = p_user),
    'visible', (select public.section_visible_to_viewer(
                         s.section_id,
                         (select p.gender from public.profiles p where p.id = p_user))
                  from public.live_sessions s where s.id = p_session),
    'identity', public.live_identity(p_session, p_user),
    -- 0163
    'permanent_speaker', exists (select 1 from public.live_permanent_speakers ps where ps.user_id = p_user),
    'demoted_here', exists (select 1 from public.live_moderation_log ml
                             where ml.session_id = p_session
                               and ml.action in ('demote', 'step_down')
                               and ml.target_identity = public.live_identity(p_session, p_user))
  );
$$;
revoke all on function public.live_join_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.live_join_context(uuid, uuid) to service_role;
