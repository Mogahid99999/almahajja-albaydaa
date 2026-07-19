-- =============================================================================
-- 0111 · «حصاد الرحلة» harvest summary (V20 · §8)
--
-- The fruit of the student's journey over a range: this week / this month / since
-- the start. Returns completed lessons, ACTUAL listening seconds, active days,
-- completed series, passed quizzes, and benefits written — all scoped to the
-- range and to auth.uid() (security invoker). The date-anchored counts use the
-- device-local `daily_listening.day` spine plus timestamp-dated events, matching
-- the activity calendar (§7). p_range ∈ {'week','month','all'}; the week is
-- Sat→Fri (the app's week), the month is the calendar month, all = since ever.
--
-- Append-only, idempotent.
-- =============================================================================

create or replace function public.get_harvest(p_range text)
returns table (
  completed_lessons bigint,
  total_seconds     bigint,
  active_days       bigint,
  completed_series  bigint,
  quizzes_passed    bigint,
  benefits_written  bigint
)
language sql stable security invoker set search_path = public as $$
  with bounds as (
    select
      case p_range
        when 'week'  then (current_date - ((extract(dow from current_date)::int + 1) % 7))::date
        when 'month' then date_trunc('month', current_date)::date
        else '0001-01-01'::date
      end as from_day,
      (current_date + 1) as to_day  -- exclusive upper bound incl. today
  ),
  -- Listening + active days from the local-day spine.
  dl as (
    select coalesce(sum(d.seconds_listened), 0)::bigint as secs,
           count(*) filter (where d.seconds_listened > 0)::bigint as adays
      from public.daily_listening d, bounds b
     where d.user_id = auth.uid()
       and d.day >= b.from_day and d.day < b.to_day
  ),
  -- Completed lessons in range (by completion timestamp).
  comp as (
    select count(*)::bigint as n
      from public.user_lecture_progress p, bounds b
     where p.user_id = auth.uid() and p.completed and p.completed_at is not null
       and (p.completed_at)::date >= b.from_day and (p.completed_at)::date < b.to_day
  ),
  -- Series fully completed — only meaningful for 'all' (a "completed series" has
  -- no per-range timestamp); computed the same way as get_badge_metrics.
  ser as (
    select count(*)::bigint as n from (
      select l.section_id,
             count(*) as total,
             count(*) filter (where pp.completed) as done
        from public.lectures l
        left join public.user_lecture_progress pp
          on pp.lecture_id = l.id and pp.user_id = auth.uid()
       where l.status = 'published'
       group by l.section_id
    ) r
    where r.total > 0 and r.done = r.total
  ),
  quiz as (
    select count(distinct a.quiz_id)::bigint as n
      from public.quiz_attempts a, bounds b
     where a.user_id = auth.uid() and a.passed and a.submitted_at is not null
       and (a.submitted_at)::date >= b.from_day and (a.submitted_at)::date < b.to_day
  ),
  ben as (
    select count(*)::bigint as n
      from public.lecture_benefits lb, bounds b
     where lb.user_id = auth.uid() and lb.status = 'visible'
       and (lb.created_at)::date >= b.from_day and (lb.created_at)::date < b.to_day
  )
  select comp.n, dl.secs, dl.adays,
         -- Series completion isn't range-dated; report it only for 'all'.
         case when p_range = 'all' then ser.n else 0::bigint end,
         quiz.n, ben.n
    from dl, comp, ser, quiz, ben;
$$;

grant execute on function public.get_harvest(text) to authenticated;
revoke execute on function public.get_harvest(text) from public, anon;
