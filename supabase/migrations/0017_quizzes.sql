-- =============================================================================
-- 0017_quizzes.sql
-- المَحجّة البَيْضَاء — Feature 12: الاختبارات (section quizzes, MCQ v1)
--
-- A quiz hangs off a SECTION node (رئيسي or عنصر داخلي), never a lecture.
-- Admin CRUD is direct table access via is_admin() RLS (0002 attachments
-- pattern). The student side INVERTS that pattern — the central design
-- decision of this feature:
--
--   * quiz_options.is_correct must NEVER reach a student client, so students
--     get NO direct SELECT on quiz_questions / quiz_options. Every student
--     read/solve/submit goes through the SECURITY DEFINER RPCs below (0015
--     buddy pattern) which strip the answer key and grade server-side.
--   * quizzes rows are content-free (title/thresholds), so students may read
--     published rows directly; questions/options only via get_attempt_questions.
--   * Attempt rows are own-rows readable (0001 user_lecture_progress pattern)
--     but writable ONLY through the RPCs — no student insert/update policies.
--
-- Confirmed semantics: single-correct MCQ; total score is always derived
-- sum(points) (never stored, can't drift); pass_score is absolute points;
-- best score drives status and a pass is sticky; time limit = client countdown
-- + server clamp (saves refused after deadline + 30s grace, submit grades only
-- what was saved in time); guests (anonymous sessions) see intros but must
-- register before starting an attempt.
--
-- Append-only migration — 0001–0016 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.quizzes (
  id                    uuid primary key default gen_random_uuid(),
  section_id            uuid not null references public.sections (id) on delete cascade,
  title                 text not null,
  description           text,
  pass_score            integer not null default 0,    -- درجة النجاح (absolute points)
  time_limit_sec        integer,                       -- null = no limit
  max_attempts          integer,                       -- null = unlimited
  show_result           boolean not null default true, -- إظهار النتيجة بعد التسليم
  show_correct_answers  boolean not null default false,-- إظهار الإجابات الصحيحة
  status                text not null default 'draft'
                          check (status in ('draft', 'published')),
  "order"               integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id       uuid primary key default gen_random_uuid(),
  quiz_id  uuid not null references public.quizzes (id) on delete cascade,
  text     text not null,
  points   integer not null default 1,
  "order"  integer not null default 0
);

create table if not exists public.quiz_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.quiz_questions (id) on delete cascade,
  text         text not null,
  is_correct   boolean not null default false,  -- server-side only, never sent to students
  "order"      integer not null default 0
);

-- One row per (user, quiz, attempt_no). submitted_at null = in progress.
create table if not exists public.quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  attempt_no   integer not null default 1,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  score        integer,
  passed       boolean,
  unique (user_id, quiz_id, attempt_no)
);

create table if not exists public.quiz_attempt_answers (
  attempt_id   uuid not null references public.quiz_attempts (id) on delete cascade,
  question_id  uuid not null references public.quiz_questions (id) on delete cascade,
  option_id    uuid not null references public.quiz_options (id) on delete cascade,
  primary key (attempt_id, question_id)   -- MCQ single answer per question
);

create index if not exists quizzes_section_idx
  on public.quizzes (section_id, "order");
create index if not exists quiz_questions_quiz_idx
  on public.quiz_questions (quiz_id, "order");
create index if not exists quiz_options_question_idx
  on public.quiz_options (question_id, "order");
create index if not exists quiz_attempts_quiz_user_idx
  on public.quiz_attempts (quiz_id, user_id);
create index if not exists quiz_attempts_user_idx
  on public.quiz_attempts (user_id);

drop trigger if exists quizzes_set_updated_at on public.quizzes;
create trigger quizzes_set_updated_at
  before update on public.quizzes
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.quizzes             enable row level security;
alter table public.quiz_questions      enable row level security;
alter table public.quiz_options       enable row level security;
alter table public.quiz_attempts      enable row level security;
alter table public.quiz_attempt_answers enable row level security;

