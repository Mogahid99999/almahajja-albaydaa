-- =============================================================================
-- 0014_daily_streak_recovery.sql
-- المَحجّة البَيْضَاء — Feature 26.1: نظام المداومة اليومية (streak rules + recovery)
--
-- Changes the streak contract in three ways (PLAN_26_STREAK_BUDDY.md):
--   1. TOLERANT BREAK RULE — a single missed day no longer breaks the streak;
--      islands group rows whose distance is ≤ 2 calendar days, and the anchor
--      moves from `last_day >= current_date - 1` to `>= current_date - 2`.
--      The streak VALUE stays "days actually listened" (count of active days),
--      as before — a tolerated gap day is not counted, it just doesn't break.
--   2. MEANINGFUL-ACTIVITY THRESHOLD — a day only counts toward the streak once
--      it accumulates ≥ 120s of listening OR a lecture completion. Tracked by a
--      new `daily_listening.meaningful` flag, set server-side (the plan's JS
--      gate `delta >= 120` could never fire: ticks are ~5s and capped at 90 —
--      so the threshold is applied to the DAY'S ACCUMULATED total here in SQL).
--      Historic rows are grandfathered (they counted under the old rule).
--   3. RECOVERY — when a streak broke within the last 3 days (gap of 3–5 days
--      since the last meaningful day) and the 30-day cooldown is clear, doing
--      compensatory activity today (≥ 240s OR 2 distinct lectures) retroactively
--      bridges the gap with 1-second placeholder rows. One placeholder per 2
--      missed days (the plan's single "most-recently missed day" placeholder
--      cannot bridge a 4–5 day gap under the ≤2-day island rule, so the minimal
--      set {last+2, last+4, …} is inserted instead — at most 2 rows).
--
-- Streak math lives in `streak_for_user(uuid)` so get_current_streak (self,
-- INVOKER + RLS) and the buddy rollups (0015, DEFINER) share one
-- implementation. SECURITY INVOKER means direct calls against another user's id
-- see zero rows through RLS — safe to grant.
--
-- Append-only migration — 0001–0013 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- daily_listening.meaningful — the day counts toward the streak
-- ---------------------------------------------------------------------------
alter table public.daily_listening
  add column if not exists meaningful boolean not null default false;

-- Grandfather history: every pre-threshold active day keeps counting.
update public.daily_listening set meaningful = true
 where seconds_listened > 0 and not meaningful;

-- ---------------------------------------------------------------------------
-- streak_recovery_state — one row per user: last break + recovery cooldown
-- ---------------------------------------------------------------------------
create table if not exists public.streak_recovery_state (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  broke_at      date,          -- first day the streak read 0 (last meaningful + 3)
  streak_before integer,       -- streak value just before breaking
  recovered_at  timestamptz    -- when recovery was last used (30-day cooldown)
);

alter table public.streak_recovery_state enable row level security;

drop policy if exists streak_recovery_state_own on public.streak_recovery_state;
create policy streak_recovery_state_own on public.streak_recovery_state
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.streak_recovery_state to authenticated;

-- ---------------------------------------------------------------------------
-- Shared streak math (new grouping: gap ≤ 2 days = same island)
-- ---------------------------------------------------------------------------
create or replace function public.streak_for_user(p_user_id uuid)
returns integer
language sql stable security invoker set search_path = public as $$
  with active as (
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
    (select len::int from runs
      where last_day >= current_date - 2
      order by last_day desc
      limit 1),
    0
  );
$$;
grant execute on function public.streak_for_user(uuid) to authenticated;

-- Same signature as 0004 — now tolerant of a 1-day gap + meaningful-gated.
create or replace function public.get_current_streak()
returns integer
language sql stable security invoker set search_path = public as $$
  select public.streak_for_user(auth.uid());
$$;

-- Rebuilt on the new grouping so longest_streak agrees with the tolerant rule.
create or replace function public.get_journey_summary()
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
  wk as (select * from public.get_week_progress())
  select
    (select count(*) from public.user_lecture_progress p
       where p.user_id = auth.uid() and p.completed)::bigint,
    (select coalesce(sum(seconds_listened), 0) from public.daily_listening
       where user_id = auth.uid())::bigint,
    public.get_current_streak(),
    (select coalesce(max(len), 0)::int from runs),
    (select count(*)::int from active),
    (select metric  from wk),
    (select target  from wk),
    (select current from wk);
$$;

-- ---------------------------------------------------------------------------
-- record_meaningful_activity — the save-progress seam (replaces the client's
-- record_daily_listening call). One RPC per ~5s tick:
--   1. accumulates the delta into today's daily_listening row (same upsert)
--   2. flips `meaningful` once today reaches 120s or sees a completion
--   3. on the first meaningful flip: if the streak broke 3–5 days ago, the
--      cooldown is clear, and today already meets the compensatory bar
--      (240s or 2 lectures), bridges the gap and stamps the recovery.
-- SECURITY INVOKER — every write is gated by the own-rows RLS above.
-- ---------------------------------------------------------------------------
create or replace function public.record_meaningful_activity(
  p_lecture_id uuid,
  p_seconds    integer,
  p_completed  boolean default false
)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_uid          uuid := auth.uid();
  v_seconds      integer;
  v_lectures     integer;
  v_meaningful   boolean;
  v_last         date;
  v_gap          integer;
  v_cooldown_ok  boolean;
  v_streak_before integer;
  v_fill         date;
begin
  insert into public.daily_listening (user_id, day, seconds_listened, lecture_ids)
  values (
    v_uid,
    current_date,
    greatest(coalesce(p_seconds, 0), 0),
    case when p_lecture_id is null then '{}'::uuid[] else array[p_lecture_id] end
  )
  on conflict (user_id, day) do update set
    seconds_listened = public.daily_listening.seconds_listened
                       + greatest(coalesce(excluded.seconds_listened, 0), 0),
    lecture_ids = case
      when excluded.lecture_ids = '{}'::uuid[] then public.daily_listening.lecture_ids
      when public.daily_listening.lecture_ids @> excluded.lecture_ids
        then public.daily_listening.lecture_ids
      else public.daily_listening.lecture_ids || excluded.lecture_ids
    end;

  select seconds_listened, coalesce(cardinality(lecture_ids), 0), meaningful
    into v_seconds, v_lectures, v_meaningful
    from public.daily_listening
   where user_id = v_uid and day = current_date;

  if v_meaningful then return; end if;
  if not (coalesce(p_completed, false) or v_seconds >= 120) then return; end if;

  update public.daily_listening set meaningful = true
   where user_id = v_uid and day = current_date;

  -- Recovery check — only on the day's first meaningful flip.
  select max(day) into v_last from public.daily_listening
   where user_id = v_uid and meaningful and day < current_date;
  if v_last is null then return; end if;

  v_gap := current_date - v_last;
  if v_gap < 3 or v_gap > 5 then return; end if;  -- alive, or past the window

  select (recovered_at is null or recovered_at < now() - interval '30 days')
    into v_cooldown_ok
    from public.streak_recovery_state where user_id = v_uid;
  if not coalesce(v_cooldown_ok, true) then return; end if;

  -- Compensatory bar: 2 lessons or 4 minutes today.
  if not (v_seconds >= 240 or v_lectures >= 2 or coalesce(p_completed, false)) then
    return;
  end if;

  -- The streak as it stood when it broke = the island ending at v_last
  -- (streak_for_user anchors on today and would just see today's island of 1).
  with active as (
    select day as d from public.daily_listening
     where user_id = v_uid and meaningful and day <= v_last
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
  select len::int into v_streak_before from runs where last_day = v_last;

  v_fill := v_last + 2;
  while v_fill < current_date loop
    insert into public.daily_listening (user_id, day, seconds_listened, lecture_ids, meaningful)
    values (v_uid, v_fill, 1, '{}'::uuid[], true)
    on conflict (user_id, day) do update set meaningful = true;
    v_fill := v_fill + 2;
  end loop;

  insert into public.streak_recovery_state (user_id, broke_at, streak_before, recovered_at)
  values (v_uid, v_last + 3, v_streak_before, now())
  on conflict (user_id) do update set
    broke_at      = excluded.broke_at,
    streak_before = excluded.streak_before,
    recovered_at  = excluded.recovered_at;
end;
$$;
grant execute on function public.record_meaningful_activity(uuid, integer, boolean) to authenticated;

-- Legacy seam kept honest: old clients still calling record_daily_listening
-- keep flipping `meaningful` when the day's total crosses the bar (no recovery).
create or replace function public.record_daily_listening(
  p_lecture_id uuid,
  p_seconds    integer
)
returns void
language sql security invoker set search_path = public as $$
  insert into public.daily_listening (user_id, day, seconds_listened, lecture_ids)
  values (
    auth.uid(),
    current_date,
    greatest(coalesce(p_seconds, 0), 0),
    case when p_lecture_id is null then '{}'::uuid[] else array[p_lecture_id] end
  )
  on conflict (user_id, day) do update set
    seconds_listened = public.daily_listening.seconds_listened
                       + greatest(coalesce(excluded.seconds_listened, 0), 0),
    lecture_ids = case
      when excluded.lecture_ids = '{}'::uuid[] then public.daily_listening.lecture_ids
      when public.daily_listening.lecture_ids @> excluded.lecture_ids
        then public.daily_listening.lecture_ids
      else public.daily_listening.lecture_ids || excluded.lecture_ids
    end,
    meaningful = public.daily_listening.meaningful
                 or (public.daily_listening.seconds_listened
                     + greatest(coalesce(excluded.seconds_listened, 0), 0)) >= 120;
$$;

-- ---------------------------------------------------------------------------
-- get_streak_status — one row for the home StreakCard. Recovery availability
-- is computed on the fly from daily_listening (not from streak_recovery_state)
-- so the card can show "لديك فرصة لاستعادة مداومتك" BEFORE the user listens.
-- ---------------------------------------------------------------------------
create or replace function public.get_streak_status()
returns table (
  current_streak     integer,
  today_counted      boolean,
  recovery_available boolean,
  recovery_days_left integer
)
language sql stable security invoker set search_path = public as $$
  with last_prev as (
    select max(day) as d from public.daily_listening
     where user_id = auth.uid() and meaningful and day < current_date
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
            and (current_date - lp.d) between 3 and 5
            and c.ok) as available,
           case when lp.d is null then 0
                else greatest(0, least(3, (lp.d + 5) - current_date + 1))
           end as days_left
      from last_prev lp, cool c
  )
  select
    public.get_current_streak(),
    exists (select 1 from public.daily_listening
             where user_id = auth.uid() and day = current_date and meaningful),
    w.available,
    case when w.available then w.days_left else 0 end
  from win w;
$$;
grant execute on function public.get_streak_status() to authenticated;
