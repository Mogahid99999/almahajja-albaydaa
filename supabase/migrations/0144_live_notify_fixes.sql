-- =============================================================================
-- 0144_live_notify_fixes.sql
-- المَحجّة البَيْضَاء — V23 P5 review fixes on top of 0142 (append-only: 0142 is
-- already applied on staging).
--
--   * live_notice_head(): «{title} · {section}، مع {sheikh}» — the section is
--     dropped when it IS the title (a live started from the staff screen is
--     titled after its section by default → «العقيدة · العقيدة» on device).
--     run_live_start_fanout + send_live_reminders use it (bodies otherwise 0142's).
--   * dispatch_live_reminders(): also picks sessions whose green room is already
--     open — a host opening the green room 20 min early silently cancelled the
--     15-minute «ذكّرني» reminder (send_live_reminders already accepts green).
--   * invite_buddy_to_live(): returns 'sent' when the buddy muted buddy_activity
--     — the distinct 'muted' told any inviter his buddy's notification setting.
--
-- Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

create or replace function public.live_notice_head(p_title text, p_section text, p_sheikh text)
returns text
language sql immutable set search_path = public as $$
  select btrim(p_title)
      || case when p_section is null or btrim(p_section) = '' or btrim(p_section) = btrim(p_title)
              then '' else ' · ' || btrim(p_section) end
      || coalesce('، مع ' || nullif(btrim(p_sheikh), ''), '');
$$;
revoke all on function public.live_notice_head(text, text, text) from public, anon, authenticated;

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
  v_body := public.live_notice_head(s.title, s.section_title, s.sheikh_name) || '. اضغط للاستماع.';

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

create or replace function public.dispatch_live_reminders()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_sent int := 0;
begin
  for r in
    select id from public.live_sessions
     where status in ('scheduled', 'green')
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

-- 0142's body; only the muted branch changes ('sent' — no leak of the pref).
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

  -- The buddy turned buddy_activity off: recorded, nothing sent — and the
  -- inviter is told 'sent' like any other (his buddy's settings are his own).
  if not coalesce((select np.enabled from public.notification_prefs np
                    where np.user_id = p_buddy and np.type = 'buddy_activity'), true) then
    return 'sent';
  end if;

  select display_name, gender into me from public.profiles where id = v_me;
  v_female := me.gender = 'female';   -- buddies are same-gender (V14/V18)
  v_name   := coalesce(nullif(btrim(me.display_name), ''),
                       case when v_female then 'طالبة علم' else 'طالب علم' end);
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
