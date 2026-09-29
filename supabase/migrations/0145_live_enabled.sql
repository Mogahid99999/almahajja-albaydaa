-- =============================================================================
-- 0145_live_enabled.sql
-- المَحجّة البَيْضَاء — V23 P7: the «البث المباشر» rollout flag.
--
-- app_config.live_enabled = 'off' | 'staff' | 'all' (a missing row, or any other
-- value, means 'off'). Ship the app with the feature dark, turn it on for staff
-- (admin / publisher / sheikh) to rehearse on production, then for everyone —
-- without an app release. Flipped by an admin from لوحة الإدارة ← الإعدادات
-- through the existing admin-only set_app_config RPC (0023). The value is read
-- SERVER-SIDE only (these RPCs + the live-token edge function), so the known
-- «anon key reads app_config as []» gotcha does not matter here.
--
-- Helpers (new):
--   live_enabled_level()       → 'off' | 'staff' | 'all' (normalized; default 'off')
--   live_enabled_for_caller()  → 'all' → true; 'staff' → is_content_manager() or
--                                is_sheikh(); else false. Guests / students need 'all'.
--   Both authenticated-callable (the app may later hide its «بدء بث» action
--   with them); never anon.
--
-- Chokepoints — latest bodies VERBATIM + one guard each (marked «0145»):
--   get_live_now()              (0138) not enabled for the caller → the no-live
--                               shape {live:null, upcoming:[], green:null}: no Home
--                               card, no section pin, no upcoming card.
--   get_live_by_code(text)      (0138) null unless level = 'all' (the anon share page).
--   create_live_session(…)      (0138) after the role check: «البث المباشر غير مفعّل
--                               بعد» (42501) unless enabled for the caller.
--   run_live_start_fanout(uuid) (0144) sends nothing unless level = 'all' — a
--                               staff-only rehearsal must not push every student.
--                               (The fanout job is then marked done, not retried.)
--   admin_live_overview(int)    (0143) stays staff-only and ungated; it also
--                               returns 'live_enabled' (the level) for the screen.
-- The live-token edge function refuses with 403 live_disabled by the same rule
-- (supabase/functions/_shared/liveRules.ts liveEnabledFor).
--
-- Seeded 'off'. Staging needs 'staff' or 'all' before the live contract suites.
-- Requires 0138, 0143, 0144. Append-only (0001–0144 are never edited). Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Helpers --------------------------------------------------------------------------
create or replace function public.live_enabled_level()
returns text
language sql stable security definer set search_path = public as $$
  select case (select lower(btrim(c.value)) from public.app_config c where c.key = 'live_enabled')
           when 'all'   then 'all'
           when 'staff' then 'staff'
           else 'off'
         end;
$$;
revoke all on function public.live_enabled_level() from public, anon;
grant execute on function public.live_enabled_level() to authenticated;

create or replace function public.live_enabled_for_caller()
returns boolean
language sql stable security definer set search_path = public as $$
  select case public.live_enabled_level()
           when 'all'   then true
           when 'staff' then public.is_content_manager() or public.is_sheikh()
           else false
         end;
$$;
revoke all on function public.live_enabled_for_caller() from public, anon;
grant execute on function public.live_enabled_for_caller() to authenticated;

-- 2. get_live_now — 0138 body + the 0145 guard ------------------------------------------
create or replace function public.get_live_now()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_gender text;
  v_live   jsonb;
  v_up     jsonb;
  v_green  jsonb;
