-- =============================================================================
-- 0081_sheikh_staff_viewer.sql
-- المَحجّة البَيْضَاء — give the sheikh a read/teach slice of the admin panel:
-- لوحة المعلومات · تحليلات التقدم · الاختبارات · مشاركات الدارسين (+ الأسئلة,
-- which already allowed moderators). "Full parity" was requested on quizzes and
-- contributions; per the recommended safety line, the sheikh gets CONTENT
-- parity (create/publish/delete quizzes; hide/delete benefits & questions) but
-- NOT identity moderation — ban, admin_user_list, and set_app_config stay
-- is_admin()-only. The sheikh cannot see student emails (admin-only surface).
--
-- Mechanism: a new is_staff_viewer() (= admin OR sheikh) replaces is_admin() in
-- exactly the read/content-moderation gates below. Every recreated function
-- reproduces its CURRENT body verbatim (dashboard from 0076, analytics from
-- 0024, quiz-results from 0017, benefits from 0078) with ONLY the guard widened,
-- then re-asserts 0039 EXECUTE hygiene.
--
-- Append-only — 0001–0080 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- is_staff_viewer — admin OR sheikh. Reads/content moderation only.
-- ---------------------------------------------------------------------------
create or replace function public.is_staff_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'sheikh')
  );
$$;
revoke execute on function public.is_staff_viewer() from public, anon;
grant execute on function public.is_staff_viewer() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_dashboard_stats — 0076 body, guard widened to is_staff_viewer().
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today       date := (now() + interval '3 hours')::date;
  v_month_start timestamptz := date_trunc('month', now() + interval '3 hours') - interval '3 hours';
  v_result      jsonb;
begin
  if not public.is_staff_viewer() then
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
                            where p.role = 'student' and coalesce(u.is_anonymous, false) = false),
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
revoke execute on function public.admin_dashboard_stats() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_progress_analytics — 0024 body, guard widened to is_staff_viewer().
-- ---------------------------------------------------------------------------
create or replace function public.admin_progress_analytics()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_staff_viewer() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

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
  student_started as (
    select distinct sl.section_id, pr.user_id
      from section_lectures sl
      join public.user_lecture_progress pr
        on pr.lecture_id = sl.lecture_id and (pr.completed or pr.position_sec > 0)
  ),
  per_student_completed as (
    select pr.user_id, count(*) as completed
      from public.user_lecture_progress pr
      join public.lectures l on l.id = pr.lecture_id and l.status = 'published'
     where pr.completed
     group by pr.user_id
  ),
  full_section_students as (
    select distinct c.user_id
      from student_section_counts c
      join section_totals t on t.section_id = c.section_id
     where t.total >= 1 and c.done >= t.total
  ),
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
revoke execute on function public.admin_progress_analytics() from public, anon;
grant execute on function public.admin_progress_analytics() to authenticated;

-- ---------------------------------------------------------------------------
-- Quiz CRUD RLS (quizzes / quiz_questions / quiz_options): widen the admin
-- write policies to is_staff_viewer() so the sheikh has quiz parity. The
-- quizzes SELECT (drafts) also widens; students still see published only.
-- ---------------------------------------------------------------------------
drop policy if exists quizzes_select on public.quizzes;
create policy quizzes_select on public.quizzes
  for select to authenticated
  using (status = 'published' or public.is_staff_viewer());

drop policy if exists quizzes_admin_write on public.quizzes;
create policy quizzes_admin_write on public.quizzes
  for all to authenticated
  using (public.is_staff_viewer()) with check (public.is_staff_viewer());

drop policy if exists quiz_questions_admin_all on public.quiz_questions;
create policy quiz_questions_admin_all on public.quiz_questions
  for all to authenticated
  using (public.is_staff_viewer()) with check (public.is_staff_viewer());

drop policy if exists quiz_options_admin_all on public.quiz_options;
create policy quiz_options_admin_all on public.quiz_options
  for all to authenticated
  using (public.is_staff_viewer()) with check (public.is_staff_viewer());

-- quiz_attempts / answers SELECT: let staff viewers read attempts (needed by
-- the results screens; drill-down goes through the DEFINER RPCs below).
drop policy if exists quiz_attempts_select on public.quiz_attempts;
create policy quiz_attempts_select on public.quiz_attempts
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff_viewer());