-- quizzes: content-free columns → students may read published rows directly
-- (section card + intro). Admin sees drafts too.
drop policy if exists quizzes_select on public.quizzes;
create policy quizzes_select on public.quizzes
  for select to authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists quizzes_admin_write on public.quizzes;
create policy quizzes_admin_write on public.quizzes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- quiz_questions / quiz_options: ADMIN ONLY — a student SELECT on options
-- would leak is_correct. Students get these exclusively through the DEFINER
-- RPCs below (the inverse of the attachments read policy).
drop policy if exists quiz_questions_admin_all on public.quiz_questions;
create policy quiz_questions_admin_all on public.quiz_questions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists quiz_options_admin_all on public.quiz_options;
create policy quiz_options_admin_all on public.quiz_options
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- quiz_attempts / answers: own rows readable (+ admin). No student write
-- policies — attempts are created/updated only via the DEFINER RPCs.
drop policy if exists quiz_attempts_select on public.quiz_attempts;
create policy quiz_attempts_select on public.quiz_attempts
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists quiz_attempt_answers_select on public.quiz_attempt_answers;
create policy quiz_attempt_answers_select on public.quiz_attempt_answers
  for select to authenticated
  using (exists (
    select 1 from public.quiz_attempts a
     where a.id = quiz_attempt_answers.attempt_id
       and (a.user_id = auth.uid() or public.is_admin())
  ));

grant select, insert, update, delete on public.quizzes        to authenticated;
grant select, insert, update, delete on public.quiz_questions to authenticated;
grant select, insert, update, delete on public.quiz_options   to authenticated;
grant select on public.quiz_attempts        to authenticated;
grant select on public.quiz_attempt_answers to authenticated;

-- =============================================================================
-- Student RPCs — all SECURITY DEFINER, answer key stripped
-- =============================================================================

-- Published quizzes of one section node, each with derived totals and the
-- caller's personal status (best score drives status; a pass is sticky).
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
  last_result_attempt_id uuid
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
    st.last_id
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

-- Pre-quiz intro (§12.2): summary + the caller's status. Published only.
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
  last_result_attempt_id uuid
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
    st.last_id
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

-- Start (or resume) an attempt. Registration gate + max_attempts enforced
-- HERE, server-side — an in-progress attempt is always reused, never duplicated.
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

  select a.id into v_existing from public.quiz_attempts a
   where a.quiz_id = p_quiz_id and a.user_id = v_me and a.submitted_at is null
   order by a.started_at desc limit 1;
  if v_existing is not null then
    return v_existing;
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

-- The solver payload: questions + options WITHOUT is_correct, plus any answer
-- already saved (resume). remaining_sec computed on the server clock so a
-- client clock change can't stretch the countdown. Own attempt only.
create or replace function public.get_attempt_questions(p_attempt_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a           public.quiz_attempts%rowtype;
  z           public.quizzes%rowtype;
  v_questions jsonb;
begin
  select * into a from public.quiz_attempts
   where id = p_attempt_id and user_id = auth.uid();
  if not found then
    raise exception 'المحاولة غير موجودة';
  end if;
  select * into z from public.quizzes where id = a.quiz_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               q.id,
           'text',             q.text,
           'points',           q.points,
           'order',            q."order",
           'selectedOptionId', ans.option_id,
           'options',          opts.arr
         ) order by q."order", q.id), '[]'::jsonb)
    into v_questions
    from public.quiz_questions q
    left join public.quiz_attempt_answers ans
      on ans.attempt_id = a.id and ans.question_id = q.id
    join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'text', o.text, 'order', o."order")
             order by o."order", o.id), '[]'::jsonb) as arr
        from public.quiz_options o where o.question_id = q.id
    ) opts on true
   where q.quiz_id = z.id;

  return jsonb_build_object(
    'attemptId',    a.id,
    'quizId',       z.id,
    'quizTitle',    z.title,
    'timeLimitSec', z.time_limit_sec,
    'startedAt',    a.started_at,
    'submittedAt',  a.submitted_at,
    'remainingSec', case when z.time_limit_sec is null then null
      else greatest(0, z.time_limit_sec
             - floor(extract(epoch from (now() - a.started_at))))::int end,
    'questions',    v_questions
  );
