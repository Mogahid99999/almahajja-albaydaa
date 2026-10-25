-- =============================================================================
-- 0154_buddy_search_and_nudges_set_based.sql
-- المَحجّة البَيْضَاء — PERF audit 2026-10-03: the remaining per-user loops
-- that could choke the 0.5 GB instance again.
--
-- 1. search_buddy_candidates called buddy_count(p.id) — a full scan of
--    buddy_requests — once PER same-gender student, plus two NOT EXISTS per
--    row: 38 M seq scans / 16.9 B rows read on a 694-row table since June,
--    up to 7.8 s per search, growing with every new user. Now: one pass to
--    count accepted buddies per user + one pass for my own pairs, hash-joined;
--    streak_for_user only for the 20 returned rows. Same rows, same order.
-- 2. dispatch_weekly_goal_nudges looped over ALL 11k students (4 statements
--    each, a weekly_goal_state row for everyone, up to 23.5 s at 19:00 Riyadh).
--    Owner 2026-10-03: only students who SET a goal (weekly_goals row; 114
--    today), and at 16:00 Riyadh (13:00 UTC). Set-based; the nudge copy, the
--    once-per-week guards (midweek_sent_at / twodays_sent_at) and the
--    goal-met skip are unchanged.
-- 3. dispatch_streak_reminders / dispatch_resume_nudges: SAME audience (owner),
--    same per-user logic, but the candidate query only keeps users who CAN
--    be nudged: a streak/recovery nudge needs a meaningful day within the last
--    5 days; a resume ladder day (1/3/7) needs an unfinished lecture touched
--    within the last 9 days. Pure pre-filters — everyone dropped would have
--    hit `continue` in the loop. Bodies otherwise = prod 2026-10-03 (0151).
--
-- No app release needed. Append-only. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Buddy search -----------------------------------------------------------------------
create or replace function public.search_buddy_candidates(p_search text)
returns table(id uuid, display_name text, current_streak integer)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, gender from public.profiles where id = auth.uid()
  ),
  accepted_counts as (   -- accepted buddies per user, one pass
    select u as user_id, count(*) as n
      from (select from_user_id as u from public.buddy_requests where status = 'accepted'
            union all
            select to_user_id from public.buddy_requests where status = 'accepted') x
     group by u
  ),
  my_pairs as (          -- anyone I'm already paired with or have a pending request with
    select case when r.from_user_id = me.id then r.to_user_id else r.from_user_id end as uid
      from public.buddy_requests r, me
     where r.status in ('accepted', 'pending')
       and (r.from_user_id = me.id or r.to_user_id = me.id)
  ),
  cand as (
    select p.id, p.display_name
      from public.profiles p
      cross join me
      left join accepted_counts a on a.user_id = p.id
      left join my_pairs mp on mp.uid = p.id
     where p.id <> me.id
       and p.role = 'student'
       and p.gender is not null
       and me.gender is not null
       and p.gender = me.gender
       and p.display_name is not null
       and (coalesce(trim(p_search), '') = '' or p.display_name ilike '%' || trim(p_search) || '%')
       and coalesce(a.n, 0) < 3
       and mp.uid is null
     order by p.display_name
     limit 20
  )
  select c.id, c.display_name, public.streak_for_user(c.id)
    from cand c
   order by c.display_name;
$$;

-- 2. Weekly-goal nudges: goal-setters only, set-based ------------------------------------
create or replace function public.dispatch_weekly_goal_nudges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date := (current_date - ((extract(dow from current_date)::int + 1) % 7))::date;
  v_day_idx    integer := current_date - (current_date - ((extract(dow from current_date)::int + 1) % 7))::date;
  v_is_midweek boolean := v_day_idx = 3;  -- Tue
  v_is_twodays boolean := v_day_idx = 5;  -- Thu
  v_need       uuid[];
