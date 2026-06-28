-- =============================================================================
-- 0004_journey.sql
-- منصة دروس العلم الشرعي — Phase 2 · رحلتي العلمية (weekly goals · streak · badges)
--
-- Personal-only, never compared between students (PRD calm/non-competitive tone):
--   * daily_listening — one row per (user, day): seconds heard + the distinct
--     lectures heard that day. Fed by the existing save-progress path.
--   * weekly_goals    — one active goal per user (lectures OR minutes per week).
--   * user_badges     — earned milestone instances; definitions live in app code
--                       (src/constants/badges.ts), only earned rows are stored.
--
-- Streak / weekly progress / journey totals are SERVER-SIDE rollups (CLAUDE.md:
-- rollups are SQL, never client tree-walking). Week boundary is Saturday→Friday
-- (Hijri-friendly). All four user tables use the own-rows RLS shape copied from
-- `progress_own` in 0001.
--
-- Append-only migration — 0001/0002/0003 are never edited.
-- Idempotent: safe to re-run (drops policies/triggers before recreating).
--
-- NOTE (deviation from PLAN_PHASE2.md §3.1): daily_listening stores
-- `lecture_ids uuid[]` (the distinct lectures heard that day) instead of a bare
-- `lectures_touched int`. A single integer counter cannot be incremented
-- *distinctly* through an idempotent upsert; the array can (`@>` / `||`), and the
-- count is derived in the rollups. This keeps "distinct lectures this week" exact.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.goal_metric as enum ('lectures', 'minutes');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per (user, day). `lecture_ids` is the set of distinct lectures heard
-- that day (its cardinality is the "lectures touched" stat). Upserted by the
-- client (own rows) from the same ~5s save-progress path that records position.
create table if not exists public.daily_listening (
  user_id          uuid not null references auth.users (id) on delete cascade,
  day              date not null,
  seconds_listened integer not null default 0,
  lecture_ids      uuid[] not null default '{}',
  created_at       timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_listening_user_day_idx
  on public.daily_listening (user_id, day desc);

-- The weekly goal the student sets. One active goal per user (PK = user_id).
create table if not exists public.weekly_goals (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  metric     public.goal_metric not null default 'lectures',
  target     integer not null default 3,
  updated_at timestamptz not null default now()
);

drop trigger if exists weekly_goals_set_updated_at on public.weekly_goals;
create trigger weekly_goals_set_updated_at
  before update on public.weekly_goals
  for each row execute function public.set_updated_at();

-- Earned milestone badges. Definition (title/threshold/kind) lives in app code;
-- we only persist the earned instance + when.
create table if not exists public.user_badges (
  user_id   uuid not null references auth.users (id) on delete cascade,
  badge_key text not null,            -- e.g. 'completed_10', 'streak_30'
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_key)
);

-- =============================================================================
-- Row Level Security — all personal: own rows only (copies `progress_own`).
-- =============================================================================
alter table public.daily_listening enable row level security;
alter table public.weekly_goals    enable row level security;
alter table public.user_badges     enable row level security;

drop policy if exists daily_listening_own on public.daily_listening;
create policy daily_listening_own on public.daily_listening
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists weekly_goals_own on public.weekly_goals;
create policy weekly_goals_own on public.weekly_goals
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_badges_own on public.user_badges;
create policy user_badges_own on public.user_badges
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.daily_listening to authenticated;
grant select, insert, update, delete on public.weekly_goals    to authenticated;
grant select, insert, update, delete on public.user_badges     to authenticated;

-- =============================================================================
-- Rollups (called via supabase.rpc). SECURITY INVOKER → scoped to auth.uid()
-- by the own-rows RLS above. Week = Saturday→Friday.
-- =============================================================================

-- Current streak: length of the run of consecutive days (with any listening)
-- that ends today or yesterday. Gaps-and-islands over daily_listening; the
-- "today or yesterday" anchor means a missed day past yesterday resets to 0
-- without any shaming — the longest streak is preserved separately.
create or replace function public.get_current_streak()
returns integer
language sql stable security invoker set search_path = public as $$
  with active as (
    select distinct day as d
      from public.daily_listening
     where user_id = auth.uid() and seconds_listened > 0
  ),
  grp as (
    select d, d - (row_number() over (order by d))::int as island
      from active
  ),
  runs as (
    select count(*) as len, max(d) as last_day
      from grp
     group by island
  )
  select coalesce(
    (select len::int from runs
      where last_day >= current_date - 1
      order by last_day desc
      limit 1),
    0
  );
$$;

-- This week's progress toward the active goal (Sat→Fri).
--   minutes  → sum(seconds_listened this week) / 60
--   lectures → count(distinct lectures heard this week)
-- Absence of a weekly_goals row defaults to lectures/3 (matches the table default).
create or replace function public.get_week_progress()
returns table (metric public.goal_metric, target integer, current integer)
language sql stable security invoker set search_path = public as $$
  with g as (
    select coalesce(wg.metric, 'lectures'::public.goal_metric) as metric,
           coalesce(wg.target, 3)                              as target
      from (select 1) one
      left join public.weekly_goals wg on wg.user_id = auth.uid()
  ),
  bounds as (
    select (current_date
            - ((extract(dow from current_date)::int + 1) % 7))::date as wk_start
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

-- Journey summary for the page header — one round-trip. Combines the lifetime
-- totals, current + longest streak, active-day count, and this-week progress.
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
    select distinct day as d
      from public.daily_listening
     where user_id = auth.uid() and seconds_listened > 0
  ),
  grp as (
    select d, d - (row_number() over (order by d))::int as island
      from active
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

-- Idempotent daily upsert helper (own rows). Adds the listened delta to today's
-- row and unions the lecture into the day's distinct set. The client calls this
-- from the save-progress path; SECURITY INVOKER keeps it gated by RLS.
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
    end;
$$;

grant execute on function public.get_current_streak()                   to authenticated;
grant execute on function public.get_week_progress()                    to authenticated;
grant execute on function public.get_journey_summary()                  to authenticated;
grant execute on function public.record_daily_listening(uuid, integer)  to authenticated;
