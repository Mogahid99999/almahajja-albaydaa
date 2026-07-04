-- =============================================================================
-- 0024_admin_analytics.sql
-- المَحجّة البَيْضَاء — V5 (Features 2 & 3): admin dashboard + progress analytics.
--
-- Two SECURITY DEFINER RPCs, each gated on public.is_admin() (users/analytics
-- stay admin-only — publishers never reach these). All rollups are server-side
-- here, never client tree-walking. "Local day/month" uses the +3h offset the
-- 0016 notifications cron established (KSA/Sudan UTC+3).
--
-- No student-vs-student ranking is ever exposed in the student app: the two
-- name-bearing lists in admin_progress_analytics are PRIVATE to admin.
--
-- Append-only — 0001–0023 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Feature 2 — dashboard overview (calm number tiles + two short "top" lists)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Feature 3 — تحليلات التقدم العلمي (aggregate + two admin-private lists)
-- ---------------------------------------------------------------------------
create or replace function public.admin_progress_analytics()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Every (ancestor section, published lecture-in-subtree) pair, so a "section"
  -- rolls up its whole subtree (nested-sections semantics).
  with recursive descendants as (
    select id as root, id as node from public.sections
    union all
    select d.root, s.id from public.sections s join descendants d on s.parent_id = d.node
  ),
  section_lectures as (
    select distinct d.root as section_id, l.id as lecture_id
      from descendants d
      join public.lectures l on l.section_id = d.node and l.status = 'published'
  ),
  section_totals as (
    select section_id, count(*) as total from section_lectures group by section_id
  ),
  -- Per-student completed count within each section subtree.
  student_section as (
    select sl.section_id, p.completed_lecture as lecture_id, p.user_id
      from section_lectures sl
      join (
        select user_id, lecture_id as completed_lecture
          from public.user_lecture_progress where completed
      ) p on p.completed_lecture = sl.lecture_id
  ),
  student_section_counts as (
    select section_id, user_id, count(*) as done
      from student_section group by section_id, user_id
  ),
  -- Students who STARTED (any progress) in each section subtree.
  student_started as (
    select distinct sl.section_id, pr.user_id
      from section_lectures sl
      join public.user_lecture_progress pr
        on pr.lecture_id = sl.lecture_id and (pr.completed or pr.position_sec > 0)
  ),
  -- Per-student total completed lectures (published only) — for the count buckets.
  per_student_completed as (
    select pr.user_id, count(*) as completed
      from public.user_lecture_progress pr
      join public.lectures l on l.id = pr.lecture_id and l.status = 'published'
     where pr.completed
     group by pr.user_id
  ),
  -- Students who completed a WHOLE section (subtree with >=1 lecture).
  full_section_students as (
    select distinct c.user_id
      from student_section_counts c
      join section_totals t on t.section_id = c.section_id
     where t.total >= 1 and c.done >= t.total
  ),
  -- Per-section aggregate over ROOT (top-level) sections only, for a clean list.
  roots as (
    select id, title from public.sections where parent_id is null
  ),
  section_agg as (
    select r.id, r.title,
           coalesce(t.total, 0)                                          as total_lectures,
           (select count(*) from student_started ss where ss.section_id = r.id) as students_started,
           coalesce((
             select round(avg(least(c.done::numeric / nullif(t.total, 0), 1)) * 100)
               from student_section_counts c where c.section_id = r.id
           ), 0)                                                          as avg_completion
      from roots r
      left join section_totals t on t.section_id = r.id
     where coalesce(t.total, 0) > 0
  )
  select jsonb_build_object(
    'completed_first',   (select count(*) from per_student_completed where completed >= 1),
    'completed_5',       (select count(*) from per_student_completed where completed >= 5),
    'completed_10',      (select count(*) from per_student_completed where completed >= 10),
    'completed_section', (select count(*) from full_section_students),
    'sections',          (select coalesce(jsonb_agg(jsonb_build_object(
                              'title', title,
                              'total_lectures', total_lectures,
                              'students_started', students_started,
                              'avg_completion', avg_completion) order by avg_completion desc), '[]'::jsonb)
                            from section_agg),
    'good_progress',     (select coalesce(jsonb_agg(jsonb_build_object(
                              'user_id', pc.user_id,
                              'display_name', pf.display_name,
                              'completed', pc.completed,
                              'last_opened_at', pf.last_opened_at) order by pc.completed desc), '[]'::jsonb)
                            from per_student_completed pc
                            join public.profiles pf on pf.id = pc.user_id
                           where pc.completed >= 5
                             and pf.last_opened_at is not null
                             and pf.last_opened_at >= now() - interval '7 days'),
    'started_stopped',   (select coalesce(jsonb_agg(jsonb_build_object(
                              'user_id', pf.id,
                              'display_name', pf.display_name,
                              'in_progress', ip.n,
                              'last_opened_at', pf.last_opened_at) order by ip.n desc), '[]'::jsonb)
                            from public.profiles pf
                            join (
                              select pr.user_id, count(*) as n
                                from public.user_lecture_progress pr
                                join public.lectures l on l.id = pr.lecture_id and l.status = 'published'
                               where pr.position_sec > 0 and not pr.completed
                               group by pr.user_id
                            ) ip on ip.user_id = pf.id
                           where pf.role = 'student'
                             and (pf.last_opened_at is null or pf.last_opened_at < now() - interval '14 days'))
  ) into v_result;

  return v_result;
end; $$;

grant execute on function public.admin_progress_analytics() to authenticated;