drop policy if exists quiz_attempt_answers_select on public.quiz_attempt_answers;
create policy quiz_attempt_answers_select on public.quiz_attempt_answers
  for select to authenticated
  using (exists (
    select 1 from public.quiz_attempts a
     where a.id = quiz_attempt_answers.attempt_id
       and (a.user_id = auth.uid() or public.is_staff_viewer())
  ));

-- ---------------------------------------------------------------------------
-- Quiz results RPCs — 0017 bodies, guard widened to is_staff_viewer(). Only
-- the guard line changes; bodies are reproduced verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.get_quiz_results_summary(p_quiz_id uuid)
returns table (
  entered          integer,
  passed_count     integer,
  failed_count     integer,
  incomplete_count integer,
  not_taken        integer,
  avg_score        numeric,
  max_score        integer,
  min_score        integer
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_section uuid;
begin
  if not public.is_staff_viewer() then
    raise exception 'غير مصرح';
  end if;
  select z.section_id into v_section from public.quizzes z where z.id = p_quiz_id;
  if v_section is null then
    raise exception 'الاختبار غير موجود';
  end if;

  return query
  with per_user as (
    select a.user_id,
           bool_or(coalesce(a.passed, false))                     as any_pass,
           bool_or(a.submitted_at is not null)                    as any_submitted,
           max(a.score) filter (where a.submitted_at is not null) as best
      from public.quiz_attempts a
     where a.quiz_id = p_quiz_id
     group by a.user_id
  )
  select
    (select count(*) from per_user)::int,
    (select count(*) from per_user where any_pass)::int,
    (select count(*) from per_user where any_submitted and not any_pass)::int,
    (select count(*) from per_user where not any_submitted)::int,
    (select count(*) from public.followers_of_section(v_section) f
      where not exists (select 1 from per_user u where u.user_id = f.user_id))::int,
    (select round(avg(best), 1) from per_user where best is not null),
    (select max(best) from per_user)::int,
    (select min(best) from per_user)::int;
end;
$$;
revoke execute on function public.get_quiz_results_summary(uuid) from public, anon;
grant execute on function public.get_quiz_results_summary(uuid) to authenticated;

create or replace function public.list_quiz_result_rows(p_quiz_id uuid)
returns table (
  user_id         uuid,
  display_name    text,
  status          text,
  best_score      integer,
  attempts_used   integer,
  last_attempt_at timestamptz,
  last_attempt_id uuid
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_max integer;
begin
  if not public.is_staff_viewer() then
    raise exception 'غير مصرح';
  end if;
  select z.max_attempts into v_max from public.quizzes z where z.id = p_quiz_id;

  return query
  select
    a.user_id,
    coalesce(p.display_name, 'طالب علم'),
    case
      when bool_or(coalesce(a.passed, false)) then 'passed'
      when not bool_or(a.submitted_at is not null) then 'incomplete'
      when v_max is not null
           and count(*) filter (where a.submitted_at is not null) >= v_max
        then 'exhausted'
      else 'failed'
    end,
    max(a.score) filter (where a.submitted_at is not null),
    (count(*) filter (where a.submitted_at is not null))::int,
    max(coalesce(a.submitted_at, a.started_at)),
    (array_agg(a.id order by coalesce(a.submitted_at, a.started_at) desc))[1]
  from public.quiz_attempts a
  left join public.profiles p on p.id = a.user_id
  where a.quiz_id = p_quiz_id
  group by a.user_id, p.display_name
  order by max(coalesce(a.submitted_at, a.started_at)) desc;
end;
$$;
revoke execute on function public.list_quiz_result_rows(uuid) from public, anon;
grant execute on function public.list_quiz_result_rows(uuid) to authenticated;

-- get_attempt_detail — 0017 body verbatim, guard widened to is_staff_viewer().
create or replace function public.get_attempt_detail(p_attempt_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a         public.quiz_attempts%rowtype;
  z         public.quizzes%rowtype;
  v_name    text;
  v_total   integer;
  v_answers jsonb;
  v_others  jsonb;
begin
  if not public.is_staff_viewer() then
    raise exception 'غير مصرح';
  end if;
  select * into a from public.quiz_attempts where id = p_attempt_id;
  if not found then
    raise exception 'المحاولة غير موجودة';
  end if;
  select * into z from public.quizzes where id = a.quiz_id;
  select coalesce(p.display_name, 'طالب علم') into v_name
    from public.profiles p where p.id = a.user_id;
  select coalesce(sum(points), 0) into v_total
    from public.quiz_questions where quiz_id = z.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'questionId',         q.id,
           'text',               q.text,
           'points',             q.points,
           'selectedOptionText', so.text,
           'correctOptionText',  co.text,
           'isCorrect',          coalesce(so.is_correct, false)
         ) order by q."order", q.id), '[]'::jsonb)
    into v_answers
    from public.quiz_questions q
    left join public.quiz_attempt_answers ans
      on ans.attempt_id = a.id and ans.question_id = q.id
    left join public.quiz_options so on so.id = ans.option_id
    left join lateral (
      select o.text from public.quiz_options o
       where o.question_id = q.id and o.is_correct
       order by o."order" limit 1
    ) co on true
   where q.quiz_id = z.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'attemptId',   pa.id,
           'attemptNo',   pa.attempt_no,
           'score',       pa.score,
           'passed',      pa.passed,
           'submittedAt', pa.submitted_at
         ) order by pa.attempt_no), '[]'::jsonb)
    into v_others
    from public.quiz_attempts pa
   where pa.quiz_id = z.id and pa.user_id = a.user_id and pa.id <> a.id;

  return jsonb_build_object(
    'attemptId',   a.id,
    'quizId',      z.id,
    'quizTitle',   z.title,
    'displayName', v_name,
    'attemptNo',   a.attempt_no,
    'startedAt',   a.started_at,
    'submittedAt', a.submitted_at,
    'durationSec', case when a.submitted_at is null then null
      else floor(extract(epoch from (a.submitted_at - a.started_at)))::int end,
    'score',       a.score,
    'passed',      a.passed,
    'totalScore',  v_total,
    'passScore',   z.pass_score,
    'answers',     v_answers,
    'otherAttempts', v_others
  );
