-- =============================================================================
-- 0167_live_attendance.sql
-- المَحجّة البَيْضَاء — Live attendance tracking «حضور البث المباشر».
--
-- Per student × live session: did they attend, for how long, what share of the
-- live, and did they reach the completion threshold. A student who reached it
-- sees the session's published recording as an ordinary completed lecture ✓
-- (user_lecture_progress.completed), internally tagged completion_source='live'.
-- Recorded-lecture tracking (save_activity, 0090) is NOT changed.
--
-- Source of truth = LiveKit server webhooks, already delivered to the media
-- worker and forwarded to live_room_event (0138). No client heartbeat:
--   * identity  = live_identity(session, user) — deterministic, so every
--                 reconnect / second device of one student is the SAME identity
--                 (→ live_participants.user_id).
--   * conn_sid  = LiveKit participant sid (PA_…) — new for every connection
--                 (verified on prod 2026-11-08: one identity left + rejoined
--                 with PA_A495… → PA_i4LL…). One interval row per connection.
--   * joined_at = ParticipantInfo.joinedAtMs; left_at = the webhook's createdAt
--                 (LiveKit server clock, not delivery time).
-- LiveKit keeps ONE connection per identity (a second join disconnects the
-- first, DUPLICATE_IDENTITY), so a new join also closes any other still-open
-- interval of that student at the join time — this self-heals a lost
-- participant_left. room_finished closes everything still open.
--
-- Attended time = the UNION of the student's intervals clipped to
-- [live_sessions.started_at, ended_at] (overlaps — reconnect races, a second
-- device — count once; time in the green room before «ابدأ» or after the end
-- never counts). Computed once when the session gets ended_at (trigger), and
-- recomputed per student for any webhook that lands after the end.
--
--   attendance_pct = attended_sec / live_sec × 100   (stored rounded to 0.01)
--   qualified      = attended_sec × 100 >= threshold × live_sec   (exact, no rounding)
--
-- Threshold: live_completion_threshold_pct() — the ONLY place the default (70)
-- lives; app_config 'live_attendance_threshold_pct' (1–100) overrides it without
-- a migration. The value used is stored on each live_attendance row.
--
-- Completion: apply_live_completions(session) when the session's lecture is
-- published (track_live_lecture_publish, 0137 — extended here) or when
-- attendance is (re)computed while it already is. Qualified students get
-- completed = true, completed_at = the live's ended_at, completion_source =
-- 'live'. Rows already completed (e.g. from the recording) are left untouched.
-- A completion is never withdrawn. Students below the threshold get nothing
-- here and complete the recording the normal way. The buddy «أتم درساً اليوم»
-- nudge is suppressed for these writes (they land at publish time, possibly
-- days after the live, and would burst to every attendee's buddies at once).
--
-- Storage (db-storage-engineering): ~1 interval row per connection (~40–60 per
-- session today) + 1 attendance row per attendee; a few KB per session. Both
-- tables are business facts (intervals = the recompute source): no retention;
-- they cascade with the session. user_lecture_progress.completion_source is a
-- nullable column (metadata-only add; NULL = recording / legacy).
--
-- Load: no new client requests. The interval write happens inside the
-- live_room_event call each join/leave webhook already makes; finalisation is
-- one set-based statement per session.
--
-- Compatibility: live_room_event gains 3 defaulted params (old 4-arg calls from
-- the current worker keep working and simply record no intervals). Deploy this
-- migration BEFORE the new media worker; the worker also falls back to the
-- 4-arg call if the DB does not know the new signature yet (PGRST202).
--
-- Rollback (not applied anywhere yet): restore 0138 live_room_event (4-arg),
-- 0137 track_live_lecture_publish, 0082 notify_buddy_on_completion; drop
-- trigger live_sessions_attendance_on_end, functions live_completion_threshold_pct,
-- recompute_live_attendance, apply_live_completions, get_live_attendance,
-- live_sessions_attendance_on_end; drop tables live_attendance,
-- live_attendance_intervals. completion_source may stay (unused, nullable).
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Threshold ----------------------------------------------------------------------
create or replace function public.live_completion_threshold_pct()
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.pct
       from (select btrim(value)::numeric as pct
               from public.app_config
              where key = 'live_attendance_threshold_pct'
                and btrim(value) ~ '^[0-9]{1,3}(\.[0-9]{1,2})?$') v
      where v.pct between 1 and 100),
    70  -- the default live-completion threshold (%) — defined here only
  );