begin
  if not (v_is_midweek or v_is_twodays) then
    return;  -- the dispatcher is a no-op on non-nudge days
  end if;

  -- Students who SET a goal (owner 2026-10-03), pref on, goal not yet met this week.
  select array_agg(g.user_id) into v_need
    from public.weekly_goals g
    join public.profiles p on p.id = g.user_id and p.role = 'student'
    left join public.notification_prefs np
      on np.user_id = g.user_id and np.type = 'weekly_goal'
   where coalesce(np.enabled, true)
     and (case
            when g.metric = 'minutes' then
              coalesce((select sum(dl.seconds_listened)
                          from public.daily_listening dl
                         where dl.user_id = g.user_id
                           and dl.day between v_week_start and v_week_start + 6), 0) / 60
            else
              coalesce((select count(distinct lid)
                          from public.daily_listening dl, lateral unnest(dl.lecture_ids) lid
                         where dl.user_id = g.user_id
                           and dl.day between v_week_start and v_week_start + 6), 0)
          end) < coalesce(g.target, 3);

  if v_need is null then
    return;
  end if;

  insert into public.weekly_goal_state (user_id, week_start)
  select u, v_week_start from unnest(v_need) u
  on conflict (user_id, week_start) do nothing;

  if v_is_midweek then
    with sent as (
      update public.weekly_goal_state
         set midweek_sent_at = now()
       where week_start = v_week_start and user_id = any(v_need) and midweek_sent_at is null
      returning user_id
    )
    insert into public.push_outbox (user_id, type, title, body, data)
    select user_id, 'weekly_goal',
           case when random() < 0.5
             then 'أنت في منتصف الطريق نحو هدفك الأسبوعي، واصل ولك الأجر'
             else 'هدفك الأسبوعي قريب، لا تدعه يفوتك' end,
           '', jsonb_build_object('route', '/(student)/journey')
      from sent;
  else
    with sent as (
      update public.weekly_goal_state
         set twodays_sent_at = now()
       where week_start = v_week_start and user_id = any(v_need) and twodays_sent_at is null
      returning user_id
    )
    insert into public.push_outbox (user_id, type, title, body, data)
    select user_id, 'weekly_goal',
           case when random() < 0.5
             then 'بقي القليل من الوقت لإكمال هدف هذا الأسبوع'
             else 'يومان وينتهي الأسبوع، أكمل ما تبقى من هدفك' end,
           '', jsonb_build_object('route', '/(student)/journey')
      from sent;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-goal-nudges') then
    perform cron.unschedule('weekly-goal-nudges');
  end if;
  -- 13:00 UTC = 16:00 Riyadh (owner): away from the evening lesson/live peak.
  perform cron.schedule('weekly-goal-nudges', '0 13 * * *', $cmd$ select public.dispatch_weekly_goal_nudges(); $cmd$);
end $$;

-- 3a. Streak reminders: same logic, only users who CAN be nudged -------------------------
create or replace function public.dispatch_streak_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_hour     integer := extract(hour from now() + interval '3 hours')::int;
  v_local_midnight timestamptz := date_trunc('day', now() + interval '3 hours') - interval '3 hours';
  v_bank text[] := array[
    'أنجز ولو اليسير اليوم حتى لا تفقد مداومتك',
    'حافظ على مداومتك، ولو بدرسٍ قصير',
    'بقيت خطوةٌ صغيرة لتُبقي مداومتك اليوم',
    'مداومتك أمانة، أكمل اليوم ولو قليلاً، ولك الأجر',
    'لا تدع مداومتك تنقطع، يسيرٌ يكفي'
  ];
  r             record;
  v_streak      integer;
  v_last        date;
  v_gap         integer;
  v_cooldown_ok boolean;
  v_title       text;
begin
  if v_local_hour >= 23 or v_local_hour < 5 then
    return;  -- quiet hours — never nudge at night
  end if;

  for r in
    select p.id as user_id
      from public.profiles p
      left join public.notification_prefs np
        on np.user_id = p.id and np.type = 'streak_reminder'
     where p.role = 'student'
       and coalesce(np.enabled, true)
       -- 0154: a nudge (streak ≥ 1 needs a meaningful day ≥ today-2; recovery
       -- needs one 3–5 days back) is impossible without a meaningful day in
       -- the last 5 days — skip everyone else up front.
       and p.id in (
         select dl0.user_id from public.daily_listening dl0
          where dl0.meaningful and dl0.day >= current_date - 5
       )
       and not exists (  -- today already counted → nothing to save
         select 1 from public.daily_listening dl
          where dl.user_id = p.id and dl.day = current_date and dl.meaningful
       )
       and not exists (  -- once per user per (local) day
         select 1 from public.push_outbox n
          where n.user_id = p.id
            and n.type = 'streak_reminder'
            and n.created_at >= v_local_midnight
       )
  loop
    v_streak := public.streak_for_user(r.user_id);

    if v_streak >= 1 then
      v_title := v_bank[1 + floor(random() * array_length(v_bank, 1))::int];
    else
      select max(day) into v_last
        from public.daily_listening
       where user_id = r.user_id and meaningful and day < current_date;
      if v_last is null then continue; end if;
      v_gap := current_date - v_last;
      if v_gap < 3 or v_gap > 5 then continue; end if;
      select coalesce(
        (select recovered_at is null or recovered_at < now() - interval '30 days'
           from public.streak_recovery_state where user_id = r.user_id),
        true
      ) into v_cooldown_ok;
      if not v_cooldown_ok then continue; end if;
      v_title := 'يمكنك استعادة مداومتك اليوم، فبادر قبل أن تفوت';
    end if;

    insert into public.push_outbox (user_id, type, title, body, data)
    values (
      r.user_id, 'streak_reminder', v_title, '',
      jsonb_build_object('route', '/(student)')
    );
  end loop;
