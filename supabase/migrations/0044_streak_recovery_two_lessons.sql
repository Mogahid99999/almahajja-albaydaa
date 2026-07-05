-- =============================================================================
-- 0044_streak_recovery_two_lessons.sql
-- المَحجّة البَيْضَاء — V10 Change A: استعادة المداومة now requires TWO fully
-- completed lessons within the 3-day recovery window.
--
-- The old compensatory bar (0014, line ~212) accepted 240s of listening OR two
-- distinct listened lectures OR a single completion. The owner's new rule: the
-- streak is only bridged back when the student has FULLY COMPLETED ≥ 2 lessons
-- inside the window that opened when the streak broke (broke_at = last meaningful
-- day + 3, through today). Minutes-listened and single completions no longer
-- qualify.
--
-- To count "completed inside the window" we need to know WHEN each lesson was
-- completed, so this migration adds `user_lecture_progress.completed_at` and
-- backfills it; the client stamps it on the false→true completion transition
-- (src/api/progress.ts). `record_meaningful_activity` keeps its exact signature
-- (client callsites untouched) — only the compensatory bar changes; the
-- meaningful-flip gate, 3–5-day gap detection, 30-day cooldown, gap bridging and
-- recovery stamp are all carried over from 0014 unchanged.
--
-- Append-only migration — 0001–0043 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- completed_at — when a lesson was fully completed (the false→true moment).
-- Backfill historic completions from updated_at (best available approximation).
-- ---------------------------------------------------------------------------
alter table public.user_lecture_progress
  add column if not exists completed_at timestamptz;

update public.user_lecture_progress
   set completed_at = updated_at
 where completed and completed_at is null;

-- ---------------------------------------------------------------------------
-- record_meaningful_activity — same signature as 0014. Only the compensatory
-- recovery bar changed (≥ 2 lessons completed inside [broke_at .. today]).
-- SECURITY INVOKER — every write is gated by the own-rows RLS.
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
  v_broke_at     date;
  v_completed_in_window integer;
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

  -- Flip today to meaningful once it crosses the bar (≥120s listened or a
  -- completion) — a day counts toward the streak exactly as in 0014.
  if not v_meaningful and (coalesce(p_completed, false) or v_seconds >= 120) then
    update public.daily_listening set meaningful = true
     where user_id = v_uid and day = current_date;
    v_meaningful := true;
  end if;

  -- Recovery is completion-driven now (≥2 fully-completed lessons), so ONLY a
  -- completion can move the window toward the bar — skip plain listening ticks and
  -- days that never became meaningful. Crucially, this runs on EVERY completion,
  -- not just the day's first meaningful flip: completing lesson #1 today already
  -- makes the day meaningful, so the bar (2 lessons) is only reached on lesson #2,
  -- which must still be evaluated. v_last excludes today (day < current_date), so
  -- the 3–5-day gap stays open across the whole session and doesn't collapse when
  -- today flips meaningful.
  if not v_meaningful then return; end if;
  if not coalesce(p_completed, false) then return; end if;

  select max(day) into v_last from public.daily_listening
   where user_id = v_uid and meaningful and day < current_date;
  if v_last is null then return; end if;

  v_gap := current_date - v_last;
  if v_gap < 3 or v_gap > 5 then return; end if;  -- alive, or past the window

  select (recovered_at is null or recovered_at < now() - interval '30 days')
    into v_cooldown_ok
    from public.streak_recovery_state where user_id = v_uid;
  if not coalesce(v_cooldown_ok, true) then return; end if;

  -- Compensatory bar (V10): ≥ 2 lessons FULLY COMPLETED inside the window that
  -- opened when the streak broke — broke_at (= last meaningful day + 3) through
  -- today. Minutes-listened and single completions no longer qualify.
  v_broke_at := v_last + 3;
  select count(*) into v_completed_in_window
    from public.user_lecture_progress
   where user_id = v_uid and completed
     and completed_at >= v_broke_at::timestamptz;
  if coalesce(v_completed_in_window, 0) < 2 then return; end if;

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

-- Preserve the S1 execute hygiene (0039): no PUBLIC/anon, authenticated only.
revoke all on function public.record_meaningful_activity(uuid, integer, boolean) from public;
grant execute on function public.record_meaningful_activity(uuid, integer, boolean) to authenticated;
