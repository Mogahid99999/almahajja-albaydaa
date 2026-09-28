-- =============================================================================
-- 0138_live_rpcs.sql
-- المَحجّة البَيْضَاء — V23 P2: the «البث المباشر» RPCs and the media-worker
-- hand-off for live recordings.
--
-- (PLAN_LIVE_V23 §4 "0137_live_rpcs" + §5 needs. Requires 0134–0137.
-- Notifications are NOT here: live_start / live_reminder / live_invite, the
-- reminders cron, set_live_reminder and invite_buddy_to_live are P5 —
-- 0139_live_notifications.sql, which hooks in with its own trigger; nothing
-- below depends on it.)
--
-- Client RPCs (authenticated unless noted):
--   create_live_session(section, title, sheikh, scheduled_at, notify, allow_requests)
--                                       content manager or sheikh → scheduled | green
--   cancel_live_session(session)        content manager, or the hosting sheikh
--   finalize_live_lecture(lecture, title, sheikh)   content manager
--   retry_live_recording(session)       content manager — after a failed job
--   get_live_participants(session)      staff (content manager or sheikh): real
--                                       names incl. hidden sisters (D2, changed)
--   get_live_now()                      anyone signed in (guests too)
--   get_live_by_code(code)              anyone, incl. anon (share fallback page)
--   (enqueue_lecture_transcode lives in 0132, re-signed in 0133.)
--
-- Service-role RPCs (edge functions live-control / live-token and the worker):
--   set_live_session_status(session, status, egress_id)  lifecycle
--   enqueue_live_recording(room_name, egress_id, raw_path) egress file → job
--   live_job_naming(job)                                  names for the output key
--   create_live_lecture(job, output_key, duration, size, raw_backup_key)
--   live_room_event(room_name, event, identity, num_participants)  webhooks, D4
--   live_raws_due_for_deletion() / mark_live_raw_deleted(session)  owner rule
--   (live_identity / live_gender_code live in 0135.)
--
-- Owner rule — a live recording is never lost: the raw stays on the VPS disk
-- (raw_path) through every failure; a staff retry re-queues it; the worker deletes
-- it only when live_raws_due_for_deletion lists it (lecture published ≥ 7 days,
-- R2 backup recorded) and then calls mark_live_raw_deleted.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- =============================================================================
-- 1. Internal helpers
-- =============================================================================

-- 6 chars from an unambiguous 31-char alphabet (no 0/O/1/I/L), unused so far.
-- Bytes 0–5 of a v4 UUID are fully random (gen_random_uuid is CSPRNG-backed).
create or replace function public.live_new_share_code()
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  a constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  b     bytea;
  c     text;
  i     int;
  tries int := 0;
begin
  loop
    b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    c := '';
    for i in 0..5 loop
      c := c || substr(a, 1 + (get_byte(b, i) % 31), 1);
    end loop;
    exit when not exists (select 1 from public.live_sessions where share_code = c);
    tries := tries + 1;
    if tries > 20 then
      raise exception 'could not allocate a share code';
    end if;
  end loop;
  return c;
end;
$$;
revoke all on function public.live_new_share_code() from public, anon, authenticated;

