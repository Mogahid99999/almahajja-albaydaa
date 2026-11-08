-- =============================================================================
-- 0166_quiz_written_answers_manual_grading.sql
-- المَحجّة البَيْضَاء — الاختبارات: أسئلة «إجابة نصية» + التصحيح اليدوي
--
-- A question is now either «اختيار من متعدد» (kind 'mcq', every existing row —
-- the column default) or «إجابة نصية» (kind 'text': no options, an optional
-- model answer for the grader). One quiz may mix both.
--
--   * MCQ-only quiz: submit → auto-grade → result, EXACTLY as before
--     (grading_status stays NULL on those attempts).
--   * Quiz with ≥ 1 text question: submit auto-grades the MCQ part, keeps the
--     written answers and the attempt becomes grading_status 'pending' with
--     score / passed NULL — no final result exists until a grader
--     (admin · sheikh · publisher = is_quiz_manager()) approves every written
--     score via grade_quiz_attempt(). That RPC enforces 0 ≤ score ≤ points,
--     refuses an incomplete grading, writes score = MCQ + written, passed vs the
--     quiz's own pass_score, graded_by / graded_at, and leaves the student a
--     personal inbox row (type 'quiz_graded' → push via the 0122 trigger) that
--     opens /quiz-result/<attempt>.
--   * While pending the student sees no score, no pass/fail, no model answer
--     (the payload reports showResult = false, so OLD app builds show their calm
--     «تم استلام إجاباتك» instead of a zero score), and cannot start another
--     attempt of that quiz.
--
-- Roles: quiz_questions / quiz_options were is_staff_viewer() (admin + sheikh)
-- since 0081/0152, which silently kept the publisher out of the question editor
-- that 0118 meant to give back; the admin results RPCs had the same gap. Both
-- move to is_quiz_manager() so all three roles can author, read results and grade.
--
-- Existing data is untouched: every new column is nullable or defaults to the
-- historic behaviour; MCQ attempts, scores and results keep their values.
-- Bodies are the live (staging = prod, 2026-11-08) definitions with only the
-- marked changes. Append-only. Idempotent.
-- After applying: node scripts/security-check.mjs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.quiz_questions
  add column if not exists kind         text not null default 'mcq',
  add column if not exists model_answer text;

alter table public.quiz_attempt_answers
  alter column option_id drop not null,
  add column if not exists text_answer    text,
  add column if not exists awarded_points integer,
  add column if not exists grader_note    text;

