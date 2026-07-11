-- =============================================================================
-- 0075_admin_user_list_phone_registration.sql
-- المَحجّة البَيْضَاء — fix "المسجلين" filter to count phone-only registrations.
--
-- 0074's p_registered_only checked `u.email is not null`, silently treating
-- every phone-only registered account as a guest. Registration in this app
-- accepts phone OR email (phone required, email optional — see
-- app/(auth)/register.tsx / CreateUserModal in app/admin/users.tsx), and in
-- practice most registered accounts are phone-only: of 116 truly-registered
-- profiles, 109 have a phone and no email, 6 have email only, 1 has both.
-- Filtering on email alone under-counted "المسجلين" by ~95%.
--
-- The correct signal for "completed registration" is auth.users.is_anonymous
-- (false = registered via phone or email or was admin-created; true = an
-- anonymous/guest session) — not the presence of any particular contact
-- field. Also exposes is_anonymous on the row so the client can render
-- "حساب ضيف" precisely instead of inferring it from a missing email.
--
-- Append-only — 0001–0074 are never edited. Idempotent.
-- =============================================================================

drop function if exists public.admin_user_list(text, int, int, boolean, text);

create or replace function public.admin_user_list(
  p_search          text default null,
  p_limit           int  default 100,
  p_offset          int  default 0,
  p_registered_only boolean default false,
  p_status          text default null  -- 'active' | 'inactive' | 'banned' | null (=all)
)
returns table (
  id                  uuid,
  display_name        text,
  email               text,
  phone               text,
  gender              text,
  role                text,
  created_at          timestamptz,
  last_opened_at      timestamptz,
  last_sign_in_at     timestamptz,
  banned_until        timestamptz,
  status              text,
  is_anonymous        boolean,
  completed_lectures  bigint,
  passed_quizzes      bigint,
  current_streak      int,
  weekly_goal_target  int,
  weekly_goal_metric  text,
  total_count         bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select
      p.id,
      coalesce(nullif(p.display_name, ''), nullif(u.raw_user_meta_data->>'display_name','')) as display_name,
      u.email,
      u.phone,
      p.gender,
      p.role::text,
      p.created_at,
      p.last_opened_at,
      u.last_sign_in_at,
      u.banned_until,
      case
        when u.banned_until is not null and u.banned_until > now() then 'banned'
        when p.last_opened_at is null or p.last_opened_at < now() - interval '30 days' then 'inactive'
        else 'active'
      end as status,
      coalesce(u.is_anonymous, false) as is_anonymous,
      coalesce((select count(*) from public.user_lecture_progress pr
                  join public.lectures l on l.id = pr.lecture_id and l.status = 'published'
                 where pr.user_id = p.id and pr.completed), 0) as completed_lectures,
      coalesce((select count(distinct a.quiz_id) from public.quiz_attempts a
                 where a.user_id = p.id and a.passed), 0) as passed_quizzes,
      public.streak_for_user(p.id) as current_streak,
      g.target as weekly_goal_target,
      g.metric::text as weekly_goal_metric
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.weekly_goals g on g.user_id = p.id
    where public.is_admin()
      and (
        p_search is null or btrim(p_search) = ''
        or coalesce(p.display_name,'') ilike '%' || p_search || '%'
        or coalesce(u.email,'')        ilike '%' || p_search || '%'
        or coalesce(u.phone,'')        ilike '%' || p_search || '%'
      )
      and (not p_registered_only or coalesce(u.is_anonymous, false) = false)
  )
  select b.*, count(*) over () as total_count
    from base b
   where p_status is null or b.status = p_status
   order by b.created_at desc, b.id desc
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

revoke execute on function public.admin_user_list(text, int, int, boolean, text) from public, anon;
grant execute on function public.admin_user_list(text, int, int, boolean, text) to authenticated;
