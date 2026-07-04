-- =============================================================================
-- 0026_dashboard_registered.sql
-- المَحجّة البَيْضَاء — V5 follow-up: add "المسجلون" (registered students, i.e.
-- accounts that completed sign-up with an email — not silent anonymous guests)
-- to the dashboard stats. Re-creates admin_dashboard_stats() (SECURITY DEFINER,
-- is_admin-gated) with one extra jsonb field; everything else is unchanged.
--
-- Append-only — 0001–0025 never edited. Idempotent.
-- =============================================================================

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today       date := (now() + interval '3 hours')::date;
  v_month_start timestamptz := date_trunc('month', now() + interval '3 hours') - interval '3 hours';
  v_result      jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with top_sections as (
    select s.id, s.title,
           sum(dl.seconds_listened::numeric / greatest(array_length(dl.lecture_ids, 1), 1)) as secs
      from public.daily_listening dl
      cross join lateral unnest(dl.lecture_ids) as lid
      join public.lectures l on l.id = lid
      join public.sections s on s.id = l.section_id
     group by s.id, s.title
     order by secs desc
     limit 5
  ),
  top_quizzes as (
    select q.id, q.title, count(*) as attempts
      from public.quiz_attempts a
      join public.quizzes q on q.id = a.quiz_id
     where a.submitted_at is not null
     group by q.id, q.title
     order by attempts desc
     limit 5
  )
  select jsonb_build_object(
    'total_users',       (select count(*) from public.profiles where role = 'student'),
    'registered_users',  (select count(*) from public.profiles p join auth.users u on u.id = p.id
                            where p.role = 'student' and u.email is not null),
    'new_users_month',   (select count(*) from public.profiles where role = 'student' and created_at >= v_month_start),
    'new_users_week',    (select count(*) from public.profiles where role = 'student' and created_at >= now() - interval '7 days'),
    'active_today',      (select count(*) from public.profiles
                            where role = 'student' and last_opened_at is not null
                              and (last_opened_at + interval '3 hours')::date = v_today),
    'sections_count',    (select count(*) from public.sections),
    'lectures_published',(select count(*) from public.lectures where status = 'published'),
    'published_quizzes', (select count(*) from public.quizzes where status = 'published'),
    'listen_hours_total',(select coalesce(round(sum(seconds_listened)::numeric / 3600, 1), 0) from public.daily_listening),
    'listen_hours_month',(select coalesce(round(sum(seconds_listened)::numeric / 3600, 1), 0)
                            from public.daily_listening where day >= date_trunc('month', now() + interval '3 hours')::date),
    'top_sections',      (select coalesce(jsonb_agg(jsonb_build_object(
                              'title', title, 'hours', round(secs / 3600, 1))), '[]'::jsonb) from top_sections),
    'top_quizzes',       (select coalesce(jsonb_agg(jsonb_build_object(
                              'title', title, 'attempts', attempts)), '[]'::jsonb) from top_quizzes)
  ) into v_result;

  return v_result;
end; $$;

grant execute on function public.admin_dashboard_stats() to authenticated;