end;
$$;
grant execute on function public.get_attempt_questions(uuid) to authenticated;

-- Save one answer (upsert). Own, still-in-progress attempt only; refused after
-- the deadline + 30s grace — the server clamp that makes a tampered client
-- countdown useless.
create or replace function public.save_quiz_answer(
  p_attempt_id  uuid,
  p_question_id uuid,
  p_option_id   uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a record;
begin
  select at.id, at.quiz_id, at.started_at, at.submitted_at, z.time_limit_sec
    into a
    from public.quiz_attempts at
    join public.quizzes z on z.id = at.quiz_id
   where at.id = p_attempt_id and at.user_id = auth.uid();
  if not found then
    raise exception 'المحاولة غير موجودة';
  end if;
  if a.submitted_at is not null then
    raise exception 'تم تسليم هذه المحاولة';
  end if;
  if a.time_limit_sec is not null
     and now() > a.started_at + make_interval(secs => a.time_limit_sec + 30) then
    raise exception 'انتهى وقت الاختبار';
  end if;

  if not exists (
    select 1 from public.quiz_options o
      join public.quiz_questions q on q.id = o.question_id
     where o.id = p_option_id and q.id = p_question_id and q.quiz_id = a.quiz_id
  ) then
    raise exception 'إجابة غير صالحة';
  end if;

  insert into public.quiz_attempt_answers (attempt_id, question_id, option_id)
  values (p_attempt_id, p_question_id, p_option_id)
  on conflict (attempt_id, question_id) do update set option_id = excluded.option_id;
end;
$$;
grant execute on function public.save_quiz_answer(uuid, uuid, uuid) to authenticated;

-- Internal result builder shared by submit/get_attempt_result. Honors
-- show_result / show_correct_answers (nulls out what the admin hid). NOT for
-- client use — callers must verify ownership first.
create or replace function public.quiz_result_payload(p_attempt_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a               public.quiz_attempts%rowtype;
  z               public.quizzes%rowtype;
  v_total         integer;
  v_qcount        integer;
  v_correct       integer;
  v_used          integer;
  v_details       jsonb := null;
  v_attempts_left integer;
begin
  select * into a from public.quiz_attempts where id = p_attempt_id;
  select * into z from public.quizzes where id = a.quiz_id;

  select coalesce(sum(points), 0), count(*)
    into v_total, v_qcount
    from public.quiz_questions where quiz_id = z.id;

  select count(*) into v_correct
    from public.quiz_attempt_answers ans
    join public.quiz_options o on o.id = ans.option_id and o.is_correct
   where ans.attempt_id = a.id;

  select count(*) filter (where submitted_at is not null)
    into v_used
    from public.quiz_attempts
   where quiz_id = z.id and user_id = a.user_id;
  v_attempts_left := case when z.max_attempts is null then null
                          else greatest(z.max_attempts - v_used, 0) end;

  if z.show_correct_answers then
    select coalesce(jsonb_agg(jsonb_build_object(
             'questionId',         q.id,
             'text',               q.text,
             'points',             q.points,
             'selectedOptionId',   ans.option_id,
             'selectedOptionText', so.text,
             'correctOptionId',    co.id,
             'correctOptionText',  co.text,
             'isCorrect',          coalesce(so.is_correct, false)
           ) order by q."order", q.id), '[]'::jsonb)
      into v_details
      from public.quiz_questions q
      left join public.quiz_attempt_answers ans
        on ans.attempt_id = a.id and ans.question_id = q.id
      left join public.quiz_options so on so.id = ans.option_id
      left join lateral (
        select o.id, o.text from public.quiz_options o
         where o.question_id = q.id and o.is_correct
         order by o."order" limit 1
      ) co on true
     where q.quiz_id = z.id;
  end if;

  return jsonb_build_object(
    'attemptId',          a.id,
    'quizId',             z.id,
    'quizTitle',          z.title,
    'submittedAt',        a.submitted_at,
    'showResult',         z.show_result,
    'showCorrectAnswers', z.show_correct_answers,
    'attemptsLeft',       v_attempts_left,
    'canRetry',           (z.max_attempts is null or v_used < z.max_attempts)
                            and not coalesce(a.passed, false),
    'questionCount',      v_qcount,
    'score',              case when z.show_result then a.score end,
    'passed',             case when z.show_result then a.passed end,
    'totalScore',         case when z.show_result then v_total end,
    'passScore',          case when z.show_result then z.pass_score end,
    'correctCount',       case when z.show_result then v_correct end,
    'wrongCount',         case when z.show_result then v_qcount - v_correct end,
    'details',            v_details
  );
end;
$$;
revoke all on function public.quiz_result_payload(uuid) from public, anon, authenticated;

-- Grade server-side and finalize. Idempotent — a second submit (double-tap,
-- retry after timeout) just returns the stored result. Late saves were already
-- refused by save_quiz_answer, so only in-time answers can score.
create or replace function public.submit_quiz_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a       public.quiz_attempts%rowtype;
  z       public.quizzes%rowtype;
  v_score integer;
begin
  select * into a from public.quiz_attempts
   where id = p_attempt_id and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'المحاولة غير موجودة';
  end if;
  if a.submitted_at is not null then
    return public.quiz_result_payload(a.id);
  end if;
  select * into z from public.quizzes where id = a.quiz_id;

  select coalesce(sum(q.points), 0) into v_score
    from public.quiz_attempt_answers ans
    join public.quiz_options o on o.id = ans.option_id and o.is_correct
    join public.quiz_questions q on q.id = ans.question_id
   where ans.attempt_id = a.id;

  update public.quiz_attempts
     set submitted_at = now(),
         score        = v_score,
         passed       = (v_score >= z.pass_score)
   where id = a.id;

  return public.quiz_result_payload(a.id);
end;
$$;
grant execute on function public.submit_quiz_attempt(uuid) to authenticated;

-- Re-open the result of an own, already-submitted attempt.
create or replace function public.get_attempt_result(p_attempt_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a public.quiz_attempts%rowtype;
begin
  select * into a from public.quiz_attempts
   where id = p_attempt_id and user_id = auth.uid();
  if not found then
    raise exception 'المحاولة غير موجودة';
  end if;
  if a.submitted_at is null then
    raise exception 'لم يتم تسليم هذه المحاولة بعد';
  end if;
  return public.quiz_result_payload(a.id);
end;
$$;
grant execute on function public.get_attempt_result(uuid) to authenticated;

-- Quiet Journey line (§12.4): how many published quizzes I attempted / passed.
create or replace function public.get_my_quiz_stats()
returns table (attempted integer, passed integer)
language sql stable security definer set search_path = public as $$
  select
    count(distinct a.quiz_id) filter (where a.submitted_at is not null)::int,
    count(distinct a.quiz_id) filter (where a.passed)::int
    from public.quiz_attempts a
    join public.quizzes z on z.id = a.quiz_id and z.status = 'published'
   where a.user_id = auth.uid();
$$;
grant execute on function public.get_my_quiz_stats() to authenticated;

-- =============================================================================
-- Admin results RPCs — SECURITY DEFINER + is_admin() guard (§12.5)
-- =============================================================================

-- Summary tiles. not_taken = followers of the quiz's section subtree (0006
-- followers_of_section — a follow on an ancestor implies the subtree) minus
-- everyone who has an attempt. avg/max/min are over each student's BEST score.
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
  if not public.is_admin() then
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
grant execute on function public.get_quiz_results_summary(uuid) to authenticated;

-- Per-student rows: اجتاز / لم يجتز / لم يكمل / استنفد, best score, attempts,
-- last activity + the attempt id to drill into.
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
  if not public.is_admin() then
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
grant execute on function public.list_quiz_result_rows(uuid) to authenticated;

-- Drill-down: one student's attempt with per-question right/wrong, completion
-- time and the student's other attempts. Admin-only — students never see each
-- other's results (§12.6).
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
  if not public.is_admin() then
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
grant execute on function public.get_attempt_detail(uuid) to authenticated;
