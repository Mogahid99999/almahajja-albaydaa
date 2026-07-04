-- =============================================================================
-- 0025_admin_users.sql
-- المَحجّة البَيْضَاء — V5 (Feature 4): إدارة المستخدمين read RPCs.
--
-- Two SECURITY DEFINER RPCs gated on public.is_admin(). Because they are owned
-- by postgres they may read auth.users (email / phone / last_sign_in_at /
-- banned_until) — data that is NOT in public.profiles and never exposed to the
-- client except through this admin-only path. Publishers never reach these.
--
-- MUTATIONS (ban/unban, set-password, edit email, change role) need the service
-- role and live in the `admin-users` Edge Function, NOT here.
--
-- Status is DERIVED (no schema column): محظور = banned_until>now; غير نشط =
-- no app-open in 30 days; else نشط.
--
-- Append-only — 0001–0024 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- User list (search + pagination). One row per user, richest first-glance view.
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_list(
  p_search text default null,
  p_limit  int  default 100,
  p_offset int  default 0
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
  completed_lectures  bigint,
  passed_quizzes      bigint,
  current_streak      int,
  weekly_goal_target  int,
  weekly_goal_metric  text
)
language sql stable security definer set search_path = public as $$
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
  order by p.created_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function public.admin_user_list(text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- One user's full detail: profile + progress rows + quiz results (admin only).
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'id', p.id,
        'display_name', coalesce(nullif(p.display_name,''), u.raw_user_meta_data->>'display_name'),
        'email', u.email,
        'phone', u.phone,
        'gender', p.gender,
        'role', p.role::text,
        'created_at', p.created_at,
        'last_opened_at', p.last_opened_at,
        'last_sign_in_at', u.last_sign_in_at,
        'banned_until', u.banned_until,
        'status', case
          when u.banned_until is not null and u.banned_until > now() then 'banned'
          when p.last_opened_at is null or p.last_opened_at < now() - interval '30 days' then 'inactive'
          else 'active' end,
        'current_streak', public.streak_for_user(p.id),
        'weekly_goal_target', g.target,
        'weekly_goal_metric', g.metric::text)
      from public.profiles p
      left join auth.users u on u.id = p.id
      left join public.weekly_goals g on g.user_id = p.id
      where p.id = p_user_id
    ),
    'totals', jsonb_build_object(
      'completed_lectures', (select count(*) from public.user_lecture_progress pr
                               join public.lectures l on l.id = pr.lecture_id and l.status = 'published'
                              where pr.user_id = p_user_id and pr.completed),
      'in_progress_lectures', (select count(*) from public.user_lecture_progress pr
                                 join public.lectures l on l.id = pr.lecture_id and l.status = 'published'
                                where pr.user_id = p_user_id and not pr.completed and pr.position_sec > 0),
      'passed_quizzes', (select count(distinct a.quiz_id) from public.quiz_attempts a
                          where a.user_id = p_user_id and a.passed)
    ),
    'progress', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'lecture_id', l.id,
        'lecture_title', l.title,
        'section_title', s.title,
        'completed', pr.completed,
        'position_sec', pr.position_sec,
        'duration_sec', l.duration_sec,
        'updated_at', pr.updated_at) order by pr.updated_at desc), '[]'::jsonb)
      from public.user_lecture_progress pr
      join public.lectures l on l.id = pr.lecture_id
      left join public.sections s on s.id = l.section_id
      where pr.user_id = p_user_id
    ),
    'quiz_results', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quiz_title', q.title,
        'score', a.score,
        'passed', a.passed,
        'attempt_no', a.attempt_no,
        'submitted_at', a.submitted_at) order by a.submitted_at desc nulls last), '[]'::jsonb)
      from public.quiz_attempts a
      join public.quizzes q on q.id = a.quiz_id
      where a.user_id = p_user_id and a.submitted_at is not null
    )
  ) into v_result;

  return v_result;
end; $$;

grant execute on function public.admin_user_detail(uuid) to authenticated;
