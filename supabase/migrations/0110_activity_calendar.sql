-- =============================================================================
-- 0110 · «سجل النشاط» activity calendar (V20 · §7)
--
-- Per-day activity for one month: minutes listened, lessons completed, quizzes
-- passed, benefits written — plus a `level` the client maps to the calendar
-- colour (§7: none / light / full / gold). `daily_listening.day` is the device-
-- local day the streak math already uses (save_activity writes p_day), so it's
-- the spine; the completion/quiz/benefit counts are matched by their timestamp's
-- date (informational — the calendar isn't the streak authority).
--
-- level:
--   'none'  → no listening that day
--   'light' → some listening but under the "meaningful" bar (120s)
--   'full'  → a meaningful study day (≥120s, matching the streak bar)
--   'gold'  → a full day that ALSO had a completion / passed quiz (an achievement)
--
-- get_activity_calendar(p_month date) — p_month is any date in the target month;
-- the function clamps to that month. Scoped to auth.uid() (security invoker).
-- Append-only, idempotent.
-- =============================================================================

create or replace function public.get_activity_calendar(p_month date)
returns table (
  day               date,
  seconds_listened  integer,
  lessons_completed bigint,
  quizzes_passed    bigint,
  benefits_written  bigint,
  level             text
)
language sql stable security invoker set search_path = public as $$
  with bounds as (
    select date_trunc('month', p_month)::date            as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date as m_end
  ),
  dl as (
    select d.day, d.seconds_listened
      from public.daily_listening d, bounds b
     where d.user_id = auth.uid()
       and d.day >= b.m_start and d.day < b.m_end
  ),
  comp as (
    select (p.completed_at)::date as day, count(*) as n
      from public.user_lecture_progress p, bounds b
     where p.user_id = auth.uid() and p.completed and p.completed_at is not null
       and (p.completed_at)::date >= b.m_start and (p.completed_at)::date < b.m_end
     group by (p.completed_at)::date
  ),
  quiz as (
    select (a.submitted_at)::date as day, count(*) as n
      from public.quiz_attempts a, bounds b
     where a.user_id = auth.uid() and a.passed and a.submitted_at is not null
       and (a.submitted_at)::date >= b.m_start and (a.submitted_at)::date < b.m_end
     group by (a.submitted_at)::date
  ),
  ben as (
    select (lb.created_at)::date as day, count(*) as n
      from public.lecture_benefits lb, bounds b
     where lb.user_id = auth.uid() and lb.status = 'visible'
       and (lb.created_at)::date >= b.m_start and (lb.created_at)::date < b.m_end
     group by (lb.created_at)::date
  ),
  days as (
    -- Union every day that had ANY activity of any kind.
    select day from dl
    union select day from comp
    union select day from quiz
    union select day from ben
  )
  select
    x.day,
    coalesce(dl.seconds_listened, 0)                          as seconds_listened,
    coalesce(comp.n, 0)                                        as lessons_completed,
    coalesce(quiz.n, 0)                                        as quizzes_passed,
    coalesce(ben.n, 0)                                         as benefits_written,
    case
      when coalesce(comp.n, 0) > 0 or coalesce(quiz.n, 0) > 0 then 'gold'
      when coalesce(dl.seconds_listened, 0) >= 120            then 'full'
      when coalesce(dl.seconds_listened, 0) > 0               then 'light'
      else 'none'
    end                                                        as level
  from days x
  left join dl   on dl.day   = x.day
  left join comp on comp.day = x.day
  left join quiz on quiz.day = x.day
  left join ben  on ben.day  = x.day
  order by x.day;
$$;

grant execute on function public.get_activity_calendar(date) to authenticated;
revoke execute on function public.get_activity_calendar(date) from public, anon;
