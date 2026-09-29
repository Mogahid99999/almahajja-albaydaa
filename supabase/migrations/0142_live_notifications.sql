-- =============================================================================
-- 0142_live_notifications.sql                                   ⚠ NOT APPLIED (P5)
-- المَحجّة البَيْضَاء — V23 P5: «البث المباشر» notifications, «ذكّرني», buddy invite.
--
-- (PLAN_LIVE_V23 §9. Drafted as 0139, then 0140 — never applied anywhere; took
-- 0142 because 0141_live_hands took the slot. The applied 0134/0136/0138
-- comments still say "0139_live_notifications": this is that file.)
-- Requires 0129 (fanout_queue), 0131 (push_queue), 0134–0138 (live tables/RPCs).
--
-- APPLY as its own transaction, and only once an app build that knows the three
-- new notification types is out: NotificationType + the label/description/icon
-- Records in src/components/notifications/labels.ts are exhaustive, so older
-- installs would render an inbox row with no label/icon.
--
--   * notification_type += live_start, live_reminder, live_invite. Postgres forbids
--     USING a freshly added label in the transaction that added it (0060
--     precedent); every use below is inside a plpgsql body, which is only
--     resolved when it runs, so one transaction is fine. (No SQL-language
--     function below mentions the new labels: those bodies are parsed at CREATE.)
--   * Prefs: nothing to seed — a missing notification_prefs row already means ON.
--     `live_start` gets its own toggle in the app («بث مباشر»); `live_invite` is
--     gated by the existing `buddy_activity` pref; `live_reminder` has no toggle
--     (the student asked for it with «ذكّرني»).
--   * live_start   fan-out via the 0129 queue (new kind) when a session goes live
--                  (a trigger on live_sessions, so 0138's set_live_session_status
--                  is untouched): students whose section gender scope allows it,
--                  pref ON, «ذكّرني» holders excluded (they get live_reminder).
--                  D6: during quiet hours (23:00–05:00, UTC+3 like 0035) the
--                  inbox rows are still written but NOT pushed — notify_push_batch
--                  (0131) learns a transaction-local `app.skip_push` flag, which
--                  only run_live_start_fanout sets.
--   * live_reminder «ذكّرني» holders: 15 min before (pg_cron, every minute, once
--                  per session) and again when the session actually starts.
--                  Not subject to quiet hours (explicitly requested).
--   * live_invite  invite_buddy_to_live — one buddy, once per session (PK of
--                  live_buddy_invites, 0136).
--   * set_live_reminder — writes live_reminders (0136).
--   * get_live_buddies_present — the caller's OWN buddies sitting in the room
--                  (buddy id + LiveKit identity), for «رفيقك · حسن».
--
-- Redefined functions (the rest of the live definitions are new):
--   notify_push_batch()     = 0131 body verbatim + ONE early exit (D6).
--   process_fanout_queue()  = 0129 body verbatim + TWO elsif branches.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Notification types -------------------------------------------------------------
alter type public.notification_type add value if not exists 'live_start';
alter type public.notification_type add value if not exists 'live_reminder';
alter type public.notification_type add value if not exists 'live_invite';

-- 2. «ذكّرني» once-flag for the 15-minute reminder ----------------------------------
alter table public.live_sessions
  add column if not exists reminders_sent_at timestamptz;

comment on column public.live_sessions.reminders_sent_at is
  'V23 P5: when the 15-minute «ذكّرني» reminder went out (dispatch_live_reminders, once per session). NULL = not yet.';

-- 3. Quiet hours helper (UTC+3, the 0016/0035 convention) ---------------------------
create or replace function public.live_is_quiet_hours()
returns boolean
language sql stable set search_path = public as $$
  select extract(hour from now() + interval '3 hours')::int >= 23
      or extract(hour from now() + interval '3 hours')::int < 5;
$$;
revoke all on function public.live_is_quiet_hours() from public, anon, authenticated;

-- 4. Push suppression hook (D6) — 0131's notify_push_batch + one early exit ----------
-- Everything below the `0142` comment is the current (0131) body, verbatim.
create or replace function public.notify_push_batch()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ids   uuid[];
  v_total int;
  i       int;
  c constant int := 100;
