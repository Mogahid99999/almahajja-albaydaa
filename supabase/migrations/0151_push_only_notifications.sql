-- =============================================================================
-- 0151_push_only_notifications.sql
-- المَحجّة البَيْضَاء — STABILITY (owner decision 2026-10-03): general
-- notifications are PUSH ONLY; the inbox keeps «التذكيرات النافعة» (3 days)
-- and the personal ones (answers, buddies, support, reports, live invites).
--
-- Why: one inbox row per student per general event (~11k rows each) made
-- `notifications` 2/3 of the database on the 0.5 GB Nano instance and was the
-- main source of the swap / Disk-IO exhaustion that froze prod at every live
-- start (see 0149/0150). The push itself never needed the row.
--
--   * fanout_to_all / fanout_to_all_for_section / fanout_to_followers keep
--     their signatures and recipient rules, but QUEUE PUSHES (push_queue
--     DIRECT chunks of 100, students WITH a device token) instead of
--     inserting rows → new_lecture, new_attachment (via 0148/0129 jobs) and
--     new_quiz become push-only, and the quiz trigger no longer writes
--     thousands of rows inside the admin's request.
--   * Per-user nudges (resume / noncompletion / streak / weekly goal / buddy
--     nudges) and «ذكّرني» live reminders write to push_outbox — a SHORT-LIVED
--     per-message queue (kept 3 days, so the same-day «once per day» guards
--     still read it) — and process_push_queue sends it as MESSAGES.
--     Function bodies = the prod definitions of 2026-10-03, only the target
--     table changed (notifications → push_outbox).
--   * prune_notifications(): general rows older than 3 days (owner: «مسح
--     الإشعارات العامة تلقائياً كل 3 أيام»), push_outbox > 3 days, pg_cron
--     log > 2 days; personal rows are never pruned.
--   * touch_last_opened writes at most once an hour (and always on a new
--     local day, so «opened today» stays exact) — it was ~94k profile writes.
--
-- No app release needed: the same pushes arrive with the same data/routes.
-- Needs notify-on-publish with DIRECT + MESSAGES (deploy it FIRST).
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Per-message push outbox (transient) ----------------------------------------
create table if not exists public.push_outbox (
  id         bigserial primary key,
  user_id    uuid not null,
  type       public.notification_type not null,
  title      text not null,
  body       text not null default '',
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists push_outbox_pending_idx on public.push_outbox (id) where sent_at is null;
create index if not exists push_outbox_user_type_idx on public.push_outbox (user_id, type, created_at);
alter table public.push_outbox enable row level security;
revoke all on table public.push_outbox from public, anon, authenticated;
revoke all on sequence public.push_outbox_id_seq from public, anon, authenticated;

-- 2. One shared push to many users (DIRECT chunks of 100) -------------------------
create or replace function public.push_to_users(p_users uuid[], p_payload jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_total int := coalesce(array_length(p_users, 1), 0);
  i int;
  c constant int := 100;
begin
  if v_total = 0 then
    return 0;
  end if;
  for i in 0 .. (v_total - 1) / c loop
    insert into public.push_queue (ids, payload)
    values (p_users[i * c + 1 : least((i + 1) * c, v_total)], p_payload);
  end loop;
  return (v_total - 1) / c + 1;
end;
$$;
revoke all on function public.push_to_users(uuid[], jsonb) from public, anon, authenticated;

-- 3. The three fan-outs: same recipients, push instead of rows -------------------
create or replace function public.fanout_to_all(p_type notification_type, p_title text, p_body text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_users uuid[];
begin
  select array_agg(pr.id) into v_users
    from public.profiles pr
    left join public.notification_prefs p
      on p.user_id = pr.id and p.type = p_type
   where pr.role = 'student'
     and coalesce(p.enabled, true)  -- missing pref row = ON
     and exists (select 1 from public.push_tokens t where t.user_id = pr.id);
  perform public.push_to_users(v_users, jsonb_build_object(
    'type', p_type, 'title', p_title, 'body', coalesce(p_body, ''), 'data', coalesce(p_data, '{}'::jsonb)));
end;
$$;

create or replace function public.fanout_to_all_for_section(p_section_id uuid, p_type notification_type, p_title text, p_body text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_users uuid[];
  v_vis_m boolean := p_section_id is null or public.section_visible_to_viewer(p_section_id, 'male');
  v_vis_f boolean := p_section_id is null or public.section_visible_to_viewer(p_section_id, 'female');
  v_vis_x boolean := p_section_id is null or public.section_visible_to_viewer(p_section_id, null);
begin
  select array_agg(pr.id) into v_users
    from public.profiles pr
    left join public.notification_prefs p
      on p.user_id = pr.id and p.type = p_type
   where pr.role = 'student'
     and coalesce(p.enabled, true)
     and case pr.gender when 'male' then v_vis_m when 'female' then v_vis_f else v_vis_x end
     and exists (select 1 from public.push_tokens t where t.user_id = pr.id);
  perform public.push_to_users(v_users, jsonb_build_object(
    'type', p_type, 'title', p_title, 'body', coalesce(p_body, ''), 'data', coalesce(p_data, '{}'::jsonb)));
end;
$$;

create or replace function public.fanout_to_followers(p_section_id uuid, p_type notification_type, p_title text, p_body text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_users uuid[];
begin
  select array_agg(f.user_id) into v_users
    from public.followers_of_section(p_section_id) f
    left join public.notification_prefs p
      on p.user_id = f.user_id and p.type = p_type
   where coalesce(p.enabled, true)
     and exists (select 1 from public.push_tokens t where t.user_id = f.user_id);
  perform public.push_to_users(v_users, jsonb_build_object(
    'type', p_type, 'title', p_title, 'body', coalesce(p_body, ''), 'data', coalesce(p_data, '{}'::jsonb)));
end;
$$;

-- 4. The paced sender: BATCH / DIRECT chunks, then the outbox as MESSAGES ---------
create or replace function public.process_push_queue()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg    record;
  j      record;
  v_sent int := 0;
  v_ids  bigint[];
  v_msgs jsonb;
begin
  select url, auth into cfg from public.push_config;
  if not found then
    return 0;
  end if;

  for j in
    select id, ids, payload from public.push_queue
     where sent_at is null
     order by id
     limit 6
     for update skip locked
  loop
    perform net.http_post(
      url     := cfg.url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', cfg.auth),
      body    := case
                   when j.payload is null
                     then jsonb_build_object('type', 'BATCH', 'ids', to_jsonb(j.ids))
                   else jsonb_build_object('type', 'DIRECT', 'users', to_jsonb(j.ids),
                                           'notification', j.payload)
                 end,
      timeout_milliseconds := 60000
    );
    update public.push_queue set sent_at = now() where id = j.id;
    v_sent := v_sent + 1;
  end loop;

  -- Same pacing budget (≤ 6 requests per run) for the per-user outbox.
  while v_sent < 6 loop
    select array_agg(o.id),
           jsonb_agg(jsonb_build_object('user_id', o.user_id, 'type', o.type,
                                        'title', o.title, 'body', o.body, 'data', o.data))
      into v_ids, v_msgs
      from (select id, user_id, type, title, body, data
              from public.push_outbox
             where sent_at is null
             order by id
             limit 100
             for update skip locked) o;
    exit when v_ids is null;
    perform net.http_post(
      url     := cfg.url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', cfg.auth),
      body    := jsonb_build_object('type', 'MESSAGES', 'messages', v_msgs),
      timeout_milliseconds := 60000
    );
    update public.push_outbox set sent_at = now() where id = any(v_ids);
    v_sent := v_sent + 1;
  end loop;

  -- Keep both queues small.
  delete from public.push_queue where sent_at < now() - interval '1 day';
  return v_sent;
end;
$$;
revoke all on function public.process_push_queue() from public, anon, authenticated;

-- 5. Retention: general rows 3 days; personal never ---------------------------------
create or replace function public.prune_notifications()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_notifs int;
  v_outbox int;
  v_cron   int := 0;
begin
  delete from public.notifications
   where type::text not in ('question_answered', 'question_received', 'buddy_request',
                            'buddy_activity', 'feedback_received', 'content_reported', 'live_invite')
     and created_at < now() - interval '3 days';
  get diagnostics v_notifs = row_count;

  delete from public.push_outbox where created_at < now() - interval '3 days';
  get diagnostics v_outbox = row_count;

  begin
    delete from cron.job_run_details where end_time < now() - interval '2 days';
    get diagnostics v_cron = row_count;
  exception when others then
    v_cron := -1;
  end;

  return jsonb_build_object('notifications', v_notifs, 'push_outbox', v_outbox, 'cron_log', v_cron);
end;
$$;
revoke all on function public.prune_notifications() from public, anon, authenticated;

-- 6. touch_last_opened: at most hourly, always on a new local (UTC+3) day ----------
create or replace function public.touch_last_opened()
returns void
language sql security definer set search_path = public as $$
  update public.profiles
     set last_opened_at = now()
   where id = auth.uid()
     and (last_opened_at is null
          or last_opened_at < now() - interval '1 hour'
          or (last_opened_at + interval '3 hours')::date <> (now() + interval '3 hours')::date);
$$;

-- 7. The bell's unread count stays an index lookup -----------------------------------
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- 8. Per-user nudges → push_outbox (prod bodies 2026-10-03, table swapped) ---------

CREATE OR REPLACE FUNCTION public.dispatch_resume_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_streak_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- Recovery window (0014): last meaningful day 3–5 days back + cooldown
      -- clear → today's activity can still bridge the gap.
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
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_weekly_goal_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        insert into public.push_outbox (user_id, type, title, body, data)
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
        insert into public.push_outbox (user_id, type, title, body, data)
          values (r.user_id, 'weekly_goal', v_title, '',
                  jsonb_build_object('route', '/(student)/journey'));
      end if;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_buddy_nudges()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_local_hour int := extract(hour from now() + interval '3 hours')::int;
  v_sent int := 0;
  r record;
  v_me_share int;
  v_buddy_share int;
  v_kind text;
  v_title text;
  v_today_count int;
  v_pref boolean;
begin
  -- Quiet hours 23:00–05:00 (UTC+3), same convention as the other buddy crons.
  if v_local_hour >= 23 or v_local_hour < 5 then
    return 0;
  end if;

  perform public.settle_buddy_goals();

  -- One candidate row per (recipient, goal) for active/just-completed goals.
  for r in
    select g.id as goal_id, g.metric, g.target, g.starts_on, g.ends_on, g.status,
           rec.uid as recipient, other.uid as buddy_id
      from public.buddy_goals g
      cross join lateral (values (g.a_user_id), (g.b_user_id)) as rec(uid)
      cross join lateral (values (case when rec.uid = g.a_user_id then g.b_user_id else g.a_user_id end)) as other(uid)
     where g.status in ('active', 'completed')
       and g.ends_on >= current_date - 1
  loop
    -- Respect the recipient's buddy_activity pref (missing row = default ON).
    select enabled into v_pref from public.notification_prefs
      where user_id = r.recipient and type = 'buddy_activity';
    if v_pref is not null and v_pref = false then
      continue;
    end if;

    -- Daily cap: ≤ 3 total, and ≤ 1 per (recipient, buddy) per day.
    select count(*) into v_today_count from public.buddy_nudge_log
      where user_id = r.recipient and day = current_date;
    if v_today_count >= 3 then continue; end if;
    if exists (
      select 1 from public.buddy_nudge_log
       where user_id = r.recipient and buddy_id = r.buddy_id and day = current_date
    ) then continue; end if;

    v_me_share := public.buddy_goal_share(r.recipient, r.metric, r.starts_on, least(current_date, r.ends_on));
    v_buddy_share := public.buddy_goal_share(r.buddy_id, r.metric, r.starts_on, least(current_date, r.ends_on));

    -- Pick the most relevant single nudge for this goal.
    if r.status = 'completed' then
      v_kind := 'completed';
      v_title := 'اكتمل هدف الرفقة — نسأل الله أن ينفعكما بما تعلمتما';
    elsif v_buddy_share >= r.target and v_me_share < r.target then
      v_kind := 'buddy_done';
      v_title := 'رفيقك أتمّ نصيبه من الهدف — بقي نصيبك';
    elsif v_me_share >= r.target and v_buddy_share >= r.target then
      continue; -- both done but not settled yet; next run's settle handles it
    elsif (r.ends_on - current_date) = 2 then
      v_kind := 'two_days';
      v_title := 'بقي يومان على انتهاء هدف الرفقة';
    elsif v_me_share >= (r.target * 0.7) and v_buddy_share >= (r.target * 0.7) then
      v_kind := 'both_close';
      v_title := 'اقتربتما من إكمال هدف الرفقة';
    else
      continue;
    end if;

    -- Dedup this exact nudge for the day, then send.
    begin
      insert into public.buddy_nudge_log (user_id, buddy_id, goal_id, kind, day)
        values (r.recipient, r.buddy_id, r.goal_id, v_kind, current_date);
    exception when unique_violation then
      continue;
    end;

    insert into public.push_outbox (user_id, type, title, body, data)
      values (r.recipient, 'buddy_activity', v_title, '',
              jsonb_build_object('route', '/(student)/journey'));
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

CREATE OR REPLACE FUNCTION public.send_live_reminders(p_session uuid, p_phase text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s       record;
  v_head  text;
  v_title text;
  v_body  text;
begin
  select ls.id, ls.title, ls.status, ls.section_id, ls.scheduled_at,
         sec.title as section_title, sh.name as sheikh_name
    into s
    from public.live_sessions ls
    join public.sections sec on sec.id = ls.section_id
    left join public.sheikhs sh on sh.id = ls.sheikh_id
   where ls.id = p_session;
  if not found or s.status in ('cancelled', 'ended', 'processing', 'ready', 'failed') then
    return;
  end if;

  v_head := public.live_notice_head(s.title, s.section_title, s.sheikh_name);
  if p_phase = 'start' then
    v_title := 'بدأ المجلس الذي طلبت التذكير به';
    v_body  := v_head || '. اضغط للاستماع.';
  else
    v_title := 'يبدأ المجلس بعد قليل';
    v_body  := v_head || case
                 when s.scheduled_at > now() + interval '10 minutes'
                 then '. يبدأ بعد نحو ربع ساعة.'
                 else '. يبدأ بعد قليل.'
               end;
  end if;

  insert into public.push_outbox (user_id, type, title, body, data)
  select r.user_id,
         'live_reminder',
         v_title,
         left(v_body, 300),
         jsonb_build_object('route', '/live/' || s.id, 'liveSessionId', s.id)
    from public.live_reminders r
    join public.profiles pr on pr.id = r.user_id
   where r.session_id = s.id
     and public.section_visible_to_viewer(s.section_id, pr.gender);
end;
$function$;