begin
  -- 0145 (P7): the rollout flag. Not enabled for this caller → the same shape
  -- as "nothing live, nothing scheduled".
  if not public.live_enabled_for_caller() then
    return jsonb_build_object('live', null, 'upcoming', '[]'::jsonb, 'green', null);
  end if;

  select gender into v_gender from public.profiles where id = v_uid;

  select jsonb_build_object(
           'id', s.id, 'title', s.title,
           'section_id', s.section_id, 'section_title', sec.title,
           'sheikh_id', s.sheikh_id, 'sheikh_name', sh.name,
           'started_at', s.started_at, 'share_code', s.share_code,
           'allow_requests', s.allow_requests)
    into v_live
    from public.live_sessions s
    join public.sections sec on sec.id = s.section_id
    left join public.sheikhs sh on sh.id = s.sheikh_id
   where s.status = 'live'
     and public.section_visible_to_viewer(s.section_id, v_gender)
   order by s.started_at desc nulls last
   limit 1;

  select coalesce(jsonb_agg(t.j order by t.at), '[]'::jsonb)
    into v_up
    from (
      select jsonb_build_object(
               'id', s.id, 'title', s.title,
               'section_id', s.section_id, 'section_title', sec.title,
               'sheikh_id', s.sheikh_id, 'sheikh_name', sh.name,
               'scheduled_at', s.scheduled_at, 'share_code', s.share_code,
               'reminded', exists (
                 select 1 from public.live_reminders r
                  where r.session_id = s.id and r.user_id = v_uid)) as j,
             s.scheduled_at as at
        from public.live_sessions s
        join public.sections sec on sec.id = s.section_id
        left join public.sheikhs sh on sh.id = s.sheikh_id
       where s.status = 'scheduled'
         and s.scheduled_at >= now() - interval '1 hour'
         and public.section_visible_to_viewer(s.section_id, v_gender)
       order by s.scheduled_at
       limit 3
    ) t;

  if public.is_content_manager() or public.is_sheikh() then
    select jsonb_build_object(
             'id', s.id, 'title', s.title,
             'section_id', s.section_id, 'host_user_id', s.host_user_id,
             'is_mine', s.host_user_id = v_uid)
      into v_green
      from public.live_sessions s
     where s.status = 'green'
     limit 1;
  end if;

  return jsonb_build_object('live', v_live, 'upcoming', v_up, 'green', v_green);
end;
$$;
revoke all on function public.get_live_now() from public, anon;
grant execute on function public.get_live_now() to authenticated;