end;
$$;

-- 3b. Resume nudges: same logic, only users with a recently touched unfinished lecture ----
create or replace function public.dispatch_resume_nudges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_hour    integer := extract(hour from now() + interval '3 hours')::int;
  v_local_midnight timestamptz := date_trunc('day', now() + interval '3 hours') - interval '3 hours';
  v_general text[] := array[
    'أكمل من حيث توقفت، ولك بكل حرف تسمعه أجر',
    'درسك بانتظارك، استكمل واغتنم الأجر',
    'خطوة واحدة تفصلك عن إكمال الدرس وأجره',
    'عد لدرسك، فالقليل المستمر خير من الكثير المنقطع'
  ];
  v_longgap text[] := array[
    'ما زال درسك ينتظر استكمالك',
    'عد لدرسك متى ما تيسر، فالقليل المستمر خير من الكثير المنقطع',
    'لم يفتك الأجر بعد، درسك كما تركته'
  ];
  v_noncomp text[] := array[
    'توقفت قبل أن تكمل، عد إليه حين تستطيع وأجرك محفوظ',
    'لا بأس، أكمل لاحقًا، فالعلم لا يفوته إلا من ترك',
    'احفظ موضعك، ودرسك سينتظرك كما تركته'
  ];
  r        record;
  t        record;
  v_days   integer;
  v_type   public.notification_type;
  v_title  text;
begin
  if v_local_hour >= 23 or v_local_hour < 5 then
    return;  -- quiet hours — never nudge at night
  end if;

  for r in
    select p.id as user_id,
           coalesce(np1.enabled, true) as resume_on,
           coalesce(np2.enabled, true) as noncomp_on
      from public.profiles p
      left join public.notification_prefs np1
        on np1.user_id = p.id and np1.type = 'resume_reminder'
      left join public.notification_prefs np2
        on np2.user_id = p.id and np2.type = 'noncompletion_gentle'
     where p.role = 'student'
       and (coalesce(np1.enabled, true) or coalesce(np2.enabled, true))
       -- 0154: the ladder days are 1/3/7 since the latest unfinished lecture's
       -- updated_at — impossible unless one was touched within 9 days.
       and p.id in (
         select ulp0.user_id from public.user_lecture_progress ulp0
          where not ulp0.completed and ulp0.position_sec > 0
            and ulp0.updated_at >= now() - interval '9 days'
       )
       and not exists (
         select 1 from public.push_outbox n
          where n.user_id = p.id
            and n.type in ('resume_reminder', 'noncompletion_gentle')
            and n.created_at >= v_local_midnight
       )
  loop
    select ulp.lecture_id, ulp.position_sec, ulp.updated_at, l.title
      into t
      from public.user_lecture_progress ulp
      join public.lectures l on l.id = ulp.lecture_id
     where ulp.user_id = r.user_id
       and not ulp.completed
       and ulp.position_sec > 0
       and l.status = 'published'
     order by ulp.updated_at desc
     limit 1;
    if not found then continue; end if;

    v_days := (now() + interval '3 hours')::date - (t.updated_at + interval '3 hours')::date;

    if v_days = 1 and r.resume_on then
      v_type  := 'resume_reminder';
      v_title := v_general[1 + floor(random() * array_length(v_general, 1))::int];
    elsif v_days = 3 and r.resume_on then
      v_type  := 'resume_reminder';
      v_title := v_longgap[1 + floor(random() * array_length(v_longgap, 1))::int];
    elsif v_days = 7 and r.noncomp_on then
      v_type  := 'noncompletion_gentle';
      v_title := v_noncomp[1 + floor(random() * array_length(v_noncomp, 1))::int];
    else
      continue;  -- not a ladder day for this lecture
    end if;

    insert into public.push_outbox (user_id, type, title, body, data)
    values (
      r.user_id, v_type, v_title, t.title,
      jsonb_build_object('lectureId', t.lecture_id, 'positionSec', t.position_sec)
    );
  end loop;
end;
$$;