end;
$$;
revoke execute on function public.get_attempt_detail(uuid) from public, anon;
grant execute on function public.get_attempt_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Benefits moderation — widen to is_staff_viewer() for parity on مشاركات
-- الدارسين. admin_list_benefits reproduces the 0078 body (incl. section_title)
-- with the guard widened; the author EMAIL column is nulled for a non-admin
-- staff viewer (the sheikh sees the name, never the email/identity). The
-- select/delete RLS also widens so the sheikh can hard-delete a benefit.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_benefits(uuid);

create or replace function public.admin_list_benefits(p_lecture_id uuid default null)
returns table (
  id            uuid,
  lecture_id    uuid,
  lecture_title text,
  section_title text,
  body          text,
  status        text,
  author_id     uuid,
  author_name   text,
  author_email  text,
  created_at    timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff_viewer() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    b.id, b.lecture_id, l.title, s.title, b.body, b.status,
    b.user_id,
    coalesce(p.display_name, 'طالب علم'),
    -- Identity (email) is an admin-only surface — a sheikh sees the name only.
    case when public.is_admin() then u.email::text else null end,
    b.created_at
  from public.lecture_benefits b
  join public.lectures l on l.id = b.lecture_id
  left join public.sections s on s.id = l.section_id
  left join public.profiles p on p.id = b.user_id
  left join auth.users u on u.id = b.user_id
  where (p_lecture_id is null or b.lecture_id = p_lecture_id)
  order by b.created_at desc
  limit 500;
end;
$$;
revoke execute on function public.admin_list_benefits(uuid) from public, anon;
grant execute on function public.admin_list_benefits(uuid) to authenticated;

create or replace function public.admin_set_benefit_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff_viewer() then
    raise exception 'غير مصرح';
  end if;
  if p_status not in ('visible', 'hidden') then
    raise exception 'حالة غير صالحة';
  end if;
  update public.lecture_benefits set status = p_status where id = p_id;
end;
$$;
revoke execute on function public.admin_set_benefit_status(uuid, text) from public, anon;
grant execute on function public.admin_set_benefit_status(uuid, text) to authenticated;

-- lecture_benefits SELECT/DELETE RLS: staff viewers (not just admin) may read
-- all rows (for moderation) and hard-delete. INSERT stays own-only.
drop policy if exists lecture_benefits_select_own_or_admin on public.lecture_benefits;
create policy lecture_benefits_select_own_or_admin on public.lecture_benefits
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff_viewer());

drop policy if exists lecture_benefits_delete_own_or_admin on public.lecture_benefits;
create policy lecture_benefits_delete_own_or_admin on public.lecture_benefits
  for delete to authenticated
  using (user_id = auth.uid() or public.is_staff_viewer());