-- D3 pre-check with a friendly message; live_sessions_one_active (0134) is the
-- real guard. A green room nobody started within 3 h would hold the only slot
-- forever, so it is cancelled first.
create or replace function public.live_assert_no_active(p_except uuid default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.live_sessions
     set status = 'cancelled'
   where status = 'green'
     and updated_at < now() - interval '3 hours'
     and (p_except is null or id <> p_except);

  if exists (
    select 1 from public.live_sessions
     where status in ('green', 'live')
       and (p_except is null or id <> p_except)
  ) then
    raise exception 'يوجد بث مباشر قائم الآن، ولا يمكن فتح بث آخر في الوقت نفسه';
  end if;
end;
$$;
revoke all on function public.live_assert_no_active(uuid) from public, anon, authenticated;

-- Seconds spoken so far in the current mic stint.
create or replace function public.live_stint_seconds(p_since timestamptz)
returns int
language sql stable set search_path = public as $$
  select case when p_since is null then 0
              else greatest(0, round(extract(epoch from now() - p_since)))::int end;
$$;
revoke all on function public.live_stint_seconds(timestamptz) from public, anon, authenticated;

-- =============================================================================
-- 2. Staff RPCs
-- =============================================================================

-- create_live_session — from the section page (decision 4). No scheduled time
-- ⇒ 'green' (straight to the host's green room, D3-checked); otherwise
-- 'scheduled'. A sheikh with no p_sheikh gets their own sheikhs row.
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

-- cancel_live_session — scheduled or green only (a live session ends through
-- live-control, which also stops the egress). Content managers may cancel any;
-- a sheikh only the sessions they host.
create or replace function public.cancel_live_session(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.live_sessions%rowtype;
begin
  if not (public.is_content_manager() or public.is_sheikh()) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select * into s from public.live_sessions where id = p_session for update;
  if not found then
    raise exception 'المجلس غير موجود';
  end if;
  if not public.is_content_manager() and s.host_user_id is distinct from auth.uid() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if s.status not in ('scheduled', 'green') then
    raise exception 'لا يمكن إلغاء مجلس بدأ أو انتهى';
  end if;
  update public.live_sessions set status = 'cancelled' where id = p_session;
end;
$$;
revoke all on function public.cancel_live_session(uuid) from public, anon;
grant execute on function public.cancel_live_session(uuid) to authenticated;

-- finalize_live_lecture — the two required fields of «واردة» (§8): final title +
-- sheikh. Clears review_state; publishing stays the normal path (0123/0129).
create or replace function public.finalize_live_lecture(
  p_lecture uuid,
  p_title   text,
  p_sheikh  uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'العنوان بين ٣ و٢٠٠ حرف';
  end if;
  if p_sheikh is null or not exists (select 1 from public.sheikhs where id = p_sheikh) then
    raise exception 'اختر الشيخ';
  end if;
  update public.lectures
     set title = v_title, sheikh_id = p_sheikh, review_state = null
   where id = p_lecture and source = 'live';
  if not found then
    raise exception 'المحاضرة غير موجودة أو ليست من بث مباشر';
  end if;
end;
$$;
revoke all on function public.finalize_live_lecture(uuid, text, uuid) from public, anon;
grant execute on function public.finalize_live_lecture(uuid, text, uuid) to authenticated;

-- retry_live_recording — staff re-queue after the recording job failed for good.
-- The raw file is still on the VPS disk (never deleted on failure).
create or replace function public.retry_live_recording(p_session uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s    public.live_sessions%rowtype;
  j    public.media_jobs%rowtype;
  v_id uuid;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select * into s from public.live_sessions where id = p_session for update;
  if not found then
    raise exception 'المجلس غير موجود';
  end if;
  if s.raw_path is null or s.raw_deleted_at is not null then
    raise exception 'لا يوجد تسجيل خام لهذا المجلس';
  end if;

  select * into j
    from public.media_jobs
   where live_session_id = s.id and kind = 'live_recording'
   order by created_at desc
   limit 1;
  if found and j.status in ('queued', 'running') then
    raise exception 'تجري معالجة التسجيل الآن';
  end if;
  if not found or j.status <> 'failed' or s.status <> 'failed' then
    raise exception 'لا تُعاد المعالجة إلا بعد تعذّرها';
  end if;

  update public.live_sessions set status = 'processing' where id = s.id;
  insert into public.media_jobs (kind, input_key, live_session_id, created_by)
  values ('live_recording', s.raw_path, s.id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.retry_live_recording(uuid) from public, anon;
grant execute on function public.retry_live_recording(uuid) to authenticated;

-- get_live_participants — D2 (changed 2026-09-28): staff see every real name,
-- including sisters who chose «بدون اسم» (hidden_name = true). Nobody else can
-- read live_participants at all.
create or replace function public.get_live_participants(p_session uuid)
returns table (
  identity      text,
  display_name  text,
  hidden_name   boolean,
  gender        text,
  role          text,
  joined_at     timestamptz,
  left_at       timestamptz,
  spoke_seconds int
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.is_content_manager() or public.is_sheikh()) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  return query
    select p.identity, p.display_name, p.hidden_name, p.gender, p.role,
           p.joined_at, p.left_at,
           p.spoke_seconds + public.live_stint_seconds(p.speaking_since)
      from public.live_participants p
     where p.session_id = p_session
     order by p.joined_at, p.identity;
end;
$$;
revoke all on function public.get_live_participants(uuid) from public, anon;
grant execute on function public.get_live_participants(uuid) to authenticated;

-- =============================================================================
-- 3. Student / guest RPCs
-- =============================================================================

-- get_live_now — Home card + section pin: the live session (if the viewer's
-- gender scope allows it), the next 3 scheduled with my «ذكّرني» flag, and for
-- staff the current green room (to get back into it).
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

-- get_live_by_code — share links (§9.3). Callable with the bare anon key (the
-- static fallback page). Public status is coarse: scheduled | live | ended.
-- A session in a gender-scoped section the caller can't see (always the case
-- for anon) returns only {restricted:true, status} — never its title.
create or replace function public.get_live_by_code(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_code   text := upper(btrim(coalesce(p_code, '')));
  s        record;
  v_status text;
  v_gender text;
begin
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

-- =============================================================================
-- 4. Service-role RPCs: live-control lifecycle
-- =============================================================================

-- set_live_session_status — the only way a session moves between
-- scheduled / green / live / ended / cancelled. Idempotent (same status ⇒ row
-- returned unchanged). Side effects:
--   → green : D3 (friendly check + the unique index)
--   → live  : started_at, egress_id
--   → ended : ended_at; if the egress already reported its file while the
--             session was live (enqueue_live_recording deferred it), the
--             recording job is queued now and the session goes to processing
-- processing / ready / failed are driven by the media job, not by this RPC.
-- (P5's 0139 adds the live_start / live_reminder fan-outs through its own
-- trigger on the → live transition.)
create or replace function public.set_live_session_status(
  p_session   uuid,
  p_status    public.live_status,
  p_egress_id text default null
)
returns public.live_sessions
language plpgsql security definer set search_path = public as $$
declare
  s     public.live_sessions%rowtype;
  v_ok  boolean;
  v_con text;
begin
  select * into s from public.live_sessions where id = p_session for update;
  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;
  if s.status = p_status then
    return s;
  end if;

  v_ok := case s.status
            when 'scheduled' then p_status in ('green', 'cancelled')
            when 'green'     then p_status in ('live', 'cancelled')
            when 'live'      then p_status = 'ended'
            else false
          end;
  if not v_ok then
    raise exception 'invalid live transition % → %', s.status, p_status;
  end if;

  if p_status = 'green' then
    perform public.live_assert_no_active(p_session);
  end if;

  begin
    update public.live_sessions
       set status     = p_status,
           started_at = case when p_status = 'live' then now() else started_at end,
           ended_at   = case when p_status = 'ended' then now() else ended_at end,
           egress_id  = coalesce(nullif(btrim(p_egress_id), ''), egress_id)
     where id = p_session
    returning * into s;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'live_sessions_one_active' then
      raise exception 'يوجد بث مباشر قائم الآن، ولا يمكن فتح بث آخر في الوقت نفسه';
    end if;
    raise;
  end;

  if p_status = 'ended' and s.raw_path is not null
     and not exists (select 1 from public.media_jobs
                      where live_session_id = s.id and kind = 'live_recording') then
    update public.live_sessions set status = 'processing' where id = s.id
    returning * into s;
    insert into public.media_jobs (kind, input_key, live_session_id, created_by)
    values ('live_recording', s.raw_path, s.id, s.host_user_id);
  end if;

  return s;
end;
$$;
revoke all on function public.set_live_session_status(uuid, public.live_status, text)
  from public, anon, authenticated;
grant execute on function public.set_live_session_status(uuid, public.live_status, text)
  to service_role;

-- live_room_event — the worker forwards LiveKit webhooks (§5.4). Keeps
-- peak_listeners and live_participants (present / left_at / spoke_seconds)
-- current, and is the safety net for a room that closes without `end`
-- (live → ended, green → cancelled). Returns
-- {session_id, status, is_host, host_present} for the worker's D4 timer
-- (10 min without the host ⇒ end), or NULL for a room this env doesn't know.
-- track_published / track_unpublished are the participant's MICROPHONE track.
create or replace function public.live_room_event(
  p_room_name        text,
  p_event            text,
  p_identity         text default null,
  p_num_participants int  default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s              public.live_sessions%rowtype;
  p              public.live_participants%rowtype;
  v_is_host      boolean := false;
  v_host_present boolean;
  v_present      int;
begin
  if p_event is null or p_event not in ('room_started', 'room_finished',
       'participant_joined', 'participant_left', 'track_published', 'track_unpublished') then
    raise exception 'unknown live room event %', p_event;
  end if;

  select * into s from public.live_sessions where room_name = p_room_name for update;
  if not found then
    return null;
  end if;

  if p_identity is not null then
    select * into p from public.live_participants
     where session_id = s.id and identity = p_identity
     for update;
    if found then
      v_is_host := coalesce(p.role = 'host' or p.user_id = s.host_user_id, false);
      if p_event = 'participant_joined' then
        update public.live_participants
           set present = true, left_at = null
         where session_id = s.id and user_id = p.user_id;
      elsif p_event = 'participant_left' then
        update public.live_participants
           set present        = false,
               left_at        = now(),
               spoke_seconds  = spoke_seconds + public.live_stint_seconds(speaking_since),
               speaking_since = null
         where session_id = s.id and user_id = p.user_id;
      elsif p_event = 'track_published' then
        update public.live_participants
           set present = true, speaking_since = coalesce(speaking_since, now())
         where session_id = s.id and user_id = p.user_id;
      elsif p_event = 'track_unpublished' then
        update public.live_participants
           set spoke_seconds  = spoke_seconds + public.live_stint_seconds(speaking_since),
               speaking_since = null
         where session_id = s.id and user_id = p.user_id;
      end if;
    end if;
  end if;

  if p_event = 'room_finished' then
    update public.live_participants
       set present        = false,
           left_at        = coalesce(left_at, now()),
           spoke_seconds  = spoke_seconds + public.live_stint_seconds(speaking_since),
           speaking_since = null
     where session_id = s.id
       and (present or speaking_since is not null or left_at is null);
    if s.status = 'live' then
      perform public.set_live_session_status(s.id, 'ended');
    elsif s.status = 'green' then
      perform public.set_live_session_status(s.id, 'cancelled');
    end if;
  end if;

  select count(*)::int into v_present
    from public.live_participants where session_id = s.id and present;
  if greatest(coalesce(p_num_participants, 0), v_present) > s.peak_listeners then
    update public.live_sessions
       set peak_listeners = greatest(coalesce(p_num_participants, 0), v_present)
     where id = s.id;
  end if;

  select * into s from public.live_sessions where id = s.id;
  select exists (
    select 1 from public.live_participants lp
     where lp.session_id = s.id and lp.present
       and (lp.role = 'host' or lp.user_id is not distinct from s.host_user_id)
  ) into v_host_present;

  return jsonb_build_object(
    'session_id',   s.id,
    'status',       s.status,
    'is_host',      v_is_host,
    'host_present', v_host_present);
end;
$$;
revoke all on function public.live_room_event(text, text, text, int) from public, anon, authenticated;
grant execute on function public.live_room_event(text, text, text, int) to service_role;

-- =============================================================================
-- 5. Service-role RPCs: media worker
-- =============================================================================

-- enqueue_live_recording — the worker on LiveKit `egress_ended`. p_raw_path is
-- the egress file on the VPS disk: /recordings/<stg|prd>/<room>-<time>.ogg (the
-- env must match this database). media_jobs.input_key = that path.
-- Idempotent for a redelivered webhook (same path ⇒ same job id). One recording
-- job per session (a retry re-uses the same path). Returns NULL while the session
-- is still `live` (the egress died mid-session): the path is recorded and the job
-- is queued when the session ends, so a live room is never flipped to processing
-- underneath its listeners.
create or replace function public.enqueue_live_recording(
  p_room_name text,
  p_egress_id text,
  p_raw_path  text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_path text := btrim(coalesce(p_raw_path, ''));
  v_env  text;
  s      public.live_sessions%rowtype;
  j      public.media_jobs%rowtype;
  v_id   uuid;
begin
  select left(room_prefix, 3) into v_env from public.live_config;
  if v_path not like '/recordings/' || coalesce(v_env, '?') || '/_%'
     or position('..' in v_path) > 0
     or length(v_path) > 512 then
    raise exception 'invalid raw path (expected /recordings/%/…)', v_env;
  end if;
  select * into s from public.live_sessions where room_name = p_room_name for update;
  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;

  select * into j
    from public.media_jobs
   where live_session_id = s.id and kind = 'live_recording'
   order by created_at desc
   limit 1;
  if found then
    if j.input_key = v_path then
      return j.id;
    end if;
    raise exception 'a recording job already exists for this session';
  end if;
  if s.raw_path is not null and s.raw_path <> v_path then
    raise exception 'a different recording is already registered for this session';
  end if;

  if s.status = 'live' then
    update public.live_sessions
       set raw_path  = v_path,
           egress_id = coalesce(nullif(btrim(p_egress_id), ''), egress_id)
     where id = s.id;
    return null;
  end if;
  if s.status <> 'ended' then
    raise exception 'live session is not recordable (status %)', s.status;
  end if;

  update public.live_sessions
     set status    = 'processing',
         raw_path  = v_path,
         egress_id = coalesce(nullif(btrim(p_egress_id), ''), egress_id)
   where id = s.id;

  insert into public.media_jobs (kind, input_key, live_session_id, created_by)
  values ('live_recording', v_path, s.id, s.host_user_id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.enqueue_live_recording(text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_live_recording(text, text, text) to service_role;

-- live_job_naming — what the worker needs to build the lecture's R2 key
-- (the V13 section/lesson-named scheme). title = the session's preliminary title.
create or replace function public.live_job_naming(p_job uuid)
returns table (section_title text, title text, room_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
    select sec.title, s.title, s.room_name
      from public.media_jobs j
      join public.live_sessions s on s.id = j.live_session_id
      join public.sections sec on sec.id = s.section_id
     where j.id = p_job and j.kind = 'live_recording';
  if not found then
    raise exception 'live recording job not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.live_job_naming(uuid) from public, anon, authenticated;
grant execute on function public.live_job_naming(uuid) to service_role;

-- create_live_lecture — the worker's "complete" for a live_recording job.
-- Atomic: draft lecture (section = session section, next order, sheikh
-- pre-filled, review_state 'needs_title', source 'live') + session ready
-- (lecture_id, raw_backup_key) + job done + staff inbox notice.
-- p_raw_backup_key: the R2 copy of the raw (live-raw/<basename>); null means
-- no backup — the local raw is then never listed for deletion.
-- Idempotent: a retried call after a lost response returns the same lecture.
create or replace function public.create_live_lecture(
  p_job            uuid,
  p_output_key     text,
  p_duration_sec   int,
  p_size_bytes     bigint,
  p_raw_backup_key text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_backup text := nullif(btrim(coalesce(p_raw_backup_key, '')), '');
  j        public.media_jobs%rowtype;
  s        public.live_sessions%rowtype;
  v_order  int;
  v_id     uuid;
begin
  if coalesce(btrim(p_output_key), '') = '' then
    raise exception 'output key is required';
  end if;
  if (p_duration_sec is not null and p_duration_sec < 0)
     or (p_size_bytes is not null and p_size_bytes < 0) then
    raise exception 'invalid duration / size';
  end if;
  if v_backup is not null
     and (v_backup not like 'live-raw/_%' or position('..' in v_backup) > 0) then
    raise exception 'invalid raw backup key (expected live-raw/…)';
  end if;

  select * into j from public.media_jobs where id = p_job for update;
  if not found then
    raise exception 'media job not found' using errcode = 'P0002';
  end if;
  if j.kind <> 'live_recording' then
    raise exception 'not a live_recording job';
  end if;
  if j.live_session_id is null then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;

  select * into s from public.live_sessions where id = j.live_session_id for update;
  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;

  if j.status = 'done' and s.lecture_id is not null then
    if v_backup is not null and s.raw_backup_key is null then
      update public.live_sessions set raw_backup_key = v_backup where id = s.id;
    end if;
    return s.lecture_id;  -- duplicate call after a lost response
  end if;
  if j.status <> 'running' then
    raise exception 'media job is not running (status %)', j.status;
  end if;

  if s.lecture_id is null then
    select coalesce(max(l."order"), 0) + 1 into v_order
      from public.lectures l where l.section_id = s.section_id;

    insert into public.lectures
      (title, audio_path, duration_sec, audio_size_bytes, "order", status,
       section_id, sheikh_id, source, live_session_id, review_state)
    values
      (s.title, p_output_key, p_duration_sec, p_size_bytes, v_order, 'draft',
       s.section_id, s.sheikh_id, 'live', s.id, 'needs_title')
    returning id into v_id;
  else
    v_id := s.lecture_id;
  end if;

  update public.live_sessions
     set status         = 'ready',
         lecture_id     = v_id,
         raw_backup_key = coalesce(v_backup, raw_backup_key)
   where id = s.id;

  update public.media_jobs
     set status       = 'done',
         progress     = 1,
         output_key   = p_output_key,
         lecture_id   = v_id,
         finished_at  = now(),
         heartbeat_at = now(),
         error        = null
   where id = p_job;

  -- Staff inbox (content managers can finalize). Best-effort.
  begin
    insert into public.notifications (user_id, type, title, body, data)
    select p.id,
           'content_reported',
           'تسجيل المجلس جاهز للمراجعة',
           left('«' || s.title || '» — أكمِل العنوان النهائي والشيخ ثم انشره.', 300),
           jsonb_build_object('route', '/admin/unclassified', 'liveSessionId', s.id)
      from public.profiles p
     where p.role in ('admin', 'publisher');
  exception when others then
    null;
  end;

  return v_id;
end;
$$;
revoke all on function public.create_live_lecture(uuid, text, int, bigint, text)
  from public, anon, authenticated;
grant execute on function public.create_live_lecture(uuid, text, int, bigint, text)
  to service_role;

-- live_raws_due_for_deletion — the ONLY list the worker may delete local raws
-- from: lecture currently published for ≥ 7 days, R2 backup recorded, not yet
-- deleted.
create or replace function public.live_raws_due_for_deletion()
returns table (session_id uuid, raw_path text, raw_backup_key text)
language sql stable security definer set search_path = public as $$
  select s.id, s.raw_path, s.raw_backup_key
    from public.live_sessions s
    join public.lectures l on l.id = s.lecture_id
   where s.raw_path is not null
     and s.raw_deleted_at is null
     and s.raw_backup_key is not null
     and s.lecture_published_at is not null
     and s.lecture_published_at <= now() - interval '7 days'
     and l.status = 'published'
   order by s.lecture_published_at;
$$;
revoke all on function public.live_raws_due_for_deletion() from public, anon, authenticated;
grant execute on function public.live_raws_due_for_deletion() to service_role;

-- mark_live_raw_deleted — after the worker deleted the local raw. Refuses a
-- session without an R2 backup (the raw would then be gone for good).
create or replace function public.mark_live_raw_deleted(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.live_sessions%rowtype;
begin
  select * into s from public.live_sessions where id = p_session for update;
  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;
  if s.raw_backup_key is null then
    raise exception 'no R2 backup recorded for this session — keep the raw';
  end if;
  update public.live_sessions
     set raw_deleted_at = coalesce(raw_deleted_at, now())
   where id = p_session;
end;
$$;
revoke all on function public.mark_live_raw_deleted(uuid) from public, anon, authenticated;
grant execute on function public.mark_live_raw_deleted(uuid) to service_role;

-- A live_recording job that fails for good marks its session 'failed' (the raw
-- recording is kept on disk; retry_live_recording re-queues it).
create or replace function public.sync_live_session_on_job_failure()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'live_recording'
     and new.live_session_id is not null
     and new.status = 'failed'
     and old.status is distinct from 'failed' then
    update public.live_sessions
       set status = 'failed'
     where id = new.live_session_id and status = 'processing';
  end if;
  return null;
end;
$$;
revoke all on function public.sync_live_session_on_job_failure() from public, anon, authenticated;

drop trigger if exists media_jobs_sync_live_session on public.media_jobs;
create trigger media_jobs_sync_live_session
  after update of status on public.media_jobs
  for each row execute function public.sync_live_session_on_job_failure();
