-- =============================================================================
-- 0155_staggered_push_and_live_join_context.sql
-- المَحجّة البَيْضَاء — LOAD V24 (part A, server only — helps every app version).
--
-- 2026-10-04 live test: the live_start push reached ~8k phones in ~75 s; the
-- app-open wave (only ~70 opens in 8 min, each ~30 server round trips) tipped
-- the Nano instance into swap thrash for 32 minutes. Two server-side cuts:
--
-- 1. Staggered broadcast pushes. Every shared push (fanout_to_all /
--    _for_section / _followers and the live start) is chunked as before (100
--    users per push_queue row) but the chunks are now released over up to
--    10 minutes (≤ 7 s apart, first chunk immediately), most recently active
--    users first. The open wave is spread instead of arriving in one minute.
--    push_queue.send_after = null keeps the old "send now" meaning (BATCH rows,
--    small sends); process_push_queue only takes rows that are due.
--
-- 2. live_join_context(p_session, p_user): everything live-token needs in ONE
--    service-role round trip (fresh ban/guest flags from auth.users, the rollout
--    flag, the profile, the session, the stored participant row, the section's
--    gender scope for the caller, the salted identity). Before: two GoTrue calls
--    + 6 PostgREST round trips per joiner. The rules stay in liveRules.ts.
--
-- Bodies are the live prod definitions (pg_get_functiondef, 2026-10-05) with
-- only the marked changes. Append-only. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1a. push_queue rows can wait ----------------------------------------------------------
alter table public.push_queue add column if not exists send_after timestamptz;
comment on column public.push_queue.send_after is
  '0155: null → send as soon as the paced worker gets to it; set → not before this time (staggered broadcast chunks).';
create index if not exists push_queue_due_idx
  on public.push_queue ((coalesce(send_after, created_at)), id) where sent_at is null;

-- 1b. push_to_users: chunks of 100, released over ≤ 10 min (caller orders p_users) ------
create or replace function public.push_to_users(p_users uuid[], p_payload jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_total  int := coalesce(array_length(p_users, 1), 0);
  c constant int := 100;
  v_chunks int;
  v_step   interval;
  i        int;
begin
  if v_total = 0 then
    return 0;
  end if;
  v_chunks := (v_total - 1) / c + 1;
  -- 0155: ≤ 7 s apart and the whole send within 10 minutes; chunk 0 goes now.
  v_step := least(interval '7 seconds', interval '10 minutes' / v_chunks);
  for i in 0 .. v_chunks - 1 loop
    insert into public.push_queue (ids, payload, send_after)
    values (p_users[i * c + 1 : least((i + 1) * c, v_total)],
            p_payload,
            case when i = 0 then null else now() + v_step * i end);
  end loop;
  return v_chunks;
end;
$$;
revoke all on function public.push_to_users(uuid[], jsonb) from public, anon, authenticated;

-- 1c. The fan-outs hand over the recipients most recently active first ------------------
create or replace function public.fanout_to_all(p_type notification_type, p_title text, p_body text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_users uuid[];
begin
  select array_agg(pr.id order by pr.last_opened_at desc nulls last) into v_users  -- 0155: order
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
  select array_agg(pr.id order by pr.last_opened_at desc nulls last) into v_users  -- 0155: order
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
  select array_agg(f.user_id order by pr.last_opened_at desc nulls last) into v_users  -- 0155: order
    from public.followers_of_section(p_section_id) f
    left join public.profiles pr on pr.id = f.user_id
    left join public.notification_prefs p
      on p.user_id = f.user_id and p.type = p_type
   where coalesce(p.enabled, true)
     and exists (select 1 from public.push_tokens t where t.user_id = f.user_id);
  perform public.push_to_users(v_users, jsonb_build_object(
    'type', p_type, 'title', p_title, 'body', coalesce(p_body, ''), 'data', coalesce(p_data, '{}'::jsonb)));
end;
$$;

-- 1d. live start: same recipients/guards as 0150, staggered through push_to_users -------
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

  select array_agg(pr.id order by pr.last_opened_at desc nulls last) into v_users  -- 0155: order
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

  -- 0155: chunked + staggered by push_to_users (was an inline all-at-once loop).
  perform public.push_to_users(v_users, jsonb_build_object(
    'type',  'live_start',
    'title', 'بدأ البث المباشر',
    'body',  left(v_body, 300),
    'data',  jsonb_build_object('route', '/live/' || s.id, 'liveSessionId', s.id)
  ));
end;
$$;
revoke all on function public.run_live_start_fanout(uuid) from public, anon, authenticated;

-- 1e. The paced sender takes only due rows (0151 body + the send_after gate) -------------
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
       and (send_after is null or send_after <= now())   -- 0155
     order by coalesce(send_after, created_at), id          -- 0155
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

-- 2. live_join_context: live-token's reads in one service-role round trip ---------------
create or replace function public.live_join_context(p_session uuid, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- null = no such auth user (deleted) → live-token answers unauthorized.
    'user', (select jsonb_build_object('banned_until', u.banned_until,
                                       'is_anonymous', coalesce(u.is_anonymous, false))
               from auth.users u where u.id = p_user),
    'flag', (select c.value from public.app_config c where c.key = 'live_enabled'),
    'profile', (select jsonb_build_object('role', p.role, 'gender', p.gender,
                                          'display_name', p.display_name)
                  from public.profiles p where p.id = p_user),
    'session', (select jsonb_build_object('id', s.id, 'status', s.status, 'room_name', s.room_name,
                                          'host_user_id', s.host_user_id, 'section_id', s.section_id,
                                          'allow_requests', s.allow_requests)
                  from public.live_sessions s where s.id = p_session),
    'stored', (select jsonb_build_object('role', lp.role, 'hidden_name', lp.hidden_name)
                 from public.live_participants lp
                where lp.session_id = p_session and lp.user_id = p_user),
    -- Same call live-token made with the caller's JWT (p_gender explicit, no auth.uid()).
    'visible', (select public.section_visible_to_viewer(
                         s.section_id,
                         (select p.gender from public.profiles p where p.id = p_user))
                  from public.live_sessions s where s.id = p_session),
    'identity', public.live_identity(p_session, p_user)
  );
$$;
revoke all on function public.live_join_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.live_join_context(uuid, uuid) to service_role;