-- grading_status: NULL = auto-graded (MCQ-only, the historic path);
-- 'pending' = written answers await a grader; 'graded' = approved.
alter table public.quiz_attempts
  add column if not exists grading_status text,
  add column if not exists graded_by      uuid references auth.users (id) on delete set null,
  add column if not exists graded_at      timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quiz_questions_kind_chk') then
    alter table public.quiz_questions
      add constraint quiz_questions_kind_chk check (kind in ('mcq', 'text'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quiz_questions_model_answer_len_chk') then
    alter table public.quiz_questions
      add constraint quiz_questions_model_answer_len_chk
      check (model_answer is null or char_length(model_answer) <= 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quiz_attempt_answers_text_len_chk') then
    alter table public.quiz_attempt_answers
      add constraint quiz_attempt_answers_text_len_chk
      check (text_answer is null or char_length(text_answer) <= 8000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quiz_attempt_answers_note_len_chk') then
    alter table public.quiz_attempt_answers
      add constraint quiz_attempt_answers_note_len_chk
      check (grader_note is null or char_length(grader_note) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quiz_attempt_answers_awarded_chk') then
    alter table public.quiz_attempt_answers
      add constraint quiz_attempt_answers_awarded_chk
      check (awarded_points is null or awarded_points >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quiz_attempts_grading_status_chk') then
    alter table public.quiz_attempts
      add constraint quiz_attempts_grading_status_chk
      check (grading_status is null or grading_status in ('pending', 'graded'));
  end if;
end$$;

-- The «بانتظار التصحيح» queue reads only the pending few.
create index if not exists quiz_attempts_pending_idx
  on public.quiz_attempts (submitted_at) where grading_status = 'pending';
-- FK index (advisor: unindexed_foreign_keys) — almost every row is NULL.
create index if not exists quiz_attempts_graded_by_idx
  on public.quiz_attempts (graded_by) where graded_by is not null;

-- ---------------------------------------------------------------------------
-- 2. Roles — publisher back on questions/options (see header)
-- ---------------------------------------------------------------------------
alter policy "quiz_questions_admin_all" on public.quiz_questions
  using ((select public.is_quiz_manager())) with check ((select public.is_quiz_manager()));
alter policy "quiz_options_admin_all" on public.quiz_options
  using ((select public.is_quiz_manager())) with check ((select public.is_quiz_manager()));

-- ---------------------------------------------------------------------------
-- 3. Notification type — a personal, kept inbox row (not a broadcast push)
-- ---------------------------------------------------------------------------
alter type public.notification_type add value if not exists 'quiz_graded';

-- prune_notifications (0151 body): quiz_graded joins the personal rows that
-- are never pruned.
create or replace function public.prune_notifications()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_notifs int;
  v_outbox int;
  v_cron   int := 0;
begin
  delete from public.notifications
   where type::text not in ('question_answered', 'question_received', 'buddy_request',
                            'buddy_activity', 'feedback_received', 'content_reported', 'live_invite',
                            'quiz_graded')  -- 0166
     and created_at < now() - interval '3 days';
  get diagnostics v_notifs = row_count;

  delete from public.push_outbox where created_at < now() - interval '3 days';
  get diagnostics v_outbox = row_count;

  begin
    delete from cron.job_run_details where end_time < now() - interval '2 days';
    get diagnostics v_cron = row_count;
  exception when others then
    v_cron := -1;
  end;

  return jsonb_build_object('notifications', v_notifs, 'push_outbox', v_outbox, 'cron_log', v_cron);
end;
$$;
revoke all on function public.prune_notifications() from public, anon, authenticated;

-- =============================================================================
-- 4. Student RPCs
-- =============================================================================

-- get_section_quizzes / get_quiz_intro gain `pending_review` (the caller has a
-- submitted attempt awaiting a grader) → OUT columns change → drop first.
-- get_section_page reads get_section_quizzes and is recreated below.
drop function if exists public.get_section_quizzes(uuid) cascade;
drop function if exists public.get_quiz_intro(uuid) cascade;

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
  available_until        timestamptz,
  pending_review         boolean          -- 0166
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
    z.available_until,
    coalesce(st.pending, false)
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
              filter (where a.submitted_at is not null))[1]        as last_id,
           bool_or(a.grading_status = 'pending')                   as pending
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
revoke all on function public.get_section_quizzes(uuid) from public, anon;
grant execute on function public.get_section_quizzes(uuid) to authenticated;

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
  available_until        timestamptz,
  pending_review         boolean          -- 0166
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
    z.available_until,
    coalesce(st.pending, false)
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
              filter (where a.submitted_at is not null))[1]        as last_id,
           bool_or(a.grading_status = 'pending')                   as pending
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
revoke all on function public.get_quiz_intro(uuid) from public, anon;
grant execute on function public.get_quiz_intro(uuid) to authenticated;

-- get_section_page (live 0164 body) — the quiz JSON gains pending_review.
create or replace function public.get_section_page(p_section_id uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with sec as (
    select id, title, description, cover_image, cover_letter, show_header, parent_id,
           series_status  -- 0164
      from public.sections
     where id = p_section_id
  ),
  rollup as (
    select total_lectures, completed_lectures, sheikh_names
      from public.get_section_rollup(p_section_id)
  ),
  subs as (
    select id, title, cover_letter, "order", series_status  -- 0164
      from public.sections
     where parent_id = p_section_id
  ),
  sub_rollups as (
    select section_id, total_lectures, completed_lectures
      from public.get_children_rollups(array(select id from subs))
  ),
  lecs as (
    select l.id, l.title, l.duration_sec, l.audio_size_bytes, l."order" as ord,  -- 0164: size back (0069)
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
          'show_header', show_header, 'parent_id', parent_id,
          'series_status', series_status  -- 0164
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
            'completed', coalesce(r.completed_lectures, 0),
            'series_status', s.series_status  -- 0164
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
            'audio_size_bytes', audio_size_bytes,  -- 0164: size back (0069)
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
            'available_until', available_until,
            'pending_review', pending_review  -- 0166
          ) order by sort_order
        ) from qz
      ), '[]'::jsonb)
    )
  end;
$$;
revoke all on function public.get_section_page(uuid) from public;
grant execute on function public.get_section_page(uuid) to authenticated;

-- start_quiz_attempt (0118 body + 0166 pending gate): while an attempt of this
-- quiz waits for a grader, no new attempt starts (its outcome decides whether
-- one is even needed). An in-progress attempt is still always resumed first.
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

  select a.id into v_existing from public.quiz_attempts a
   where a.quiz_id = p_quiz_id and a.user_id = v_me and a.submitted_at is null
   order by a.started_at desc limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- 0166
  if exists (select 1 from public.quiz_attempts a
              where a.quiz_id = p_quiz_id and a.user_id = v_me
                and a.grading_status = 'pending') then
    raise exception 'محاولتك السابقة بانتظار التصحيح، وستظهر نتيجتها بعد اكتمال التصحيح بإذن الله';
  end if;

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
revoke all on function public.start_quiz_attempt(uuid) from public, anon;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;

-- get_attempt_questions (0017 body): each question carries its `kind` and the
-- saved `textAnswer` (resume). Text questions have no options. The model
-- answer is never sent here.
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
           'kind',             q.kind,          -- 0166
           'selectedOptionId', ans.option_id,
           'textAnswer',       ans.text_answer, -- 0166
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
revoke all on function public.get_attempt_questions(uuid) from public, anon;
grant execute on function public.get_attempt_questions(uuid) to authenticated;

-- save_quiz_text_answer — the written twin of save_quiz_answer (same guards:
-- own, in-progress attempt, deadline + 30 s grace). Empty text clears it.
create or replace function public.save_quiz_text_answer(
  p_attempt_id  uuid,
  p_question_id uuid,
  p_text        text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  a      record;
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
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
    select 1 from public.quiz_questions q
     where q.id = p_question_id and q.quiz_id = a.quiz_id and q.kind = 'text'
  ) then
    raise exception 'إجابة غير صالحة';
  end if;
  if v_text is not null and char_length(v_text) > 8000 then
    raise exception 'الإجابة أطول من المسموح';
  end if;

  if v_text is null then
    delete from public.quiz_attempt_answers
     where attempt_id = p_attempt_id and question_id = p_question_id;
  else
    insert into public.quiz_attempt_answers (attempt_id, question_id, option_id, text_answer)
    values (p_attempt_id, p_question_id, null, v_text)
    on conflict (attempt_id, question_id) do update set text_answer = excluded.text_answer;
  end if;
end;
$$;
revoke all on function public.save_quiz_text_answer(uuid, uuid, text) from public, anon;
grant execute on function public.save_quiz_text_answer(uuid, uuid, text) to authenticated;

-- quiz_result_payload (0017 body + 0166). New keys: gradingStatus, hasWritten.
--  * pending → showResult / showCorrectAnswers false, every score field and
--    details NULL, canRetry false (old builds show «تم استلام إجاباتك»).
--  * correct/wrong counts are over the MCQ questions only (the new app hides
--    them for a quiz with written questions).
--  * details: MCQ rows only when show_correct_answers (as before); written
--    rows of a graded attempt always (answer + grader note; awarded points
--    only with show_result; the model answer only with show_correct_answers).
--    selectedOptionText / correctOptionText mirror the written answer / model
--    answer so an old build still reads them sensibly.
create or replace function public.quiz_result_payload(p_attempt_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a               public.quiz_attempts%rowtype;
  z               public.quizzes%rowtype;
  v_total         integer;
  v_qcount        integer;
  v_mcq_count     integer;
  v_correct       integer;
  v_used          integer;
  v_details       jsonb := null;
  v_attempts_left integer;
  v_has_text      boolean;
  v_pending       boolean;
  v_show_result   boolean;
  v_show_correct  boolean;
begin
  select * into a from public.quiz_attempts where id = p_attempt_id;
  select * into z from public.quizzes where id = a.quiz_id;

  select coalesce(sum(points), 0), count(*),
         count(*) filter (where kind = 'mcq'),
         bool_or(kind = 'text')
    into v_total, v_qcount, v_mcq_count, v_has_text
    from public.quiz_questions where quiz_id = z.id;
  v_has_text := coalesce(v_has_text, false);
  v_pending := a.grading_status = 'pending';
  v_pending := coalesce(v_pending, false);
  v_show_result := z.show_result and not v_pending;
  v_show_correct := z.show_correct_answers and not v_pending;

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

  if not v_pending and (z.show_correct_answers or v_has_text) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'questionId',         q.id,
             'text',               q.text,
             'points',             q.points,
             'kind',               q.kind,
             'selectedOptionId',   ans.option_id,
             'selectedOptionText', case when q.kind = 'text' then ans.text_answer else so.text end,
             'correctOptionId',    co.id,
             'correctOptionText',  case when q.kind = 'text'
                                        then case when z.show_correct_answers then q.model_answer end
                                        else co.text end,
             'isCorrect',          case when q.kind = 'text'
                                        then coalesce(ans.awarded_points, 0) >= q.points
                                        else coalesce(so.is_correct, false) end,
             'textAnswer',         case when q.kind = 'text' then ans.text_answer end,
             'awardedPoints',      case when q.kind = 'text' and z.show_result then ans.awarded_points end,
             'graderNote',         case when q.kind = 'text' then ans.grader_note end,
             'modelAnswer',        case when q.kind = 'text' and z.show_correct_answers
                                        then q.model_answer end
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
     where q.quiz_id = z.id
       and (q.kind = 'text' or z.show_correct_answers);
  end if;

  return jsonb_build_object(
    'attemptId',          a.id,
    'quizId',             z.id,
    'quizTitle',          z.title,
    'submittedAt',        a.submitted_at,
    'showResult',         v_show_result,
    'showCorrectAnswers', v_show_correct,
    'attemptsLeft',       v_attempts_left,
    'canRetry',           (z.max_attempts is null or v_used < z.max_attempts)
                            and not coalesce(a.passed, false)
                            and not v_pending,
    'questionCount',      v_qcount,
    'score',              case when v_show_result then a.score end,
    'passed',             case when v_show_result then a.passed end,
    'totalScore',         case when v_show_result then v_total end,
    'passScore',          case when v_show_result then z.pass_score end,
    'correctCount',       case when v_show_result then v_correct end,
    'wrongCount',         case when v_show_result then v_mcq_count - v_correct end,
    'details',            v_details,
    'gradingStatus',      a.grading_status,
    'hasWritten',         v_has_text
  );
end;
$$;
revoke all on function public.quiz_result_payload(uuid) from public, anon, authenticated;

-- submit_quiz_attempt (0017 body + 0166): a quiz with written questions is not
-- finalized here — the MCQ part is graded later together with the written
-- scores, the attempt waits as 'pending'. MCQ-only quizzes are unchanged.
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

  if exists (select 1 from public.quiz_questions q
              where q.quiz_id = z.id and q.kind = 'text') then
    update public.quiz_attempts
       set submitted_at   = now(),
           score          = null,
           passed         = null,
           grading_status = 'pending'
     where id = a.id;
    return public.quiz_result_payload(a.id);
  end if;

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
revoke all on function public.submit_quiz_attempt(uuid) from public, anon;
grant execute on function public.submit_quiz_attempt(uuid) to authenticated;

-- =============================================================================
-- 5. Admin / grader RPCs — is_quiz_manager() (admin · sheikh · publisher)
-- =============================================================================

drop function if exists public.get_quiz_results_summary(uuid);
create or replace function public.get_quiz_results_summary(p_quiz_id uuid)
returns table (
  entered          integer,
  passed_count     integer,
  failed_count     integer,
  incomplete_count integer,
  not_taken        integer,
  avg_score        numeric,
  max_score        integer,
  min_score        integer,
  pending_count    integer          -- 0166
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_section uuid;
begin
  if not public.is_quiz_manager() then
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
           bool_or(a.grading_status = 'pending')                  as any_pending,
           max(a.score) filter (where a.submitted_at is not null) as best
      from public.quiz_attempts a
     where a.quiz_id = p_quiz_id
     group by a.user_id
  )
  select
    (select count(*) from per_user)::int,
    (select count(*) from per_user where any_pass)::int,
    (select count(*) from per_user where any_submitted and not any_pass
                                    and not coalesce(any_pending, false))::int,
    (select count(*) from per_user where not any_submitted)::int,
    (select count(*) from public.followers_of_section(v_section) f
      where not exists (select 1 from per_user u where u.user_id = f.user_id))::int,
    (select round(avg(best), 1) from per_user where best is not null),
    (select max(best) from per_user)::int,
    (select min(best) from per_user)::int,
    (select count(*) from per_user where not any_pass and coalesce(any_pending, false))::int;
end;
$$;
revoke all on function public.get_quiz_results_summary(uuid) from public, anon;
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
  if not public.is_quiz_manager() then
    raise exception 'غير مصرح';
  end if;
  select z.max_attempts into v_max from public.quizzes z where z.id = p_quiz_id;

  return query
  select
    a.user_id,
    coalesce(p.display_name, 'طالب علم'),
    case
      when bool_or(coalesce(a.passed, false)) then 'passed'
      when bool_or(a.grading_status = 'pending') then 'pending'   -- 0166
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
revoke all on function public.list_quiz_result_rows(uuid) from public, anon;
grant execute on function public.list_quiz_result_rows(uuid) to authenticated;

-- get_attempt_detail (0081 body + 0166): per-question kind; MCQ rows carry the
-- system's points; written rows carry the full answer, model answer, the
-- awarded score and note; attempt-level grading status / grader / time and the
-- auto-graded MCQ score the grader adds to.
create or replace function public.get_attempt_detail(p_attempt_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  a         public.quiz_attempts%rowtype;
  z         public.quizzes%rowtype;
  v_name    text;
  v_grader  text;
  v_total   integer;
  v_mcq     integer;
  v_answers jsonb;
  v_others  jsonb;
begin
  if not public.is_quiz_manager() then
    raise exception 'غير مصرح';
  end if;
  select * into a from public.quiz_attempts where id = p_attempt_id;
  if not found then
    raise exception 'المحاولة غير موجودة';
  end if;
  select * into z from public.quizzes where id = a.quiz_id;
  select coalesce(p.display_name, 'طالب علم') into v_name
    from public.profiles p where p.id = a.user_id;
  if a.graded_by is not null then
    select coalesce(p.display_name, 'مصحح') into v_grader
      from public.profiles p where p.id = a.graded_by;
  end if;
  select coalesce(sum(points), 0) into v_total
    from public.quiz_questions where quiz_id = z.id;
  select coalesce(sum(q.points), 0) into v_mcq
    from public.quiz_attempt_answers ans
    join public.quiz_options o on o.id = ans.option_id and o.is_correct
    join public.quiz_questions q on q.id = ans.question_id
   where ans.attempt_id = a.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'questionId',         q.id,
           'text',               q.text,
           'points',             q.points,
           'kind',               q.kind,
           'selectedOptionText', so.text,
           'correctOptionText',  co.text,
           'isCorrect',          case when q.kind = 'text'
                                      then coalesce(ans.awarded_points, 0) >= q.points
                                      else coalesce(so.is_correct, false) end,
           'textAnswer',         ans.text_answer,
           'modelAnswer',        q.model_answer,
           'awardedPoints',      case when q.kind = 'text' then ans.awarded_points
                                      when coalesce(so.is_correct, false) then q.points
                                      else 0 end,
           'graderNote',         ans.grader_note
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
           'attemptId',     pa.id,
           'attemptNo',     pa.attempt_no,
           'score',         pa.score,
           'passed',        pa.passed,
           'submittedAt',   pa.submitted_at,
           'gradingStatus', pa.grading_status
         ) order by pa.attempt_no), '[]'::jsonb)
    into v_others
    from public.quiz_attempts pa
   where pa.quiz_id = z.id and pa.user_id = a.user_id and pa.id <> a.id;

  return jsonb_build_object(
    'attemptId',     a.id,
    'quizId',        z.id,
    'quizTitle',     z.title,
    'displayName',   v_name,
    'attemptNo',     a.attempt_no,
    'startedAt',     a.started_at,
    'submittedAt',   a.submitted_at,
    'durationSec',   case when a.submitted_at is null then null
      else floor(extract(epoch from (a.submitted_at - a.started_at)))::int end,
    'score',         a.score,
    'passed',        a.passed,
    'totalScore',    v_total,
    'passScore',     z.pass_score,
    'mcqScore',      v_mcq,
    'gradingStatus', a.grading_status,
    'gradedAt',      a.graded_at,
    'gradedByName',  v_grader,
    'answers',       v_answers,
    'otherAttempts', v_others
  );
