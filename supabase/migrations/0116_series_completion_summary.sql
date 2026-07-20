-- =============================================================================
-- 0116 · «ملخص إتمام السلسلة» — series completion summary (V20 · Feature A)
--
-- When a student finishes an entire series (the recursive subtree of one section
-- — العقيدة → التوحيد → كتاب التوحيد → دروس), the closing page shows a calm
-- summary of their journey through it. This RPC builds the whole thing server-
-- side (CLAUDE.md: recursive rollups are SQL, never client tree-walking) for the
-- signed-in user, over `p_section_id` and every descendant section:
--
--   * lessons completed / total  — COMPLETE_THRESHOLD is already baked into
--     user_lecture_progress.completed (the 0.95 gate lives in the client that
--     writes the row), so we simply count `completed`.
--   * listening_seconds  — ACTUAL listened time in THIS series. daily_listening
--     is day-keyed (not lecture-keyed) so it can't be sliced per-section; the
--     series figure is the sum of per-lecture listened position over the subtree
--     (position_sec capped at duration_sec), which IS lecture-accurate. The
--     global badge-hours metric still reads daily_listening (decision 2026-07-19)
--     — this per-series number is a different question daily_listening can't
--     answer.
--   * quizzes  — attempts + best score, for quizzes attached to subtree sections.
--   * benefits_count / notes_count  — فوائد + private ملاحظات the student wrote on
--     lessons in this series (notes counted only when non-empty).
--   * bookmarks_count  — «المراجعة لاحقًا» marks in this series.
--   * started_at / completed_at  — min first-touch and max completion in the subtree.
--
-- SECURITY DEFINER + explicit auth.uid() scoping (the recursive section walk needs
-- to see the whole published tree regardless of the caller's section RLS, but every
-- per-user table is filtered to auth.uid() by hand). REVOKEd from anon (project
-- convention — the last few RPCs wrongly defaulted anon=true; not here).
--
-- Append-only, idempotent. Never edit an applied migration.
-- =============================================================================

create or replace function public.get_series_completion_summary(p_section_id uuid)
returns table (
  total_lectures     bigint,
  completed_lectures bigint,
  listening_seconds  bigint,
  quiz_attempts      bigint,
  quizzes_taken      bigint,
  quiz_best_total    bigint,   -- sum of best scores across taken quizzes
  quiz_points_total  bigint,   -- sum of each taken quiz's total possible points
  benefits_count     bigint,
  notes_count        bigint,
  bookmarks_count    bigint,
  started_at         timestamptz,
  completed_at       timestamptz
)
language sql stable security definer set search_path = public as $$
  with recursive uid as (select auth.uid() as u),
  -- Every section in the subtree rooted at p_section_id (inclusive).
  subtree as (
    select s.id
      from public.sections s
     where s.id = p_section_id
    union all
    select c.id
      from public.sections c
      join subtree t on c.parent_id = t.id
  ),
  -- Published lessons anywhere in the subtree.
  lec as (
    select l.id, l.duration_sec
      from public.lectures l
     where l.section_id in (select id from subtree)
       and l.status = 'published'
  ),
  -- This user's progress on those lessons.
  prog as (
    select p.lecture_id, p.position_sec, p.completed, p.updated_at, p.completed_at,
           lec.duration_sec
      from public.user_lecture_progress p
      join lec on lec.id = p.lecture_id
     where p.user_id = (select u from uid)
  ),
  -- Quizzes attached to subtree sections + this user's attempts on them.
  qz as (
    select q.id as quiz_id,
           (select coalesce(sum(qq.points), 0)
              from public.quiz_questions qq
             where qq.quiz_id = q.id) as total_points
      from public.quizzes q
     where q.section_id in (select id from subtree)
       and q.status = 'published'
  ),
  att as (
    select a.quiz_id,
           count(*)          as tries,
           max(a.score)      as best
      from public.quiz_attempts a
      join qz on qz.quiz_id = a.quiz_id
     where a.user_id = (select u from uid)
       and a.submitted_at is not null
     group by a.quiz_id
  )
  select
    (select count(*) from lec)::bigint,
    (select count(*) from prog where completed)::bigint,
    -- Per-lecture listened seconds, each capped at its duration so a stale
    -- position past the end can't inflate the total.
    (select coalesce(sum(
       least(greatest(position_sec, 0), coalesce(duration_sec, position_sec))
     ), 0) from prog)::bigint,
    (select coalesce(sum(tries), 0) from att)::bigint,
    (select count(*) from att)::bigint,
    (select coalesce(sum(coalesce(best, 0)), 0) from att)::bigint,
    (select coalesce(sum(qz.total_points), 0)
       from att join qz on qz.quiz_id = att.quiz_id)::bigint,
    (select count(*) from public.lecture_benefits b
      where b.user_id = (select u from uid) and b.status = 'visible'
        and b.lecture_id in (select id from lec))::bigint,
    (select count(*) from public.lecture_notes n
      where n.user_id = (select u from uid)
        and btrim(coalesce(n.body, '')) <> ''
        and n.lecture_id in (select id from lec))::bigint,
    (select count(*) from public.lecture_bookmarks bm
      where bm.user_id = (select u from uid)
        and bm.lecture_id in (select id from lec))::bigint,
    (select min(updated_at) from prog),
    (select max(completed_at) from prog where completed);
$$;

grant execute on function public.get_series_completion_summary(uuid) to authenticated;
revoke execute on function public.get_series_completion_summary(uuid) from public, anon;
