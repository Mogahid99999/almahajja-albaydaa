-- =============================================================================
-- 0118_quiz_availability.sql
-- المَحجّة البَيْضَاء — Test Availability Control (اختبارات: التحكّم في التوفّر)
--
-- An admin / sheikh (mentor) / publisher gains full control over WHEN a
-- published quiz is available to students, INDEPENDENTLY of the draft/published
-- content status. Three admin-set modes drive one derived effective state:
--
--   availability_mode:
--     'open'      → always available (the historic behaviour; default)
--     'closed'    → manually shut, unavailable regardless of dates
--     'scheduled' → driven by [available_from, available_until] window
--
--   Derived effective availability (quiz_availability()):
--     'open'      → students may start
--     'closed'    → مغلق يدويًا
--     'scheduled' → window set, before available_from (لم يبدأ بعد)
--     'expired'   → window set, after available_until (انتهت المدة)
--
-- Editing the timestamps re-derives the state on every read, so extending /
-- shortening a running window (or a manual open/close) takes effect IMMEDIATELY
-- with no recreate — this is the whole point of deriving rather than storing.
--
-- Availability gates ONLY the *start* of a NEW attempt. An attempt a student
-- already began keeps running and can be submitted under its own time-limit
-- policy (owner decision: «any attempt started before closing continues») —
-- save_quiz_answer / submit_quiz_attempt are deliberately NOT touched here.
-- It never affects stored scores or past attempts.
--
-- Roles: quiz WRITE was is_staff_viewer() (admin OR sheikh) since 0081, which
-- had silently dropped the publisher's 0023 quiz access. This restores it via
-- is_quiz_manager() = admin OR sheikh OR publisher, so all three roles can set
-- availability.
--
-- Append-only migration. Idempotent (drop-if-exists / add-column-if-not-exists).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.quizzes
  add column if not exists availability_mode text not null default 'open',
  add column if not exists available_from  timestamptz,
  add column if not exists available_until timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quizzes_availability_mode_chk'
  ) then
    alter table public.quizzes
      add constraint quizzes_availability_mode_chk
      check (availability_mode in ('open', 'closed', 'scheduled'));
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- is_quiz_manager — admin OR sheikh (mentor) OR publisher.
-- The single guard for all quiz content + availability writes.
-- ---------------------------------------------------------------------------
create or replace function public.is_quiz_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'sheikh', 'publisher')
  );
$$;
revoke execute on function public.is_quiz_manager() from public, anon;
grant execute on function public.is_quiz_manager() to authenticated;

-- Repoint the quizzes SELECT + write policies (last set by 0081 to
-- published-or-staff = admin/sheikh) so a publisher regains draft visibility
-- AND write access alongside admin + sheikh. 0081 had silently narrowed both
-- from 0023's is_content_manager, dropping the publisher; this restores all
-- three roles for quizzes specifically.
drop policy if exists quizzes_select on public.quizzes;
create policy quizzes_select on public.quizzes
  for select to authenticated
  using (status = 'published' or public.is_quiz_manager());

drop policy if exists quizzes_admin_write on public.quizzes;
create policy quizzes_admin_write on public.quizzes
  for all to authenticated
  using (public.is_quiz_manager()) with check (public.is_quiz_manager());

-- ---------------------------------------------------------------------------
-- quiz_availability — the single source of truth for effective state.
-- Immutable-ish pure function over (mode, from, until, now()).
-- ---------------------------------------------------------------------------
create or replace function public.quiz_availability(
  p_mode  text,
  p_from  timestamptz,
  p_until timestamptz
)
returns text language sql stable set search_path = public as $$
  select case
    when p_mode = 'closed' then 'closed'
    when p_mode = 'open'   then 'open'
    -- scheduled: a missing bound is treated as open on that side.
    when p_from  is not null and now() < p_from  then 'scheduled'
    when p_until is not null and now() > p_until then 'expired'
    else 'open'
  end;
$$;
grant execute on function public.quiz_availability(text, timestamptz, timestamptz) to authenticated;

-- =============================================================================
-- Student RPCs — re-declared to surface availability + gate the start.
-- Bodies are the 0017 originals with the availability columns added.
-- =============================================================================

-- The two status RPCs gain OUT columns, so a plain CREATE OR REPLACE is refused
-- ("cannot change return type"). Drop them first (dependents — get_section_page
-- — are recreated below in this same migration, so the cascade is safe).
drop function if exists public.get_section_quizzes(uuid) cascade;
drop function if exists public.get_quiz_intro(uuid) cascade;