end;
$$;
revoke all on function public.get_attempt_detail(uuid) from public, anon;
grant execute on function public.get_attempt_detail(uuid) to authenticated;

-- «بانتظار التصحيح» — every attempt waiting for a grader, oldest first.
create or replace function public.list_pending_gradings()
returns table (
  attempt_id    uuid,
  quiz_id       uuid,
  quiz_title    text,
  section_title text,
  display_name  text,
  attempt_no    integer,
  submitted_at  timestamptz,
  written_count integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_quiz_manager() then
    raise exception 'غير مصرح';
  end if;
  return query
  select a.id, z.id, z.title, s.title,
         coalesce(p.display_name, 'طالب علم'),
         a.attempt_no, a.submitted_at,
         (select count(*)::int from public.quiz_questions q
           where q.quiz_id = z.id and q.kind = 'text')
    from public.quiz_attempts a
    join public.quizzes z on z.id = a.quiz_id
    left join public.sections s on s.id = z.section_id
    left join public.profiles p on p.id = a.user_id
   where a.grading_status = 'pending'
   order by a.submitted_at asc;
end;
$$;
revoke all on function public.list_pending_gradings() from public, anon;
grant execute on function public.list_pending_gradings() to authenticated;

-- «اعتماد التصحيح وإرسال النتيجة». p_grades = [{questionId, points, note?}]
-- for EVERY written question of the quiz. Locks the attempt (two graders →
-- the second one is refused), validates 0 ≤ points ≤ question points, writes
-- the scores + notes, finalizes score = MCQ (auto) + written, passed vs the
-- quiz's pass_score, records the grader + time, and tells the student.
create or replace function public.grade_quiz_attempt(p_attempt_id uuid, p_grades jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        public.quiz_attempts%rowtype;
  z        public.quizzes%rowtype;
  q        record;
  g        jsonb;
  v_points numeric;
  v_note   text;
  v_mcq    integer;
  v_text   integer;
  v_score  integer;
  v_passed boolean;
  v_pref   boolean;
begin
  if not public.is_quiz_manager() then
    raise exception 'غير مصرح';
  end if;
  if p_grades is null or jsonb_typeof(p_grades) <> 'array' then
    raise exception 'بيانات التصحيح غير صالحة';
  end if;

  select * into a from public.quiz_attempts where id = p_attempt_id for update;
  if not found then
    raise exception 'المحاولة غير موجودة';
  end if;
  if a.grading_status is distinct from 'pending' then
    if a.grading_status = 'graded' then
      raise exception 'تم اعتماد تصحيح هذه المحاولة من قبل';
    end if;
    raise exception 'هذه المحاولة لا تحتاج إلى تصحيح';
  end if;
  select * into z from public.quizzes where id = a.quiz_id;

  -- Every grade must belong to a written question of THIS quiz.
  if exists (
    select 1 from jsonb_array_elements(p_grades) e
     where not exists (select 1 from public.quiz_questions qq
                        where qq.quiz_id = z.id and qq.kind = 'text'
                          and qq.id::text = e ->> 'questionId')
  ) then
    raise exception 'سؤال غير صالح في التصحيح';
  end if;

  for q in
    select qq.id, qq.points from public.quiz_questions qq
     where qq.quiz_id = z.id and qq.kind = 'text'
     order by qq."order", qq.id
  loop
    g := null;  -- SELECT INTO with no row keeps the previous value
    select e into g from jsonb_array_elements(p_grades) e
     where e ->> 'questionId' = q.id::text limit 1;
    if g is null or jsonb_typeof(g -> 'points') is distinct from 'number' then
      raise exception 'ضع درجة لجميع الأسئلة النصية قبل الاعتماد';
    end if;
    v_points := (g ->> 'points')::numeric;
    if v_points <> trunc(v_points) or v_points < 0 or v_points > q.points then
      raise exception 'درجة السؤال يجب أن تكون بين ٠ و %', q.points;
    end if;
    v_note := nullif(btrim(coalesce(g ->> 'note', '')), '');
    if v_note is not null and char_length(v_note) > 2000 then
      raise exception 'الملاحظة أطول من المسموح';
    end if;

    insert into public.quiz_attempt_answers
      (attempt_id, question_id, option_id, text_answer, awarded_points, grader_note)
    values (a.id, q.id, null, null, v_points::int, v_note)
    on conflict (attempt_id, question_id) do update
      set awarded_points = excluded.awarded_points,
          grader_note    = excluded.grader_note;
  end loop;

  select coalesce(sum(qq.points), 0) into v_mcq
    from public.quiz_attempt_answers ans
    join public.quiz_options o on o.id = ans.option_id and o.is_correct
    join public.quiz_questions qq on qq.id = ans.question_id
   where ans.attempt_id = a.id;
  select coalesce(sum(ans.awarded_points), 0) into v_text
    from public.quiz_attempt_answers ans
    join public.quiz_questions qq on qq.id = ans.question_id and qq.kind = 'text'
   where ans.attempt_id = a.id;
  v_score := v_mcq + v_text;
  v_passed := v_score >= z.pass_score;

  update public.quiz_attempts
     set score          = v_score,
         passed         = v_passed,
         grading_status = 'graded',
         graded_by      = auth.uid(),
         graded_at      = now()
   where id = a.id;

  -- A personal inbox row (kept, see prune_notifications) → the 0122 trigger
  -- pushes it. Best-effort: a notification problem never undoes the grading.
  begin
    select enabled into v_pref from public.notification_prefs
     where user_id = a.user_id and type = 'quiz_graded';
    if coalesce(v_pref, true) then
      insert into public.notifications (user_id, type, title, body, data)
      values (
        a.user_id, 'quiz_graded', 'تم تصحيح اختبارك ✓',
        'تم تصحيح اختبار «' || z.title || '»، ويمكنك الآن الاطلاع على نتيجتك.',
        jsonb_build_object('route', '/quiz-result/' || a.id,
                           'quizId', z.id, 'attemptId', a.id)
      );
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'attemptId',  a.id,
    'score',      v_score,
    'totalScore', (select coalesce(sum(points), 0) from public.quiz_questions where quiz_id = z.id),
    'passScore',  z.pass_score,
    'passed',     v_passed
  );
end;
$$;
revoke all on function public.grade_quiz_attempt(uuid, jsonb) from public, anon;
grant execute on function public.grade_quiz_attempt(uuid, jsonb) to authenticated;
