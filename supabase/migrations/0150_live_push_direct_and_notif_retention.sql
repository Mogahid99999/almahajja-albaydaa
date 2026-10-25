-- =============================================================================
-- 0150_live_push_direct_and_notif_retention.sql
-- المَحجّة البَيْضَاء — STABILITY: a live start must not knock the database over.
--
-- 2026-10-02 the prod DB (Nano, 0.5 GB) went unhealthy at EVERY live start.
-- Besides the profiles RLS bug (0149), the write+read amplification came from
-- `notifications`: 218 MB of a 320 MB database (557k rows), ~78 % of them
-- identical copies of one broadcast (new_lecture / reminders / attachments /
-- live_start). A live start inserted ~11k more copies, then the push wave made
-- thousands of apps open at once and read their inbox rows, scattered over the
-- whole cold table → random disk reads → Disk IO budget gone → swap thrash.
--
-- 1. live_start = push only. The recipients (same rules as 0144: students,
--    pref on, section visible to their gender, not a «ذكّرني» holder) WITH a
--    device token are chunked straight into push_queue (100 per row, one shared
--    payload); notify-on-publish's new DIRECT mode sends them. No inbox row is
--    written — a live is ephemeral and the Home card already shows it.
--    D6 kept: inside quiet hours nothing is pushed (previously inbox-only).
-- 2. No second «بدأ البث المباشر» to everyone when a live in the SAME section
--    already notified within 30 minutes (2026-10-02: a restart 80 s later
--    notified all students twice).
-- 3. Retention: identical broadcast copies 21 days, nudges 14 days, live
--    notices 2 days; personal rows (answers, buddies, feedback, reports) are
--    kept. prune_notifications() runs nightly (03:30 Riyadh) and also prunes
--    pg_cron's run log (cron.job_run_details, ~8.6k rows/day per 10 s job).
--    The one-off backlog delete + VACUUM FULL is run by hand (see the end).
--
-- Order on prod: deploy notify-on-publish (DIRECT mode) FIRST, then this.
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1a. push_queue rows may carry a shared payload (DIRECT) --------------------------
alter table public.push_queue add column if not exists payload jsonb;
comment on column public.push_queue.payload is
  '0150: null → ids are notification ids (BATCH); set → ids are USER ids and this is the shared {type,title,body,data} (DIRECT, no inbox rows).';

-- 1b. The paced sender knows both shapes (0131 body + the DIRECT branch) -----------
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

  -- Keep the table small: handed-off chunks older than a day are history.
  delete from public.push_queue where sent_at < now() - interval '1 day';
  return v_sent;
end;
$$;
revoke all on function public.process_push_queue() from public, anon, authenticated;

-- 1c + 2. live_start: push-only, deduped per section -------------------------------
create or replace function public.run_live_start_fanout(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s        record;
  v_body   text;
  v_vis_m  boolean;
  v_vis_f  boolean;
  v_vis_x  boolean;
  v_users  uuid[];
  v_total  int;
  i        int;
  c constant int := 100;
begin
  select ls.id, ls.title, ls.status, ls.section_id,
         sec.title as section_title, sh.name as sheikh_name
    into s
    from public.live_sessions ls
    join public.sections sec on sec.id = ls.section_id
    left join public.sheikhs sh on sh.id = ls.sheikh_id
   where ls.id = p_session;
  if not found or s.status <> 'live' then
    return;  -- ended/cancelled before the job ran: send nothing
  end if;

  -- D6: quiet hours (23:00–05:00) → no push. There is no inbox copy any more.
  if public.live_is_quiet_hours() then
    return;
  end if;

  -- 0150: a live in the same section already told everyone in the last 30 min
  -- (a restart / second attempt) → do not wake 11k phones again.
  if exists (
    select 1
      from public.fanout_queue q
      join public.live_sessions o on o.id = q.ref_id
     where q.kind = 'live_start'
       and q.done_at > now() - interval '30 minutes'
       and o.id <> s.id
       and o.section_id = s.section_id
  ) then
    return;
  end if;

  v_vis_m := public.section_visible_to_viewer(s.section_id, 'male');
  v_vis_f := public.section_visible_to_viewer(s.section_id, 'female');
  v_vis_x := public.section_visible_to_viewer(s.section_id, null);

  v_body := public.live_notice_head(s.title, s.section_title, s.sheikh_name) || '. اضغط للاستماع.';

  -- Same recipients as 0144, restricted to users that have a device token
  -- (no inbox row any more, so a token-less user would get nothing anyway).
  select array_agg(pr.id) into v_users
    from public.profiles pr
    left join public.notification_prefs np
      on np.user_id = pr.id and np.type = 'live_start'
   where pr.role = 'student'
     and coalesce(np.enabled, true)
     and case pr.gender when 'male' then v_vis_m when 'female' then v_vis_f else v_vis_x end
     and exists (select 1 from public.push_tokens t where t.user_id = pr.id)
     and not exists (
       select 1 from public.live_reminders r
        where r.session_id = s.id and r.user_id = pr.id
     );

  v_total := coalesce(array_length(v_users, 1), 0);
  for i in 0 .. (v_total - 1) / c loop
    exit when v_total = 0;
    insert into public.push_queue (ids, payload)
    values (
      v_users[i * c + 1 : least((i + 1) * c, v_total)],
      jsonb_build_object(
        'type',  'live_start',
        'title', 'بدأ البث المباشر',
        'body',  left(v_body, 300),
        'data',  jsonb_build_object('route', '/live/' || s.id, 'liveSessionId', s.id)
      )
    );
  end loop;
end;
$$;
revoke all on function public.run_live_start_fanout(uuid) from public, anon, authenticated;

-- 3. Retention ------------------------------------------------------------------------
create or replace function public.prune_notifications()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_notifs int;
  v_cron   int := 0;
begin
  delete from public.notifications
   where (type::text in ('new_lecture', 'new_attachment', 'beneficial_reminder')
          and created_at < now() - interval '21 days')
      or (type::text in ('weekly_goal', 'resume_reminder', 'streak_reminder', 'noncompletion_gentle')
          and created_at < now() - interval '14 days')
      or (type::text in ('live_start', 'live_reminder', 'live_invite')
          and created_at < now() - interval '2 days');
  get diagnostics v_notifs = row_count;

  begin
    delete from cron.job_run_details where end_time < now() - interval '2 days';
    get diagnostics v_cron = row_count;
  exception when others then
    v_cron := -1;  -- no privilege on this instance: notifications still pruned
  end;

  return jsonb_build_object('notifications', v_notifs, 'cron_log', v_cron);
end;
$$;
revoke all on function public.prune_notifications() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'prune-notifications') then
    perform cron.unschedule('prune-notifications');
  end if;
  -- 00:30 UTC = 03:30 Riyadh, the quietest hour.
  perform cron.schedule('prune-notifications', '30 0 * * *',
    $cmd$ set statement_timeout = '10min'; select public.prune_notifications(); $cmd$);
end $$;

-- One-off on prod, by hand, in a quiet moment (NOT part of this file's run):
--   set statement_timeout = '15min'; select public.prune_notifications();
--   vacuum (full, analyze) public.notifications;   -- compacts the table + indexes