$$;
revoke all on function public.live_completion_threshold_pct() from public, anon, authenticated;
grant execute on function public.live_completion_threshold_pct() to service_role;

-- 2. Tables ------------------------------------------------------------------------
create table if not exists public.live_attendance_intervals (
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  conn_sid   text not null check (conn_sid ~ '^PA_[A-Za-z0-9]{1,64}$'),
  user_id    uuid not null references auth.users (id) on delete cascade,
  joined_at  timestamptz not null,
  left_at    timestamptz,
  primary key (session_id, conn_sid),
  constraint live_attendance_intervals_order check (left_at is null or left_at >= joined_at)
);
comment on table public.live_attendance_intervals is
  '0167: one row per LiveKit connection (participant sid) of a live session, from the server webhooks. Recompute source for live_attendance. Service role only.';
create index if not exists live_attendance_intervals_user_idx
  on public.live_attendance_intervals (user_id);
create index if not exists live_attendance_intervals_session_user_idx
  on public.live_attendance_intervals (session_id, user_id);

alter table public.live_attendance_intervals enable row level security;
revoke all on table public.live_attendance_intervals from public, anon, authenticated;
grant select, insert, update, delete on table public.live_attendance_intervals to service_role;

create table if not exists public.live_attendance (
  session_id     uuid not null references public.live_sessions (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  attended_sec   int not null check (attended_sec >= 0),
  live_sec       int not null check (live_sec > 0),
  attendance_pct numeric(5,2) not null check (attendance_pct between 0 and 100),
  threshold_pct  numeric(5,2) not null check (threshold_pct between 1 and 100),
  qualified      boolean not null,
  computed_at    timestamptz not null default now(),
  primary key (session_id, user_id),
  constraint live_attendance_bounded check (attended_sec <= live_sec)
);
comment on table public.live_attendance is
  '0167: per student × ended live session — attended seconds (union of connections clipped to the live), share, threshold used, qualified for live completion. Rebuildable from live_attendance_intervals (recompute_live_attendance). Staff read via get_live_attendance.';
create index if not exists live_attendance_user_idx on public.live_attendance (user_id);

alter table public.live_attendance enable row level security;
revoke all on table public.live_attendance from public, anon, authenticated;
grant select, insert, update, delete on table public.live_attendance to service_role;

-- 3. Completion source on progress (NULL = recording / legacy) ------------------------
alter table public.user_lecture_progress
  add column if not exists completion_source text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_lecture_progress_completion_source_check') then
    alter table public.user_lecture_progress
      add constraint user_lecture_progress_completion_source_check
      check (completion_source is null or completion_source in ('recording', 'live'));
  end if;
end $$;
comment on column public.user_lecture_progress.completion_source is
  '0167: ''live'' = completed by attending the live session (apply_live_completions); NULL = recording (save_activity) or legacy.';

-- 4. Apply completions -------------------------------------------------------------
create or replace function public.apply_live_completions(p_session uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  s     public.live_sessions%rowtype;
  v_n   int;
begin
  select * into s from public.live_sessions where id = p_session;
  if not found or s.lecture_id is null or s.lecture_published_at is null or s.ended_at is null then
    return 0;
  end if;
  if not exists (select 1 from public.lectures l where l.id = s.lecture_id and l.status = 'published') then
    return 0;
  end if;

  perform set_config('almahajja.live_completion', 'on', true);  -- buddy nudge off (see header)
  insert into public.user_lecture_progress as ulp
    (user_id, lecture_id, position_sec, completed, completed_at, completion_source)
  select a.user_id, s.lecture_id, 0, true, s.ended_at, 'live'
    from public.live_attendance a
   where a.session_id = s.id and a.qualified
  on conflict (user_id, lecture_id) do update
     set completed         = true,
         completed_at      = excluded.completed_at,
         completion_source = 'live'
   where not ulp.completed;      -- already completed (recording): untouched
  get diagnostics v_n = row_count;
  perform set_config('almahajja.live_completion', '', true);
  return v_n;
end;
$$;
revoke all on function public.apply_live_completions(uuid) from public, anon, authenticated;
grant execute on function public.apply_live_completions(uuid) to service_role;

-- 5. (Re)compute attendance --------------------------------------------------------
-- p_user NULL = every student with an interval in the session. Only for a session
-- with both started_at and ended_at (a still-live session has no final share).
-- Returns the number of attendance rows written.
create or replace function public.recompute_live_attendance(p_session uuid, p_user uuid default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  s        public.live_sessions%rowtype;
  v_live   int;
  v_thr    numeric := public.live_completion_threshold_pct();
  v_n      int;
begin
  select * into s from public.live_sessions where id = p_session;
  if not found or s.started_at is null or s.ended_at is null then
    return 0;
  end if;
  v_live := floor(extract(epoch from (s.ended_at - s.started_at)))::int;
  if v_live <= 0 then
    return 0;
  end if;

  with clipped as (
    select i.user_id,
           greatest(i.joined_at, s.started_at)                  as a,
           least(coalesce(i.left_at, s.ended_at), s.ended_at)   as b
      from public.live_attendance_intervals i
     where i.session_id = s.id
       and (p_user is null or i.user_id = p_user)
  ), marked as (
    -- gaps-and-islands: an interval starts a new island when it begins after
    -- every earlier interval (of that student) has ended.
    select user_id, a, b,
           case when a > max(b) over (partition by user_id order by a, b
                                      rows between unbounded preceding and 1 preceding)
                then 1 else 0 end as brk
      from clipped
     where b > a
  ), islands as (
    select user_id, a, b,
           sum(brk) over (partition by user_id order by a, b) as grp
      from marked
  ), merged as (
    select user_id, min(a) as a, max(b) as b
      from islands group by user_id, grp
  ), per_user as (
    select u.user_id,
           least(coalesce(floor(sum(extract(epoch from (m.b - m.a))))::int, 0), v_live) as att
      from (select distinct user_id from clipped) u
      left join merged m on m.user_id = u.user_id
     group by u.user_id
  )
  insert into public.live_attendance as la
    (session_id, user_id, attended_sec, live_sec, attendance_pct, threshold_pct, qualified, computed_at)
  select s.id, p.user_id, p.att, v_live,
         round(p.att * 100.0 / v_live, 2),
         v_thr,
         p.att * 100.0 >= v_thr * v_live,
         now()
    from per_user p
  on conflict (session_id, user_id) do update
     set attended_sec   = excluded.attended_sec,
         live_sec       = excluded.live_sec,
         attendance_pct = excluded.attendance_pct,
         threshold_pct  = excluded.threshold_pct,
         qualified      = excluded.qualified,
         computed_at    = excluded.computed_at;
  get diagnostics v_n = row_count;

  perform public.apply_live_completions(s.id);
  return v_n;
end;
$$;
revoke all on function public.recompute_live_attendance(uuid, uuid) from public, anon, authenticated;
grant execute on function public.recompute_live_attendance(uuid, uuid) to service_role;

-- 6. Finalise when the session ends ------------------------------------------------
create or replace function public.live_sessions_attendance_on_end()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_live_attendance(new.id);
  return null;
end;
$$;
revoke all on function public.live_sessions_attendance_on_end() from public, anon, authenticated;

drop trigger if exists live_sessions_attendance_on_end on public.live_sessions;
create trigger live_sessions_attendance_on_end
  after update of ended_at on public.live_sessions
  for each row
  when (old.ended_at is null and new.ended_at is not null and new.started_at is not null)
  execute function public.live_sessions_attendance_on_end();

-- 7. live_room_event + connection intervals ---------------------------------------
-- Same body as 0138, plus the interval bookkeeping (marked 0167). New params:
--   p_participant_sid  LiveKit participant sid (PA_…) of this connection
--   p_joined_at        ParticipantInfo.joinedAtMs of that connection
--   p_event_at         the webhook's createdAt
-- Timestamps outside [now − 1 day, now + 5 min] are ignored (→ now()).
drop function if exists public.live_room_event(text, text, text, int);

create or replace function public.live_room_event(
  p_room_name        text,
  p_event            text,
  p_identity         text default null,
  p_num_participants int  default null,
  p_participant_sid  text default null,
  p_joined_at        timestamptz default null,
  p_event_at         timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s              public.live_sessions%rowtype;
  p              public.live_participants%rowtype;
  v_is_host      boolean := false;
  v_host_present boolean;
  v_present      int;
  -- 0167
  v_at           timestamptz := case
                    when p_event_at between now() - interval '1 day' and now() + interval '5 minutes'
                      then p_event_at else now() end;
  v_join         timestamptz;
  v_sid          text := case when p_participant_sid ~ '^PA_[A-Za-z0-9]{1,64}$' then p_participant_sid end;
  v_tracked      boolean := false;
begin
  if p_event is null or p_event not in ('room_started', 'room_finished',
       'participant_joined', 'participant_left', 'track_published', 'track_unpublished') then
    raise exception 'unknown live room event %', p_event;
  end if;

  select * into s from public.live_sessions where room_name = p_room_name for update;
  if not found then
    return null;
  end if;

  v_join := case
              when p_joined_at between now() - interval '1 day' and now() + interval '5 minutes'
                then least(p_joined_at, v_at) else v_at end;

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
        -- 0167: one connection per identity — any other open one ended by now.
        if v_sid is not null then
          update public.live_attendance_intervals
             set left_at = greatest(joined_at, v_join)
           where session_id = s.id and user_id = p.user_id
             and conn_sid <> v_sid and left_at is null;
          insert into public.live_attendance_intervals as i (session_id, conn_sid, user_id, joined_at)
          values (s.id, v_sid, p.user_id, v_join)
          on conflict (session_id, conn_sid) do update
             set joined_at = least(i.joined_at, excluded.joined_at),
                 left_at   = case when i.left_at is null then null
                                  else greatest(i.left_at, least(i.joined_at, excluded.joined_at)) end;
          v_tracked := true;
        end if;
      elsif p_event = 'participant_left' then
        update public.live_participants
           set present        = false,
               left_at        = now(),
               spoke_seconds  = spoke_seconds + public.live_stint_seconds(speaking_since),
               speaking_since = null
         where session_id = s.id and user_id = p.user_id;
        -- 0167: close this connection (a left before its join — out of order — creates it closed).
        if v_sid is not null then
          insert into public.live_attendance_intervals as i (session_id, conn_sid, user_id, joined_at, left_at)
          values (s.id, v_sid, p.user_id, v_join, greatest(v_at, v_join))
          on conflict (session_id, conn_sid) do update
             set left_at = case
                             when i.left_at is null then greatest(excluded.left_at, i.joined_at)
                             else least(i.left_at, greatest(excluded.left_at, i.joined_at))
                           end;
          v_tracked := true;
        end if;
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
    -- 0167: every connection still open ends with the room.
    update public.live_attendance_intervals
       set left_at = greatest(joined_at, v_at)
     where session_id = s.id and left_at is null;
    if s.status = 'live' then
      perform public.set_live_session_status(s.id, 'ended');
    elsif s.status = 'green' then
      perform public.set_live_session_status(s.id, 'cancelled');
    end if;
  end if;

  -- 0167: a connection event after the end refines that student's final share.
  if v_tracked and s.ended_at is not null then
    perform public.recompute_live_attendance(s.id, p.user_id);
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
revoke all on function public.live_room_event(text, text, text, int, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.live_room_event(text, text, text, int, text, timestamptz, timestamptz)
  to service_role;

-- 8. Publish → live completions (0137 body + the 0167 call) ------------------------
create or replace function public.track_live_lecture_publish()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.live_session_id is null then
    return null;
  end if;
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    update public.live_sessions
       set lecture_published_at = now()
     where id = new.live_session_id and lecture_id = new.id;
    perform public.apply_live_completions(new.live_session_id);  -- 0167
  elsif tg_op = 'UPDATE'
        and old.status = 'published'
        and new.status is distinct from 'published' then
    update public.live_sessions
       set lecture_published_at = null
     where id = new.live_session_id and lecture_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function public.track_live_lecture_publish() from public, anon, authenticated;

-- 9. Buddy nudge: skip live completions (0082 body + the 0167 guard) ---------------
create or replace function public.notify_buddy_on_completion()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_buddy      uuid;
  v_pref       boolean;
  v_local_hour integer;
  v_gender     text;
  v_title      text;
begin
  if tg_op = 'UPDATE' and old.completed then
    return new;  -- already completed before this write
  end if;
  if not new.completed then
    return new;
  end if;
  -- 0167: completions applied from live attendance (at publish time) never nudge.
  if coalesce(current_setting('almahajja.live_completion', true), '') = 'on' then
    return new;
  end if;

  v_local_hour := extract(hour from now() + interval '3 hours')::int;
  if v_local_hour >= 23 or v_local_hour < 5 then return new; end if;

  select gender into v_gender from public.profiles where id = new.user_id;
  v_title := case when v_gender = 'female'
    then 'رفيقتك أتمت درساً اليوم، فلعلك تدركين نصيبك من الأجر'
    else 'رفيقك أتم درساً اليوم، فلعلك تدرك نصيبك من الأجر' end;

  for v_buddy in select public.buddies_of(new.user_id) loop
    -- recipient's per-type pref (missing row = ON)
    select enabled into v_pref from public.notification_prefs
     where user_id = v_buddy and type = 'buddy_activity';
    if not coalesce(v_pref, true) then continue; end if;

    -- at most one buddy_activity per recipient per local day
    if exists (
      select 1 from public.notifications
       where user_id = v_buddy and type = 'buddy_activity'
         and created_at >= date_trunc('day', now() + interval '3 hours') - interval '3 hours'
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_buddy,
      'buddy_activity',
      v_title,
      '',
      jsonb_build_object('route', '/(student)/journey')
    );
  end loop;
  return new;
exception when others then
  return new;  -- a nudge must never break a playback save
end;
$$;

-- 10. Staff read model (no UI yet) -------------------------------------------------
create or replace function public.get_live_attendance(p_session uuid)
returns table (
  user_id        uuid,
  display_name   text,
  attended_sec   int,
  live_sec       int,
  attendance_pct numeric,
  threshold_pct  numeric,
  qualified      boolean,
  connections    int,
  computed_at    timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_content_manager() or public.is_sheikh()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select a.user_id, lp.display_name, a.attended_sec, a.live_sec, a.attendance_pct,
         a.threshold_pct, a.qualified,
         (select count(*)::int from public.live_attendance_intervals i
           where i.session_id = a.session_id and i.user_id = a.user_id),
         a.computed_at
    from public.live_attendance a
    left join public.live_participants lp
      on lp.session_id = a.session_id and lp.user_id = a.user_id
   where a.session_id = p_session
   order by a.attended_sec desc;
end;
$$;
revoke all on function public.get_live_attendance(uuid) from public, anon, authenticated;
grant execute on function public.get_live_attendance(uuid) to authenticated;
