-- =============================================================================
-- 0090_local_day_boundaries.sql
-- المَحجّة البَيْضَاء — Audit Phase 6 (F-043): device-local day boundaries for
-- the streak/journey READ rollups.
--
-- The WRITE side has been day-aware since 0046: `save_activity(p_day)` credits
-- listening to the day the client says it happened, and the offline outbox
-- replays with the DEVICE-LOCAL day ("streak days are device-local",
-- src/lib/outboxQueue.ts). But the live save path never passed p_day (defaulted
-- to the server's UTC `current_date`), and every READ rollup — today_counted,
-- the streak anchor, the Sat→Fri week bounds — also anchored on UTC. For the
-- target audience (UTC+2…+4) the local day starts 2–4 hours before the UTC one,
-- so between local midnight and ~3am the same listening landed on different
-- days depending on connectivity, and «واصلت اليوم» reflected the UTC day.
--
-- This migration makes the read rollups day-parameterised, mirroring 0046:
--   * streak_for_user(p_user_id)            → + p_today date default current_date
--   * get_current_streak()                  → + p_today
--   * get_week_progress()                   → + p_today (Sat→Fri bounds from it)
--   * get_journey_summary()                 → + p_today (threads it through)
--   * get_streak_status()                   → + p_today
--   * try_claim_goal_congrats()             → + p_today (week key + progress)
--   Old zero-/one-arg signatures are DROPPED (not overloaded) so PostgREST has
--   exactly one candidate; existing callers — the client's no-arg rpc() calls,
--   try_claim_goal_congrats (0013), the buddy rollups (0015/0082), the admin
--   user list (0025/0074/0075) and dispatch_resume_nudges (0035), all of which
--   call the old arity — keep resolving through the DEFAULT. p_today is clamped
--   to current_date ± 1 via clamp_client_day (every real TZ offset is within
--   ±1 day of UTC; the clamp caps what a tampered clock can ask of the
--   rollups, and matches save_activity's write clamp so reads can never ask
--   for a day writes can't reach).
--   The buddy/admin/cron callers deliberately stay on the server-day default:
--   the VIEWER's local day is meaningless for ANOTHER user's streak, and crons
--   have no device to ask.
--
-- And hardens the write side to match:
--   * save_activity: p_day may not lie more than 1 day in the future
--     (localDay() from any real timezone is at most current_date + 1); the
--     replay path's PAST days stay untouched — that is the whole point of 0046.
--     completed_at is stamped now() whenever p_day is within a day of the
--     server date (a live local-day save shortly after local midnight is still
--     "now", not that local day's midnight).
--
-- The client passes p_today from this migration's companion app change
-- (src/api/journey.ts) with a PGRST202 fallback, so either order of
-- {migration applied, app updated} stays correct.
--
-- Append-only migration — 0001–0087 are never edited. Idempotent.
-- NOTE: authored during the audit while no staging project exists (F-002);
-- apply via the management API BEFORE shipping the client build that passes
-- p_day/p_today, then regenerate src/types/database.generated.ts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (0) clamp_client_day — the single definition of how far a client-supplied
-- "today" is trusted: NULL falls back to the server day (the pre-0090
-- worst-case), and the value is bounded to current_date ± 1. All read rollups
-- below share it.
-- ---------------------------------------------------------------------------
-- ±1 day matches save_activity's write clamp below (every real TZ offset is
-- within ±1 day of UTC) — a wider read clamp would open a dead zone where a
-- fast clock reads a day its own writes can never reach.
create or replace function public.clamp_client_day(p_day date)
returns date
language sql stable security invoker set search_path = public as $$
  select greatest(least(coalesce(p_day, current_date), current_date + 1),
                  current_date - 1);
$$;
revoke all on function public.clamp_client_day(date) from public, anon;
grant execute on function public.clamp_client_day(date) to authenticated;

-- ---------------------------------------------------------------------------
-- (1) streak_for_user — day-parameterised anchor. Drop-first: an overload next
-- to the old (uuid) signature would make every existing SQL callsite ambiguous.
-- ---------------------------------------------------------------------------
drop function if exists public.streak_for_user(uuid);
drop function if exists public.streak_for_user(uuid, date);

create function public.streak_for_user(
  p_user_id uuid,
  p_today   date default current_date
)
returns integer
language sql stable security invoker set search_path = public as $$
  with today as (
    select public.clamp_client_day(p_today) as t
  ),
  active as (
    select day as d from public.daily_listening
     where user_id = p_user_id and meaningful
  ),
  gaps as (
    select d,
           case when d - lag(d) over (order by d) > 2 then 1 else 0 end as brk
      from active
  ),
  grp as (
    select d, sum(brk) over (order by d) as island from gaps
  ),
  runs as (
    select count(*) as len, max(d) as last_day from grp group by island
  )
  select coalesce(
    (select len::int from runs, today
      where last_day >= today.t - 2
      order by last_day desc
      limit 1),
    0
  );
$$;
revoke all on function public.streak_for_user(uuid, date) from public, anon;
grant execute on function public.streak_for_user(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- (2) get_current_streak — thin wrapper, unchanged semantics on the default.
-- ---------------------------------------------------------------------------
drop function if exists public.get_current_streak();
drop function if exists public.get_current_streak(date);

create function public.get_current_streak(p_today date default current_date)
returns integer
language sql stable security invoker set search_path = public as $$
  select public.streak_for_user(auth.uid(), p_today);
$$;
revoke all on function public.get_current_streak(date) from public, anon;
grant execute on function public.get_current_streak(date) to authenticated;

-- ---------------------------------------------------------------------------
-- (3) get_week_progress — Sat→Fri bounds computed from the (clamped) p_today.
-- ---------------------------------------------------------------------------
drop function if exists public.get_week_progress();
drop function if exists public.get_week_progress(date);

create function public.get_week_progress(p_today date default current_date)
returns table (metric public.goal_metric, target integer, current integer)
language sql stable security invoker set search_path = public as $$
  with today as (
    select public.clamp_client_day(p_today) as t
  ),
  g as (
    select coalesce(wg.metric, 'lectures'::public.goal_metric) as metric,
           coalesce(wg.target, 3)                              as target
      from (select 1) one
      left join public.weekly_goals wg on wg.user_id = auth.uid()
  ),
  bounds as (
    select (today.t
            - ((extract(dow from today.t)::int + 1) % 7))::date as wk_start
      from today
  ),
  wk as (
    select dl.seconds_listened, dl.lecture_ids
      from public.daily_listening dl, bounds b
     where dl.user_id = auth.uid()
       and dl.day between b.wk_start and b.wk_start + 6
  )
  select
    g.metric,
    g.target,
    case g.metric
      when 'minutes'  then (coalesce((select sum(seconds_listened) from wk), 0) / 60)::int
      when 'lectures' then coalesce(
        (select count(distinct lid)::int
           from wk w, lateral unnest(w.lecture_ids) as lid),
        0)
    end as current
  from g;
$$;
revoke all on function public.get_week_progress(date) from public, anon;
grant execute on function public.get_week_progress(date) to authenticated;

-- ---------------------------------------------------------------------------
-- (4) get_journey_summary — threads p_today into the streak + week legs.
-- Longest streak / totals / active days are day-agnostic (whole history).
-- ---------------------------------------------------------------------------
drop function if exists public.get_journey_summary();
drop function if exists public.get_journey_summary(date);

create function public.get_journey_summary(p_today date default current_date)
returns table (
  completed_lectures bigint,
  total_seconds      bigint,
  current_streak     integer,
  longest_streak     integer,
  active_days        integer,
  week_metric        public.goal_metric,
  week_target        integer,
  week_current       integer
)
language sql stable security invoker set search_path = public as $$
  with active as (
    select day as d from public.daily_listening
     where user_id = auth.uid() and meaningful
  ),
  gaps as (
    select d,
           case when d - lag(d) over (order by d) > 2 then 1 else 0 end as brk
      from active
  ),
  grp as (
    select d, sum(brk) over (order by d) as island from gaps
  ),
  runs as (
    select count(*) as len from grp group by island
  ),
  wk as (select * from public.get_week_progress(p_today))
  select
    (select count(*) from public.user_lecture_progress p
       where p.user_id = auth.uid() and p.completed)::bigint,
    (select coalesce(sum(seconds_listened), 0) from public.daily_listening
       where user_id = auth.uid())::bigint,
    public.get_current_streak(p_today),
    (select coalesce(max(len), 0)::int from runs),
    (select count(*)::int from active),
    (select metric  from wk),
    (select target  from wk),
    (select current from wk);
$$;
revoke all on function public.get_journey_summary(date) from public, anon;
grant execute on function public.get_journey_summary(date) to authenticated;

-- ---------------------------------------------------------------------------
-- (5) get_streak_status — today_counted / the recovery window judged against
-- the caller's day. Same clamp.
-- ---------------------------------------------------------------------------
drop function if exists public.get_streak_status();
drop function if exists public.get_streak_status(date);

create function public.get_streak_status(p_today date default current_date)
returns table (
  current_streak     integer,
  today_counted      boolean,
  recovery_available boolean,
  recovery_days_left integer
)
language sql stable security invoker set search_path = public as $$
  with today as (
    select public.clamp_client_day(p_today) as t
  ),
  last_prev as (
    select max(day) as d from public.daily_listening, today
     where user_id = auth.uid() and meaningful and day < today.t
  ),
  cool as (
    select coalesce(
      (select recovered_at is null or recovered_at < now() - interval '30 days'
         from public.streak_recovery_state where user_id = auth.uid()),
      true
    ) as ok
  ),
  win as (
    select (lp.d is not null
            and (today.t - lp.d) between 3 and 5
            and c.ok) as available,
           case when lp.d is null then 0
                else greatest(0, least(3, (lp.d + 5) - today.t + 1))
           end as days_left
      from last_prev lp, cool c, today
  )
  select
    public.get_current_streak(today.t),
    exists (select 1 from public.daily_listening
             where user_id = auth.uid() and day = today.t and meaningful),
    w.available,
    case when w.available then w.days_left else 0 end
  from win w, today;
$$;
revoke all on function public.get_streak_status(date) from public, anon;
grant execute on function public.get_streak_status(date) to authenticated;

-- ---------------------------------------------------------------------------
-- (6) save_activity — SAME signature as 0046; two hardening changes only:
--   * p_day clamped to at most current_date + 1 (no real timezone is further
--     ahead; a tampered clock can no longer bank future streak days). Past
--     days stay untouched — offline replays are legitimately old.
--   * completed_at stamped now() when p_day is within ±1 day of the server
--     date (a live local-day save around midnight is "now"); only genuinely
--     old replayed days fall back to that day's midnight.
-- ---------------------------------------------------------------------------
create or replace function public.save_activity(
  p_lecture_id   uuid,
  p_position_sec integer,
  p_duration_sec integer,
  p_delta_sec    integer,
  p_completed    boolean,
  p_day          date default current_date,
  p_is_replay    boolean default false
)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_pos   integer := greatest(coalesce(p_position_sec, 0), 0);
  v_day   date := least(coalesce(p_day, current_date), current_date + 1);
  v_delta integer;
  -- completed_at stamp. REPLAY keeps 0046's exact rule (that day's midnight
  -- unless it is today) so a completion replayed for a PAST day can never
  -- satisfy a recovery window it predates. LIVE takes greatest(now(), day
  -- midnight): a local-day save shortly after local midnight is "now", but
  -- when the local day is AHEAD of the server day (UTC+2…+4 after midnight)
  -- the stamp must not fall before that local day's own midnight — the 0044
  -- recovery bar compares completed_at >= broke_at, and broke_at can equal
  -- this very day.
  v_stamp timestamptz := case
    when coalesce(p_is_replay, false)
      then case when v_day = current_date then now() else v_day::timestamptz end
    else greatest(now(), v_day::timestamptz)
  end;
begin
  if v_uid is null then return; end if;

  -- Clamp the listened delta. A live tick is ~5s (cap 90 = MAX_LISTEN_TICK_SEC,
  -- src/config.ts); a coalesced offline REPLAY may carry a whole day at once, so
  -- cap the replayed total at 6h/day as a sanity bound.
  if p_is_replay then
    v_delta := least(greatest(coalesce(p_delta_sec, 0), 0), 21600);
  else
    v_delta := least(greatest(coalesce(p_delta_sec, 0), 0), 90);
  end if;

  -- Progress upsert. position_sec: live OVERWRITES (a deliberate rewind sticks);
  -- replay takes greatest() so a stale offline entry never rewinds newer online
  -- progress. completed is always OR-merged. completed_at is stamped only on the
  -- false→true crossing and never overwritten once set (updated_at is deliberately
  -- left untouched on update, matching the pre-V11 upsert — there is no set_updated_at
  -- trigger on this table, so the resume ordering is unchanged).
  insert into public.user_lecture_progress as ulp
    (user_id, lecture_id, position_sec, completed, completed_at)
  values (
    v_uid, p_lecture_id, v_pos, coalesce(p_completed, false),
    case when coalesce(p_completed, false) then v_stamp else null end
  )
  on conflict (user_id, lecture_id) do update set
    position_sec = case
      when p_is_replay then greatest(ulp.position_sec, excluded.position_sec)
      else excluded.position_sec
    end,
    completed = ulp.completed or excluded.completed,
    completed_at = case
      when ulp.completed then ulp.completed_at        -- already completed: keep the original stamp
      when excluded.completed then v_stamp            -- false → true now: stamp it
      else ulp.completed_at                           -- still not completed: leave null
    end;

  -- Credit that day's listening + run the streak/meaningful/recovery math.
  perform public.apply_meaningful_activity(
    p_lecture_id, v_delta, coalesce(p_completed, false), v_day
  );
end;
$$;

-- Execute hygiene (0039): no PUBLIC/anon; authenticated (incl. native guests) only.
revoke all on function public.save_activity(uuid, integer, integer, integer, boolean, date, boolean) from public, anon;
grant execute on function public.save_activity(uuid, integer, integer, integer, boolean, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- (7) try_claim_goal_congrats — the once-per-week local goal_done praise claim
-- (0013). Its week key and progress read both derived from the server day
-- while writes are now local-day: a goal-crossing completion at local Saturday
-- 00:30 (still Friday UTC) landed in a daily_listening row the still-current
-- UTC week's bounds exclude, so the just-earned congrats never fired. Same
-- p_today treatment as the rollups above; the client passes its local day.
-- ---------------------------------------------------------------------------
drop function if exists public.try_claim_goal_congrats();
drop function if exists public.try_claim_goal_congrats(date);

create function public.try_claim_goal_congrats(p_today date default current_date)
returns boolean
language plpgsql security invoker set search_path = public as $$
declare
  v_today      date := public.clamp_client_day(p_today);
  v_week_start date;
  v_metric  public.goal_metric;
  v_target  integer;
  v_current integer;
begin
  v_week_start := (v_today - ((extract(dow from v_today)::int + 1) % 7))::date;
  select metric, target, current
    into v_metric, v_target, v_current
    from public.get_week_progress(v_today);
  if coalesce(v_current, 0) < coalesce(v_target, 0) or coalesce(v_target, 0) = 0 then
    return false;
  end if;
  insert into public.weekly_goal_state (user_id, week_start)
    values (auth.uid(), v_week_start)
    on conflict (user_id, week_start) do nothing;
  update public.weekly_goal_state
     set congrats_sent_at = now()
   where user_id = auth.uid() and week_start = v_week_start
     and congrats_sent_at is null;
  return found;
end;
$$;
revoke all on function public.try_claim_goal_congrats(date) from public, anon;
grant execute on function public.try_claim_goal_congrats(date) to authenticated;