-- 3. get_live_by_code — 0138 body + the 0145 guard --------------------------------------
create or replace function public.get_live_by_code(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_code   text := upper(btrim(coalesce(p_code, '')));
  s        record;
  v_status text;
  v_gender text;
begin
  -- 0145 (P7): share links (and the anon fallback page) only once live is on
  -- for everyone — a staff rehearsal's link must not reach the public.
  if public.live_enabled_level() <> 'all' then
    return null;
  end if;

  if v_code !~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$' then
    return null;
  end if;
  select ls.id, ls.title, ls.status, ls.section_id, ls.scheduled_at, ls.started_at,
         sec.title as section_title, sh.name as sheikh_name
    into s
    from public.live_sessions ls
    join public.sections sec on sec.id = ls.section_id
    left join public.sheikhs sh on sh.id = ls.sheikh_id
   where ls.share_code = v_code;
  if not found or s.status = 'cancelled' then
    return null;
  end if;

  v_status := case
                when s.status in ('scheduled', 'green') then 'scheduled'
                when s.status = 'live' then 'live'
                else 'ended'
              end;

  if auth.uid() is not null then
    select gender into v_gender from public.profiles where id = auth.uid();
  end if;
  if not public.section_visible_to_viewer(s.section_id, v_gender) then
    return jsonb_build_object('restricted', true, 'status', v_status);
  end if;

  return jsonb_build_object(
    'restricted', false,
    'id', s.id,
    'status', v_status,
    'title', s.title,
    'section_title', s.section_title,
    'sheikh_name', s.sheikh_name,
    'scheduled_at', s.scheduled_at,
    'started_at', s.started_at);
end;
$$;
revoke all on function public.get_live_by_code(text) from public;
grant execute on function public.get_live_by_code(text) to anon, authenticated;

-- 4. create_live_session — 0138 body + the 0145 guard -----------------------------------
create or replace function public.create_live_session(
  p_section        uuid,
  p_title          text,
  p_sheikh         uuid        default null,
  p_scheduled_at   timestamptz default null,
  p_notify         boolean     default true,
  p_allow_requests boolean     default true
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title  text := btrim(coalesce(p_title, ''));
  v_sheikh uuid := p_sheikh;
  v_status public.live_status;
  v_prefix text;
  v_id     uuid;
  v_con    text;
begin
  if not (public.is_content_manager() or public.is_sheikh()) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  -- 0145 (P7): 'off' refuses every staff member; 'staff' / 'all' let them in.
  if not public.live_enabled_for_caller() then
    raise exception 'البث المباشر غير مفعّل بعد' using errcode = '42501';
  end if;
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'عنوان المجلس بين ٣ و٢٠٠ حرف';
  end if;
  if p_section is null or not exists (select 1 from public.sections where id = p_section) then
    raise exception 'القسم غير موجود';
  end if;
  if v_sheikh is null then
    select id into v_sheikh
      from public.sheikhs where user_id = auth.uid()
     order by created_at limit 1;
  elsif not exists (select 1 from public.sheikhs where id = v_sheikh) then
    raise exception 'الشيخ غير موجود';
  end if;

  if p_scheduled_at is null then
    v_status := 'green';
    perform public.live_assert_no_active();
  else
    if p_scheduled_at < now() + interval '1 minute' then
      raise exception 'موعد المجلس يجب أن يكون في المستقبل';
    end if;
    v_status := 'scheduled';
  end if;

  select room_prefix into v_prefix from public.live_config;
  if v_prefix is null then
    raise exception 'live_config is missing';
  end if;

  begin
    insert into public.live_sessions
      (section_id, sheikh_id, title, status, scheduled_at, host_user_id,
       allow_requests, notify_all, room_name, share_code)
    values
      (p_section, v_sheikh, v_title, v_status, p_scheduled_at, auth.uid(),
       coalesce(p_allow_requests, true), coalesce(p_notify, true),
       v_prefix || left(replace(gen_random_uuid()::text, '-', ''), 12),
       public.live_new_share_code())
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'live_sessions_one_active' then
      raise exception 'يوجد بث مباشر قائم الآن، ولا يمكن فتح بث آخر في الوقت نفسه';
    end if;
    raise;
  end;
  return v_id;
end;
$$;
revoke all on function public.create_live_session(uuid, text, uuid, timestamptz, boolean, boolean)
  from public, anon;
grant execute on function public.create_live_session(uuid, text, uuid, timestamptz, boolean, boolean)
  to authenticated;

-- 5. run_live_start_fanout — 0144 body + the 0145 guard ---------------------------------
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
  -- 0145 (P7): «بدأ البث المباشر» goes to students only once live is on for
  -- everyone. A staff rehearsal ('staff' / 'off') sends nothing; the queue job
  -- is marked done (it is not held back for later).
  if public.live_enabled_level() <> 'all' then
    return;
  end if;

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

-- 6. admin_live_overview — 0143 body + the level in the result --------------------------
create or replace function public.admin_live_overview(p_recent int default 20)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_manager boolean := public.is_content_manager();
  v_limit   int     := least(greatest(coalesce(p_recent, 20), 1), 50);
  v_active  jsonb;
  v_sched   jsonb;
  v_recent  jsonb;
begin
  if not (v_manager or public.is_sheikh()) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  -- green + live: every staff member (the one D3 slot everybody shares).
  select coalesce(jsonb_agg(public.live_admin_session_json(t.id) order by t.sort_at), '[]'::jsonb)
    into v_active
    from (select s.id, coalesce(s.started_at, s.updated_at) as sort_at
            from public.live_sessions s
           where s.status in ('green', 'live')) t;

  select coalesce(jsonb_agg(public.live_admin_session_json(t.id) order by t.sort_at), '[]'::jsonb)
    into v_sched
    from (select s.id, s.scheduled_at as sort_at
            from public.live_sessions s
           where s.status = 'scheduled'
             and (v_manager or public.live_admin_is_mine(s.host_user_id, s.sheikh_id))
           order by s.scheduled_at
           limit 50) t;

  select coalesce(jsonb_agg(public.live_admin_session_json(t.id) order by t.sort_at desc), '[]'::jsonb)
    into v_recent
    from (select s.id, coalesce(s.ended_at, s.started_at, s.created_at) as sort_at
            from public.live_sessions s
           where s.status in ('ended', 'processing', 'ready', 'failed')
             and (v_manager or public.live_admin_is_mine(s.host_user_id, s.sheikh_id))
           order by coalesce(s.ended_at, s.started_at, s.created_at) desc
           limit v_limit) t;

  return jsonb_build_object(
    'active',       v_active,
    'scheduled',    v_sched,
    'recent',       v_recent,
    'is_manager',   v_manager,
    -- 0145 (P7): 'off' | 'staff' | 'all', for the screen to show.
    'live_enabled', public.live_enabled_level());
end;
$$;
revoke all on function public.admin_live_overview(int) from public, anon;
grant execute on function public.admin_live_overview(int) to authenticated;

-- 7. Seed: dark until an admin turns it on ----------------------------------------------
insert into public.app_config (key, value) values ('live_enabled', 'off')
on conflict (key) do nothing;