-- get_section_quizzes (0017 body + availability fields).
create or replace function public.get_section_quizzes(p_section_id uuid)
returns table (
  id                     uuid,
  title                  text,
  description            text,
  pass_score             integer,
  time_limit_sec         integer,
  max_attempts           integer,
  sort_order             integer,
  question_count         integer,
  total_score            integer,
  attempts_used          integer,
  attempts_left          integer,
  best_score             integer,
  passed                 boolean,
  in_progress_attempt_id uuid,
  last_result_attempt_id uuid,
  availability           text,
  available_from         timestamptz,
  available_until        timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    z.id, z.title, z.description, z.pass_score, z.time_limit_sec, z.max_attempts,
    z."order",
    coalesce(qc.cnt, 0),
    coalesce(qc.total, 0),
    coalesce(st.used, 0),
    case when z.max_attempts is null then null
         else greatest(z.max_attempts - coalesce(st.used, 0), 0) end,
    st.best,
    coalesce(st.passed, false),
    ip.id,
    st.last_id,
    public.quiz_availability(z.availability_mode, z.available_from, z.available_until),
    z.available_from,
    z.available_until
  from public.quizzes z
  left join lateral (
    select count(*)::int as cnt, coalesce(sum(q.points), 0)::int as total
      from public.quiz_questions q where q.quiz_id = z.id
  ) qc on true
  left join lateral (
    select count(*) filter (where a.submitted_at is not null)::int as used,
           max(a.score) filter (where a.submitted_at is not null)  as best,
           bool_or(a.passed)                                       as passed,
           (array_agg(a.id order by a.submitted_at desc)
              filter (where a.submitted_at is not null))[1]        as last_id
      from public.quiz_attempts a
     where a.quiz_id = z.id and a.user_id = auth.uid()
  ) st on true
  left join lateral (
    select a.id from public.quiz_attempts a
     where a.quiz_id = z.id and a.user_id = auth.uid() and a.submitted_at is null
     order by a.started_at desc limit 1
  ) ip on true
  where z.section_id = p_section_id and z.status = 'published'
  order by z."order", z.created_at;
$$;
grant execute on function public.get_section_quizzes(uuid) to authenticated;

-- get_quiz_intro (0017 body + availability fields).
create or replace function public.get_quiz_intro(p_quiz_id uuid)
returns table (
  id                     uuid,
  title                  text,
  description            text,
  section_id             uuid,
  section_title          text,
  question_count         integer,
  total_score            integer,
  pass_score             integer,
  time_limit_sec         integer,
  max_attempts           integer,
  attempts_used          integer,
  attempts_left          integer,
  best_score             integer,
  passed                 boolean,
  in_progress_attempt_id uuid,
  last_result_attempt_id uuid,
  availability           text,
  available_from         timestamptz,
  available_until        timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    z.id, z.title, z.description, z.section_id, s.title,
    coalesce(qc.cnt, 0),
    coalesce(qc.total, 0),
    z.pass_score, z.time_limit_sec, z.max_attempts,
    coalesce(st.used, 0),
    case when z.max_attempts is null then null
         else greatest(z.max_attempts - coalesce(st.used, 0), 0) end,
    st.best,
    coalesce(st.passed, false),
    ip.id,
    st.last_id,
    public.quiz_availability(z.availability_mode, z.available_from, z.available_until),
    z.available_from,
    z.available_until
  from public.quizzes z
  join public.sections s on s.id = z.section_id
  left join lateral (
    select count(*)::int as cnt, coalesce(sum(q.points), 0)::int as total
      from public.quiz_questions q where q.quiz_id = z.id
  ) qc on true
  left join lateral (
    select count(*) filter (where a.submitted_at is not null)::int as used,
           max(a.score) filter (where a.submitted_at is not null)  as best,
           bool_or(a.passed)                                       as passed,
           (array_agg(a.id order by a.submitted_at desc)
              filter (where a.submitted_at is not null))[1]        as last_id
      from public.quiz_attempts a
     where a.quiz_id = z.id and a.user_id = auth.uid()
  ) st on true
  left join lateral (
    select a.id from public.quiz_attempts a
     where a.quiz_id = z.id and a.user_id = auth.uid() and a.submitted_at is null
     order by a.started_at desc limit 1
  ) ip on true
  where z.id = p_quiz_id and z.status = 'published';
$$;
grant execute on function public.get_quiz_intro(uuid) to authenticated;

-- start_quiz_attempt (0017 body + availability gate). An already-open in-progress
-- attempt is ALWAYS resumed first — closing never strands a student mid-attempt.
create or replace function public.start_quiz_attempt(p_quiz_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me         uuid := auth.uid();
  v_quiz       public.quizzes%rowtype;
  v_existing   uuid;
  v_used       integer;
  v_attempt_no integer;
  v_id         uuid;
  v_avail      text;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'يلزم إنشاء حساب لأداء الاختبار';
  end if;

  select * into v_quiz from public.quizzes
   where id = p_quiz_id and status = 'published';
  if not found then
    raise exception 'الاختبار غير متاح';
  end if;

  -- Resume an existing in-progress attempt regardless of current availability:
  -- an attempt begun while open must always be completable (owner policy).
  select a.id into v_existing from public.quiz_attempts a
   where a.quiz_id = p_quiz_id and a.user_id = v_me and a.submitted_at is null
   order by a.started_at desc limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Availability gate applies only to STARTING a brand-new attempt.
  v_avail := public.quiz_availability(
    v_quiz.availability_mode, v_quiz.available_from, v_quiz.available_until);
  if v_avail = 'closed' then
    raise exception 'هذا الاختبار غير متاح حاليًا';
  elsif v_avail = 'scheduled' then
    raise exception 'لم يبدأ هذا الاختبار بعد';
  elsif v_avail = 'expired' then
    raise exception 'انتهت مدة هذا الاختبار';
  end if;

  select count(*) filter (where submitted_at is not null),
         coalesce(max(attempt_no), 0) + 1
    into v_used, v_attempt_no
    from public.quiz_attempts
   where quiz_id = p_quiz_id and user_id = v_me;

  if v_quiz.max_attempts is not null and v_used >= v_quiz.max_attempts then
    raise exception 'استنفدت المحاولات المتاحة لهذا الاختبار';
  end if;

  insert into public.quiz_attempts (quiz_id, user_id, attempt_no)
  values (p_quiz_id, v_me, v_attempt_no)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;

-- get_section_page (0045 body verbatim) — the quiz JSON gains the three
-- availability fields so the section-page card pill matches the intro screen.
-- qz already selects * from get_section_quizzes, which now carries them.
create or replace function public.get_section_page(p_section_id uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with sec as (
    select id, title, description, cover_image, cover_letter, show_header, parent_id
      from public.sections
     where id = p_section_id
  ),
  rollup as (
    select total_lectures, completed_lectures, sheikh_names
      from public.get_section_rollup(p_section_id)
  ),
  subs as (
    select id, title, cover_letter, "order"
      from public.sections
     where parent_id = p_section_id
  ),
  sub_rollups as (
    select section_id, total_lectures, completed_lectures
      from public.get_children_rollups(array(select id from subs))
  ),
  lecs as (
    select l.id, l.title, l.duration_sec, l."order" as ord,
           sh.name as sheikh_name,
           coalesce(p.position_sec, 0) as position_sec,
           coalesce(p.completed, false) as completed
      from public.lectures l
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = auth.uid()
     where l.section_id = p_section_id and l.status = 'published'
  ),
  atts as (
    select id, type, title, description, storage_path, external_url, body, "order" as ord
      from public.attachments
     where section_id = p_section_id
  ),
  qz as (
    select * from public.get_section_quizzes(p_section_id)
  )
  select case when not exists (select 1 from sec) then null else
    jsonb_build_object(
      'section', (
        select jsonb_build_object(
          'id', id, 'title', title, 'description', description,
          'cover_image', cover_image, 'cover_letter', cover_letter,
          'show_header', show_header, 'parent_id', parent_id
        ) from sec
      ),
      'parent_title', (
        select p.title from public.sections p
         where p.id = (select parent_id from sec)
      ),
      'rollup', jsonb_build_object(
        'total', coalesce((select total_lectures from rollup), 0),
        'completed', coalesce((select completed_lectures from rollup), 0),
        'sheikh_names', to_jsonb(coalesce((select sheikh_names from rollup), '{}'::text[]))
      ),
      'subsections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id, 'title', s.title, 'cover_letter', s.cover_letter,
            'total', coalesce(r.total_lectures, 0),
            'completed', coalesce(r.completed_lectures, 0)
          ) order by s."order"
        )
        from subs s
        left join sub_rollups r on r.section_id = s.id
      ), '[]'::jsonb),
      'lectures', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'title', title,
            'duration_sec', coalesce(duration_sec, 0),
            'order', ord, 'sheikh_name', sheikh_name,
            'position_sec', position_sec, 'completed', completed
          ) order by ord
        ) from lecs
      ), '[]'::jsonb),
      'attachments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'type', type, 'title', title, 'description', description,
            'storage_path', storage_path, 'external_url', external_url,
            'body', body, 'order', ord
          ) order by ord
        ) from atts
      ), '[]'::jsonb),
      'quizzes', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'title', title, 'description', description,
            'pass_score', pass_score, 'time_limit_sec', time_limit_sec,
            'max_attempts', max_attempts, 'sort_order', sort_order,
            'question_count', question_count, 'total_score', total_score,
            'attempts_used', attempts_used, 'attempts_left', attempts_left,
            'best_score', best_score, 'passed', passed,
            'in_progress_attempt_id', in_progress_attempt_id,
            'last_result_attempt_id', last_result_attempt_id,
            'availability', availability,
            'available_from', available_from,
            'available_until', available_until
          ) order by sort_order
        ) from qz
      ), '[]'::jsonb)
    )
  end;
$$;
revoke all on function public.get_section_page(uuid) from public;
grant execute on function public.get_section_page(uuid) to authenticated;