begin
  -- 0142 (D6): inbox rows written during quiet hours by the live_start fan-out
  -- are not pushed. Transaction-local; set only by run_live_start_fanout.
  if coalesce(current_setting('app.skip_push', true), '') = 'on' then
    return null;
  end if;
  select array_agg(id) into v_ids from new_rows;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then
    return null;
  end if;
  for i in 0 .. (v_total - 1) / c loop
    insert into public.push_queue (ids)
    values (v_ids[i * c + 1 : least((i + 1) * c, v_total)]);
  end loop;
  return null;
exception when others then
  -- Same contract as 0009: a push hiccup must never roll back the inbox rows.
  return null;
end;
$$;
-- A trigger function (never callable directly); EXECUTE is not checked when a
-- trigger fires, only at CREATE TRIGGER — so this only tidies the ACL.
revoke all on function public.notify_push_batch() from public, anon, authenticated;

-- 5. Fan-outs (run by process_fanout_queue, outside any request timeout) ------------
create or replace function public.run_live_start_fanout(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s        record;
  v_body   text;
  v_quiet  boolean := public.live_is_quiet_hours();
  v_vis_m  boolean;
  v_vis_f  boolean;
  v_vis_x  boolean;
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

  -- The section gender scope only depends on the viewer's gender: 3 calls, not 10k.
  v_vis_m := public.section_visible_to_viewer(s.section_id, 'male');
  v_vis_f := public.section_visible_to_viewer(s.section_id, 'female');
  v_vis_x := public.section_visible_to_viewer(s.section_id, null);

  -- §9.1: «{title} · {session}، مع {sheikh}. اضغط للاستماع.»
  v_body := s.title || ' · ' || s.section_title
         || coalesce('، مع ' || s.sheikh_name, '')
         || '. اضغط للاستماع.';

  -- D6: the flag lives only for this INSERT (its statement trigger fires at the
  -- end of it). If the INSERT fails, the job's subtransaction rolls the flag back.
  if v_quiet then
    perform set_config('app.skip_push', 'on', true);
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  select pr.id,
         'live_start',
         'بدأ البث المباشر',
         left(v_body, 300),
         jsonb_build_object('route', '/live/' || s.id, 'liveSessionId', s.id)
    from public.profiles pr
    left join public.notification_prefs np
      on np.user_id = pr.id and np.type = 'live_start'
   where pr.role = 'student'
     and coalesce(np.enabled, true)  -- missing pref row = ON
     and case pr.gender when 'male' then v_vis_m when 'female' then v_vis_f else v_vis_x end
     and not exists (
       select 1 from public.live_reminders r
        where r.session_id = s.id and r.user_id = pr.id
     );

  if v_quiet then
    perform set_config('app.skip_push', 'off', true);
  end if;
end;
$$;
revoke all on function public.run_live_start_fanout(uuid) from public, anon, authenticated;

-- live_reminder → «ذكّرني» holders. p_phase: 'soon' (≈15 min before) | 'start'.
create or replace function public.send_live_reminders(p_session uuid, p_phase text)
returns void
language plpgsql security definer set search_path = public as $$
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

  v_head := s.title || ' · ' || s.section_title || coalesce('، مع ' || s.sheikh_name, '');
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

  insert into public.notifications (user_id, type, title, body, data)
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
$$;
revoke all on function public.send_live_reminders(uuid, text) from public, anon, authenticated;

-- 6. The 0129 queue learns two kinds; its worker two branches ----------------------
alter table public.fanout_queue drop constraint if exists fanout_queue_kind_check;
alter table public.fanout_queue
  add constraint fanout_queue_kind_check
  check (kind in ('broadcast', 'lecture', 'live_start', 'live_reminder'));

-- 0129's worker, verbatim, + the two live branches (marked 0142).
create or replace function public.process_fanout_queue()
returns int
language plpgsql security definer set search_path = public as $$
declare
  j      record;
  v_done int := 0;
  v_err  text;
begin
  for j in
    select * from public.fanout_queue
     where done_at is null and attempts < 5
     order by id
     limit 20
     for update skip locked
  loop
    update public.fanout_queue
       set started_at = now(), attempts = attempts + 1
     where id = j.id;
    begin
      if j.kind = 'broadcast' then
        perform public.run_broadcast_fanout(j.ref_id, j.params);
      elsif j.kind = 'lecture' then
        -- Only if it is still published by the time the job runs.
        if exists (select 1 from public.lectures l
                    where l.id = j.ref_id and l.status = 'published') then
          perform public.fanout_to_all(
            'new_lecture',
            j.params ->> 'title',
            j.params ->> 'body',
            coalesce(j.params -> 'data', '{}'::jsonb)
          );
        end if;
      elsif j.kind = 'live_start' then
        -- 0142: only if still live when the job runs (checked inside).
        perform public.run_live_start_fanout(j.ref_id);
      elsif j.kind = 'live_reminder' then
        -- 0142: «ذكّرني» holders when the session starts.
        perform public.send_live_reminders(j.ref_id, coalesce(j.params ->> 'phase', 'start'));
      end if;
      -- Same subtransaction as the inserts: delivered ⇔ marked done.
      update public.fanout_queue set done_at = now(), last_error = null where id = j.id;
      v_done := v_done + 1;
    exception when others then
      get stacked diagnostics v_err = message_text;
      update public.fanout_queue set last_error = left(v_err, 500) where id = j.id;
    end;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.process_fanout_queue() from public, anon, authenticated;

-- 7. → live enqueues the fan-outs (0138's set_live_session_status is untouched) -----
create or replace function public.live_sessions_enqueue_live_notifications()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'live' and old.status is distinct from 'live' then
    if new.notify_all then
      insert into public.fanout_queue (kind, ref_id) values ('live_start', new.id);
    end if;
    if exists (select 1 from public.live_reminders where session_id = new.id) then
      insert into public.fanout_queue (kind, ref_id, params)
      values ('live_reminder', new.id, jsonb_build_object('phase', 'start'));
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.live_sessions_enqueue_live_notifications() from public, anon, authenticated;

drop trigger if exists live_sessions_notify_on_live on public.live_sessions;
create trigger live_sessions_notify_on_live
  after update of status on public.live_sessions
  for each row execute function public.live_sessions_enqueue_live_notifications();

-- 8. Student RPCs ---------------------------------------------------------------------

-- set_live_reminder — «ذكّرني» (registered only; scheduled sessions only).
-- Returns the new state (true = reminded). Turning it off works in any status.
create or replace function public.set_live_reminder(p_session uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  s        record;
  v_gender text;
begin
  if v_me is null or public.is_guest() then
    raise exception 'سجّل حسابك لتفعيل التذكير' using errcode = '42501';
  end if;
  select id, status, section_id into s from public.live_sessions where id = p_session;
  if not found then
    raise exception 'المجلس غير موجود';
  end if;

  if coalesce(p_on, false) then
    select gender into v_gender from public.profiles where id = v_me;
    if s.status <> 'scheduled'
       or not public.section_visible_to_viewer(s.section_id, v_gender) then
      raise exception 'لا يمكن التذكير بهذا المجلس';
    end if;
    insert into public.live_reminders (session_id, user_id)
    values (p_session, v_me)
    on conflict do nothing;
    return true;
  end if;

  delete from public.live_reminders where session_id = p_session and user_id = v_me;
  return false;
end;
$$;
revoke all on function public.set_live_reminder(uuid, boolean) from public, anon;
grant execute on function public.set_live_reminder(uuid, boolean) to authenticated;

-- invite_buddy_to_live — §9.2. The inviter must be registered, in the room
-- (has a live_participants row — written by live-token), paired with the buddy,
-- and the session live. Once per buddy per session (PK, server-enforced).
-- Returns 'sent' (buddy notified), 'muted' (recorded, but the buddy's
-- buddy_activity pref is off — no notification) or 'already' (invited before;
-- nothing new is sent).
drop function if exists public.invite_buddy_to_live(uuid, uuid);  -- never applied with another return type; safe re-run
create or replace function public.invite_buddy_to_live(p_session uuid, p_buddy uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  s        record;
  me       record;
  v_bg     text;
  v_name   text;
  v_title  text;
  v_body   text;
  v_female boolean;
begin
  if v_me is null or public.is_guest() then
    raise exception 'سجّل حسابك لدعوة رفيقك' using errcode = '42501';
  end if;
  if p_buddy is null or p_buddy = v_me
     or not exists (select 1 from public.buddies_of(v_me) b where b = p_buddy) then
    raise exception 'ليس من رفقائك';
  end if;
  select id, title, status, section_id into s from public.live_sessions where id = p_session;
  if not found or s.status <> 'live' then
    raise exception 'المجلس ليس مباشراً الآن';
  end if;
  if not exists (
    select 1 from public.live_participants
     where session_id = p_session and user_id = v_me
  ) then
    raise exception 'ادخل الحلقة أولاً ثم ادعُ رفيقك';
  end if;
  select gender into v_bg from public.profiles where id = p_buddy;
  if not public.section_visible_to_viewer(s.section_id, v_bg) then
    raise exception 'لا يمكن دعوة رفيقك إلى هذا المجلس';
  end if;

  insert into public.live_buddy_invites (session_id, from_user, to_user)
  values (p_session, v_me, p_buddy)
  on conflict do nothing;
  if not found then
    return 'already';
  end if;

  if not coalesce((select np.enabled from public.notification_prefs np
                    where np.user_id = p_buddy and np.type = 'buddy_activity'), true) then
    return 'muted';
  end if;

  select display_name, gender into me from public.profiles where id = v_me;
  v_female := me.gender = 'female';   -- buddies are same-gender (V14/V18)
  v_name   := coalesce(nullif(btrim(me.display_name), ''),
                       case when v_female then 'طالبة علم' else 'طالب علم' end);
  -- §15 push: «رفيقك {name} يدعوك» / «رفيقتك {name} تدعوك»;
  -- §9.2 body: «{name} في مجلس «{title}» الآن، فهلمّ/فهلمّي إليه.»
  v_title  := case when v_female
                   then 'رفيقتك ' || v_name || ' تدعوك'
                   else 'رفيقك ' || v_name || ' يدعوك' end;
  v_body   := v_name || ' في مجلس «' || s.title || '» الآن، '
           || case when v_female then 'فهلمّي إليه.' else 'فهلمّ إليه.' end;

  insert into public.notifications (user_id, type, title, body, data)
  values (p_buddy, 'live_invite', left(v_title, 120), left(v_body, 300),
          jsonb_build_object('route', '/live/' || s.id, 'liveSessionId', s.id));
  return 'sent';
end;
$$;
revoke all on function public.invite_buddy_to_live(uuid, uuid) from public, anon;
grant execute on function public.invite_buddy_to_live(uuid, uuid) to authenticated;

-- get_live_buddies_present — «رفيقك · حسن» (§9.2). ONLY the caller's own
-- accepted buddies who are in the room now: their user id (the caller already
-- has it from get_buddies_status) + their LiveKit identity in this session.
-- Nothing about anyone else. Empty unless the caller is registered and has
-- entered this room (a live_participants row). A sister who chose «بدون اسم»
-- is never reported: she shows as «طالبة» to everyone in the room (§7.7).
create or replace function public.get_live_buddies_present(p_session uuid)
returns table (buddy_id uuid, identity text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or public.is_guest() then
    return;
  end if;
  if not exists (
    select 1 from public.live_participants lp0
     where lp0.session_id = p_session and lp0.user_id = v_me
  ) then
    return;
  end if;
  return query
    select lp.user_id, lp.identity
      from public.live_participants lp
     where lp.session_id = p_session
       and lp.present
       and not lp.hidden_name
       and lp.user_id <> v_me
       and lp.user_id in (select b.id from public.buddies_of(v_me) as b(id));
end;
$$;
revoke all on function public.get_live_buddies_present(uuid) from public, anon;
grant execute on function public.get_live_buddies_present(uuid) to authenticated;

-- 9. §9.4 reminders cron (every minute) -----------------------------------------------
create or replace function public.dispatch_live_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_sent int := 0;
begin
  for r in
    select id from public.live_sessions
     where status = 'scheduled'
       and reminders_sent_at is null
       and scheduled_at <= now() + interval '15 minutes'
       and scheduled_at >  now() - interval '5 minutes'
     for update skip locked
  loop
    perform public.send_live_reminders(r.id, 'soon');
    update public.live_sessions set reminders_sent_at = now() where id = r.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.dispatch_live_reminders() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'live-reminders') then
    perform cron.unschedule('live-reminders');
  end if;
  perform cron.schedule('live-reminders', '* * * * *', $cmd$ select public.dispatch_live_reminders(); $cmd$);
end $$;
