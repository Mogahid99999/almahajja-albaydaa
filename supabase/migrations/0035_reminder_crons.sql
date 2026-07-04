-- =============================================================================
-- 0035_reminder_crons.sql
-- المَحجّة البَيْضَاء — V7 Fixes 1+2: server-cron reminders (reliability)
--
-- WHY: the resume/daily reminder ladder was DEVICE-scheduled (expo-notifications
-- TIME_INTERVAL at 6h–168h). Samsung/One UI Doze + "sleeping apps" defers or
-- drops those alarms once the app is backgrounded — so students never got them.
-- The server pipeline (notifications INSERT → 0009 webhook → notify-on-publish
-- → Expo Push → FCM) is proven reliable (new_lecture, weekly_goal). These two
-- dispatchers move the time-based reminders onto that path, like 0013 did for
-- the weekly goal. In-session presentations (completion praise, goal congrats)
-- stay local — they fire while the app is open.
--
--   * dispatch_resume_nudges() — daily 07:00 UTC (~10:00 local): each student's
--     most recent in-progress lecture; nudges on idle-day 1 (general bank),
--     day 3 (long-gap bank, type resume_reminder) and day 7 (soft no-shame
--     fallback, type noncompletion_gentle, its own pref). At most one nudge per
--     user per day; deep-links to the lecture at its saved second.
--   * dispatch_streak_reminders() — daily 14:00 UTC (~17:00 local): students
--     with a live streak (≥1) who haven't done meaningful activity today get a
--     calm keep-alive; students inside the 3–5-day recovery window (cooldown
--     clear, 0014 rules) get the recovery variant. Once per user per day.
--
-- Both honour quiet hours 23:00–05:00 local (UTC+3, the 0016 convention) so a
-- manual/off-schedule invocation can never ping at night. Dedup uses a
-- notifications-existence check on the local day (0016 pattern). Local days /
-- phrase banks mirror src/lib/notificationPhrases.ts (§11 wording, verbatim).
--
-- Requires 0033 ('streak_reminder') committed first. Append-only — 0001–0034
-- are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Resume/continue nudges (Fix 1) — replaces the unreliable device ladder.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_resume_nudges()
returns void
language plpgsql security definer set search_path = public as $$
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
         select 1 from public.notifications n
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

    insert into public.notifications (user_id, type, title, body, data)
    values (
      r.user_id, v_type, v_title, t.title,
      jsonb_build_object('lectureId', t.lecture_id, 'positionSec', t.position_sec)
    );
  end loop;
end;
$$;

revoke all on function public.dispatch_resume_nudges() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Streak keep-alive (Fix 2) — تذكير المداومة.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_streak_reminders()
returns void
language plpgsql security definer set search_path = public as $$
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
         select 1 from public.notifications n
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

    insert into public.notifications (user_id, type, title, body, data)
    values (
      r.user_id, 'streak_reminder', v_title, '',
      jsonb_build_object('route', '/(student)')
    );
  end loop;
end;
$$;

revoke all on function public.dispatch_streak_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule both (pg_cron): resume ~10:00 local, streak ~17:00 local.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'resume-nudges') then
    perform cron.unschedule('resume-nudges');
  end if;
  perform cron.schedule(
    'resume-nudges',
    '0 7 * * *',
    $cron$ select public.dispatch_resume_nudges(); $cron$
  );

  if exists (select 1 from cron.job where jobname = 'streak-reminders') then
    perform cron.unschedule('streak-reminders');
  end if;
  perform cron.schedule(
    'streak-reminders',
    '0 14 * * *',
    $cron$ select public.dispatch_streak_reminders(); $cron$
  );
end $$;
