-- =============================================================================
-- 0106 · Badge metrics for the tiered badge system (V20 · §9)
--
-- The upgraded badge catalog (src/constants/badges.ts) grades badges across
-- categories: lessons, listening HOURS, streak, total active days, series
-- completion, quizzes & mastery, and note-taking (تدوين). get_journey_summary
-- already covers lessons / seconds / streak / active-days; this RPC returns the
-- REMAINING counts badge evaluation needs, in one round-trip, all scoped to
-- auth.uid() (security invoker + existing RLS):
--
--   * completed_series   — sections that have ≥1 published lesson AND the user
--                          completed every published lesson in them (immediate
--                          section membership, not the whole recursive subtree —
--                          a "series" is one section of lessons).
--   * quizzes_passed     — distinct quizzes the user has a sticky pass on.
--   * has_mastery        — any passed attempt scoring ≥ 90% of that quiz's total.
--   * benefits_count     — visible فوائد the user wrote.
--   * benefit_days       — distinct LOCAL days on which they wrote a benefit.
--
-- Buddy-category metrics are intentionally omitted — buddy_goals doesn't exist
-- until Phase 3; those badges simply stay locked until then.
--
-- "Listening hours" for the badge comes from get_journey_summary.total_seconds
-- (actual listened seconds in daily_listening — decision 2026-07-19), so it's not
-- repeated here.
--
-- Append-only, idempotent. Never edit an applied migration.
-- =============================================================================

create or replace function public.get_badge_metrics()
returns table (
  completed_series bigint,
  quizzes_passed   bigint,
  has_mastery      boolean,
  benefits_count   bigint,
  benefit_days     bigint
)
language sql stable security invoker set search_path = public as $$
  with my as (select auth.uid() as uid),
  -- Per immediate section: published lesson count + how many this user completed.
  section_rollup as (
    select l.section_id,
           count(*) as total,
           count(*) filter (
             where p.lecture_id is not null and p.completed
           ) as done
      from public.lectures l
      left join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = (select uid from my)
     where l.status = 'published'
     group by l.section_id
  ),
  passed as (
    -- Distinct quizzes with a sticky pass, and the total_score of each for the
    -- 90% mastery test. total_score = sum(points) over the quiz's questions.
    select qa.quiz_id,
           max(qa.score) as best_score,
           (select coalesce(sum(qq.points), 0)
              from public.quiz_questions qq
             where qq.quiz_id = qa.quiz_id) as total_score
      from public.quiz_attempts qa
     where qa.user_id = (select uid from my) and qa.passed
     group by qa.quiz_id
  )
  select
    (select count(*) from section_rollup where total > 0 and done = total)::bigint,
    (select count(*) from passed)::bigint,
    (select bool_or(best_score::numeric >= 0.9 * nullif(total_score, 0))
       from passed)::boolean,
    (select count(*) from public.lecture_benefits
       where user_id = (select uid from my) and status = 'visible')::bigint,
    (select count(distinct (created_at at time zone 'UTC')::date)
       from public.lecture_benefits
      where user_id = (select uid from my) and status = 'visible')::bigint;
$$;

grant execute on function public.get_badge_metrics() to authenticated;
