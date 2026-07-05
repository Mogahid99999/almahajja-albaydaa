-- =============================================================================
-- 0046_offline_activity_sync.sql
-- المَحجّة البَيْضَاء — V11 (S): day-aware activity core + one-call save_activity.
--
-- V11 collapses the ~5 round-trips the client made every 5s of playback into ONE
-- `save_activity` RPC, and adds an offline sync queue that REPLAYS activity for
-- the exact day it happened. Both need the streak/meaningful math to run for an
-- arbitrary day, not just `current_date`. So this migration:
--
--   1. Refactors 0044's `record_meaningful_activity` body into a day-parameterised
--      core `apply_meaningful_activity(..., p_day)` — every `current_date` becomes
--      `p_day` (the daily_listening upsert day, the meaningful flip, the
--      `v_last = max(day) where day < p_day` gap anchor, the placeholder fill
--      `while v_fill < p_day`, and the recovery stamp compare). Logic is otherwise
--      IDENTICAL to 0044 — the ≥2-completed-lessons recovery bar, 3–5-day gap,
--      30-day cooldown, gap bridging and recovery stamp all carry over unchanged.
--   2. Keeps `record_meaningful_activity(uuid,integer,boolean)` as a one-line
--      wrapper → `apply_meaningful_activity(…, current_date)` (SAME signature, so
--      no client callsite changes; 0039 grant re-asserted).
--   3. Adds `save_activity(...)` — one call that upserts user_lecture_progress AND
--      credits listening AND flips the streak day. The live path keeps today's
--      position-OVERWRITE semantics (a deliberate rewind must stick); a REPLAY of a
--      queued offline entry uses greatest() so a stale entry never rewinds newer
--      online progress. `completed` is always OR-merged (a lecture is never
--      un-completed); `completed_at` is stamped only on the false→true crossing and
--      never overwritten once set.
--
-- No table changes. `security invoker` throughout — every write is gated by the
-- existing own-rows RLS (the bodies also scope explicitly to auth.uid()).
-- Append-only — 0001–0045 are never edited. Idempotent (create or replace).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (1) apply_meaningful_activity — 0044's body, current_date → p_day.
-- ---------------------------------------------------------------------------
create or replace function public.apply_meaningful_activity(
  p_lecture_id uuid,
  p_seconds    integer,
  p_completed  boolean,
  p_day        date
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
    p_day,
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
   where user_id = v_uid and day = p_day;

  -- Flip the day to meaningful once it crosses the bar (≥120s listened or a
  -- completion) — a day counts toward the streak exactly as in 0014/0044.
  if not v_meaningful and (coalesce(p_completed, false) or v_seconds >= 120) then
    update public.daily_listening set meaningful = true
     where user_id = v_uid and day = p_day;
    v_meaningful := true;
  end if;

  -- Recovery is completion-driven (≥2 fully-completed lessons), so ONLY a
  -- completion can move the window toward the bar — skip plain listening ticks and
  -- days that never became meaningful. v_last excludes p_day (day < p_day), so the
  -- 3–5-day gap stays open across the whole session.
  if not v_meaningful then return; end if;
  if not coalesce(p_completed, false) then return; end if;

  select max(day) into v_last from public.daily_listening
   where user_id = v_uid and meaningful and day < p_day;
  if v_last is null then return; end if;

  v_gap := p_day - v_last;
  if v_gap < 3 or v_gap > 5 then return; end if;  -- alive, or past the window

  select (recovered_at is null or recovered_at < now() - interval '30 days')
    into v_cooldown_ok
    from public.streak_recovery_state where user_id = v_uid;
  if not coalesce(v_cooldown_ok, true) then return; end if;

  -- Compensatory bar (V10): ≥ 2 lessons FULLY COMPLETED inside the window that
  -- opened when the streak broke — broke_at (= last meaningful day + 3) onward.
  v_broke_at := v_last + 3;
  select count(*) into v_completed_in_window
    from public.user_lecture_progress
   where user_id = v_uid and completed
     and completed_at >= v_broke_at::timestamptz;
  if coalesce(v_completed_in_window, 0) < 2 then return; end if;

  -- The streak as it stood when it broke = the island ending at v_last.
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
  while v_fill < p_day loop
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

-- Internal core. It is called ONLY from the two invoker wrappers below. Postgres
-- checks EXECUTE on a nested call against the INVOKER's role, so an invoker
-- wrapper can only call this if `authenticated` holds EXECUTE — hence the grant
-- (public/anon stay revoked per 0039). Own-rows RLS + the explicit auth.uid()
-- scoping in the body keep a direct call as safe as record_meaningful_activity.
revoke all on function public.apply_meaningful_activity(uuid, integer, boolean, date) from public, anon;
grant execute on function public.apply_meaningful_activity(uuid, integer, boolean, date) to authenticated;

-- ---------------------------------------------------------------------------
-- (2) record_meaningful_activity — same signature as 0044/0014, now a thin
-- wrapper over the day-aware core (today). Existing client callsites unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.record_meaningful_activity(
  p_lecture_id uuid,
  p_seconds    integer,
  p_completed  boolean default false
)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  perform public.apply_meaningful_activity(p_lecture_id, p_seconds, coalesce(p_completed, false), current_date);
end;
$$;

revoke all on function public.record_meaningful_activity(uuid, integer, boolean) from public;
grant execute on function public.record_meaningful_activity(uuid, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- (3) save_activity — one call replaces the client's five (select prev + upsert +
-- record_meaningful_activity + get_journey_summary + user_badges select). The
-- caller now computes the forward delta itself (last-saved position), so no prev
-- SELECT is needed; badges are re-evaluated client-side only on completion.
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
  v_delta integer;
  -- Stamp completion at now() for today; for a replayed past day use that day's
  -- midnight — enough for the 0044 recovery-window compare (completed_at >= broke_at).
  v_stamp timestamptz := case when p_day = current_date then now() else p_day::timestamptz end;
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

  -- Credit today's/that-day's listening + run the streak/meaningful/recovery math.
  perform public.apply_meaningful_activity(
    p_lecture_id, v_delta, coalesce(p_completed, false), p_day
  );
end;
$$;

-- Execute hygiene (0039): no PUBLIC/anon; authenticated (incl. native guests) only.
revoke all on function public.save_activity(uuid, integer, integer, integer, boolean, date, boolean) from public, anon;
grant execute on function public.save_activity(uuid, integer, integer, integer, boolean, date, boolean) to authenticated;
