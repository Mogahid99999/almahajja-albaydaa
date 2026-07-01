-- =============================================================================
-- 0013_weekly_goal_reminders.sql
-- المَحجّة البَيْضَاء — PLAN_V3 Phase 6: weekly-goal reminders (cron + state)
--
-- Adds the time-based weekly-goal nudges (decision: cron-push, §14.1):
--   * profiles.last_opened_at — app→foreground stamp, written via touch_last_opened()
--     (SECURITY DEFINER so a student can set ONLY this column — profiles is
--     otherwise admin-write; a blanket own-update policy would let a student
--     escalate role, so we never add one).
--   * weekly_goal_state — per (user, Sat→Fri week) dedup: midweek / 2-days / congrats.
--   * dispatch_weekly_goal_nudges() — cron entry: midweek (day idx 3 = Tue) +
--     2-days-before-end (day idx 5 = Thu) nudges to students whose `weekly_goal`
--     pref is ON and whose goal is NOT yet met; inserts a notifications row of type
--     'weekly_goal' (→ existing webhook → push), deduped via weekly_goal_state.
--     Goal-met users get NO nudge (the local completion-congrats handles that).
--   * try_claim_goal_congrats() — client calls on a completion: if the week target
--     is met and not yet congratulated, atomically claims it (returns true) so the
--     app presents the local goal_done praise exactly once per week.
--   * pg_cron job runs the dispatcher daily at 16:00 UTC (~19:00 local, calm).
--
-- Reuses the Sat→Fri week boundary from 0004 (get_week_progress). The new enum
-- value 'weekly_goal' is added by 0012 (must already be committed). Append-only,
-- idempotent. Never edit 0001–0012.
-- =============================================================================

-- --- last app open ---------------------------------------------------------
alter table public.profiles add column if not exists last_opened_at timestamptz;

create or replace function public.touch_last_opened()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_opened_at = now() where id = auth.uid();
$$;
grant execute on function public.touch_last_opened() to authenticated;

-- --- weekly goal dedup state -----------------------------------------------
create table if not exists public.weekly_goal_state (
  user_id          uuid not null references auth.users (id) on delete cascade,
  week_start       date not null,
  midweek_sent_at  timestamptz,
  twodays_sent_at  timestamptz,
  congrats_sent_at timestamptz,
  primary key (user_id, week_start)
);

alter table public.weekly_goal_state enable row level security;

drop policy if exists weekly_goal_state_own on public.weekly_goal_state;
create policy weekly_goal_state_own on public.weekly_goal_state
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.weekly_goal_state to authenticated;

-- --- local completion-congrats claim (client, own rows) --------------------
-- Returns true only when the week's target is met AND congrats wasn't already
-- claimed this week — so the app fires the goal_done praise exactly once.
create or replace function public.try_claim_goal_congrats()
returns boolean
language plpgsql security invoker set search_path = public as $$
declare
  v_week_start date := (current_date - ((extract(dow from current_date)::int + 1) % 7))::date;
  v_metric  public.goal_metric;
  v_target  integer;
  v_current integer;
begin
  select metric, target, current
    into v_metric, v_target, v_current
    from public.get_week_progress();
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
grant execute on function public.try_claim_goal_congrats() to authenticated;

-- --- cron dispatcher (server, all users) -----------------------------------
create or replace function public.dispatch_weekly_goal_nudges()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_week_start date := (current_date - ((extract(dow from current_date)::int + 1) % 7))::date;
  v_day_idx    integer := current_date - (current_date - ((extract(dow from current_date)::int + 1) % 7))::date;
  v_is_midweek boolean := (current_date - (current_date - ((extract(dow from current_date)::int + 1) % 7))::date) = 3; -- Tue
  v_is_twodays boolean := (current_date - (current_date - ((extract(dow from current_date)::int + 1) % 7))::date) = 5; -- Thu
  r        record;
  v_metric public.goal_metric;
  v_target integer;
  v_current integer;
  v_title  text;
begin
  if not (v_is_midweek or v_is_twodays) then
    return;  -- the dispatcher is a no-op on non-nudge days
  end if;

  for r in
    select p.id as user_id
      from public.profiles p
      left join public.notification_prefs np
        on np.user_id = p.id and np.type = 'weekly_goal'
     where p.role = 'student'
       and coalesce(np.enabled, true)  -- missing pref row = ON
  loop
    -- This user's goal + current week progress.
    select coalesce(wg.metric, 'lectures'::public.goal_metric), coalesce(wg.target, 3)
      into v_metric, v_target
      from (select 1) one
      left join public.weekly_goals wg on wg.user_id = r.user_id;

    if v_metric = 'minutes' then
      select coalesce(sum(seconds_listened), 0) / 60 into v_current
        from public.daily_listening
       where user_id = r.user_id and day between v_week_start and v_week_start + 6;
    else
      select coalesce(count(distinct lid), 0) into v_current
        from public.daily_listening dl, lateral unnest(dl.lecture_ids) lid
       where dl.user_id = r.user_id and dl.day between v_week_start and v_week_start + 6;
    end if;
    v_current := coalesce(v_current, 0);

    if v_current >= v_target then
      continue;  -- goal met → no nudge (local congrats handles it)
    end if;

    insert into public.weekly_goal_state (user_id, week_start)
      values (r.user_id, v_week_start)
      on conflict (user_id, week_start) do nothing;

    if v_is_midweek then
      update public.weekly_goal_state
         set midweek_sent_at = now()
       where user_id = r.user_id and week_start = v_week_start
         and midweek_sent_at is null;
      if found then
        v_title := case when random() < 0.5
          then 'أنت في منتصف الطريق نحو هدفك الأسبوعي، واصل ولك الأجر'
          else 'هدفك الأسبوعي قريب، لا تدعه يفوتك' end;
        insert into public.notifications (user_id, type, title, body, data)
          values (r.user_id, 'weekly_goal', v_title, '',
                  jsonb_build_object('route', '/(student)/journey'));
      end if;
    elsif v_is_twodays then
      update public.weekly_goal_state
         set twodays_sent_at = now()
       where user_id = r.user_id and week_start = v_week_start
         and twodays_sent_at is null;
      if found then
        v_title := case when random() < 0.5
          then 'بقي القليل من الوقت لإكمال هدف هذا الأسبوع'
          else 'يومان وينتهي الأسبوع، أكمل ما تبقى من هدفك' end;
        insert into public.notifications (user_id, type, title, body, data)
          values (r.user_id, 'weekly_goal', v_title, '',
                  jsonb_build_object('route', '/(student)/journey'));
      end if;
    end if;
  end loop;
end;
$$;

-- Not for client use (writes other users' rows); triggers/cron invoke regardless.
revoke all on function public.dispatch_weekly_goal_nudges() from public, anon, authenticated;

-- --- schedule the dispatcher (pg_cron, daily 16:00 UTC ≈ 19:00 local) -------
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-goal-nudges') then
    perform cron.unschedule('weekly-goal-nudges');
  end if;
  perform cron.schedule(
    'weekly-goal-nudges',
    '0 16 * * *',
    $cron$ select public.dispatch_weekly_goal_nudges(); $cron$
  );
end $$;
