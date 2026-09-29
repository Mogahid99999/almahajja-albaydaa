-- =============================================================================
-- 0146_live_recording_parts.sql
-- المَحجّة البَيْضَاء — V23 hardening: a live recording survives an egress crash.
--
-- Owner rule (PLAN_LIVE_V23 §1.1 #12): «A live recording is never lost».
-- Drill (staging, 2026-09-29): `docker kill almahajja-egress` mid-session →
-- no egress_ended webhook, the rest of the session unrecorded, the partial
-- .ogg left in the egress tmp dir, and the session stuck `ended` (egress_id set,
-- raw_path null, no job, nothing shown).
--
-- Model: a session's recording is now 1..n PARTS, one per egress.
--   * `start` → set_live_session_status(live, egress) registers part 1
--     (the normal single-egress path = one part; nothing else changes for it).
--   * The media worker watches every `recording` part (live_recording_watch):
--     an egress that died (FAILED/ABORTED webhook, LiveKit says ended/unknown,
--     it left the room, or the session ended long ago) is marked `dead`; its
--     partial file is copied from the egress tmp dir into
--     /recordings/<env>/ (`recovered`) or, if nothing exists, the part is `lost`.
--   * Still `live` → the worker calls live-control `resume_recording`
--     (service role only), which starts a new egress with the same settings and
--     registers it here (add_live_recording_part) — the recording continues.
--   * The recording job starts only when the session is `ended` AND every part
--     is settled (complete | recovered | lost). It concatenates every part with
--     a file, in seq order, and backs up EACH part to R2 live-raw/.
--   * Local raws are deleted only after EVERY part of the session is backed up
--     (live_part_raws_due_for_deletion; sessions with parts are no longer in
--     0139's session-level list).
--   * No part at all could be recovered → the session goes `failed` with an
--     Arabic error on a failed live_recording job (live_admin_session_json, 0143,
--     already shows the latest job's error on the admin «البث المباشر» page)
--     and staff get an inbox notice. Never silently `ended`.
--
-- Part status:
--   recording  egress believed to be running (no file yet)
--   dead       egress confirmed dead; recovery of its partial file pending
--   complete   egress ended cleanly; raw_path = its final file
--   recovered  partial file recovered after a crash; raw_path = the copy
--   lost       egress dead and no file anywhere
--   transitions: recording → dead|complete|recovered|lost · dead → complete|
--   recovered|lost · lost → complete|recovered (late file) · recovered →
--   complete (the egress did finish after all). Same status + same path = no-op.
--
-- Objects:
--   table live_recording_parts (service role only: RLS on, no client grants)
--   live_moderation_log.action check + 'resume_recording'
--   live_recording_enqueue_if_ready(session, final)   internal (no grants)
--   register_live_recording_part(room, egress, raw, status, bytes)  service role
--   add_live_recording_part(session, egress)                        service role
--   live_recording_watch()                                          service role
--   settle_live_recording(session)                                  service role
--   mark_live_part_backed_up(session, seq, key)                     service role
--   mark_live_part_raw_deleted(session, seq)                        service role
--   live_part_raws_due_for_deletion()                               service role
--   Replaced (latest body verbatim + the marked change):
--     set_live_session_status  ← 0138_live_rpcs.sql (part 1 on → live; the
--                                ended block now calls live_recording_enqueue_if_ready)
--     enqueue_live_recording   ← 0138_live_rpcs.sql (now delegates to
--                                register_live_recording_part; same signature)
--     live_raws_due_for_deletion ← 0139_live_raw_retention.sql (+ skips
--                                sessions that have parts)
--   Unchanged and still correct with parts: retry_live_recording,
--   create_live_lecture, mark_live_raw_deleted, live_room_event (0138).
--
-- Backfill: every live/ended session with an egress and no recording job gets
-- its part 1 (the drill's stuck staging session included — the worker then
-- recovers it, or fails it loudly).
--
-- Append-only (0001–0145 are never edited). Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Parts table ----------------------------------------------------------------------
create table if not exists public.live_recording_parts (
  session_id     uuid not null references public.live_sessions (id) on delete cascade,
  seq            int  not null check (seq between 1 and 50),
  egress_id      text not null unique check (egress_id ~ '^EG_[A-Za-z0-9]{1,64}$'),
  status         text not null default 'recording'
                 check (status in ('recording', 'dead', 'complete', 'recovered', 'lost')),
  raw_path       text check (raw_path is null or (raw_path like '/recordings/%' and position('..' in raw_path) = 0)),
  raw_backup_key text check (raw_backup_key is null or raw_backup_key like 'live-raw/%'),
  raw_deleted_at timestamptz,
  bytes          bigint check (bytes is null or bytes >= 0),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (session_id, seq),
  -- a file exactly when the part is complete / recovered
  constraint live_recording_parts_raw_matches_status
    check ((status in ('complete', 'recovered')) = (raw_path is not null)),
  constraint live_recording_parts_backup_needs_raw
    check (raw_backup_key is null or raw_path is not null)
);

comment on table public.live_recording_parts is
  'V23: one row per LiveKit egress of a live session (0146). The recording job concatenates every part with a file in seq order. Service role only (media worker + live-control).';

-- One file never belongs to two parts (a double reference would duplicate audio).
create unique index if not exists live_recording_parts_raw_path_key
  on public.live_recording_parts (raw_path)
  where raw_path is not null;
create index if not exists live_recording_parts_open_idx
  on public.live_recording_parts (session_id)
  where status in ('recording', 'dead');

drop trigger if exists live_recording_parts_set_updated_at on public.live_recording_parts;
create trigger live_recording_parts_set_updated_at
  before update on public.live_recording_parts
  for each row execute function public.set_updated_at();

alter table public.live_recording_parts enable row level security;
revoke all on table public.live_recording_parts from public, anon, authenticated;
grant select, insert, update, delete on table public.live_recording_parts to service_role;

-- 2. Audit: live-control `resume_recording` (service role) ------------------------------
alter table public.live_moderation_log
  drop constraint if exists live_moderation_log_action_check;
alter table public.live_moderation_log
  add constraint live_moderation_log_action_check check (action in (
    'open_green', 'start', 'end', 'cancel', 'approve', 'reject',
    'mute', 'demote', 'step_down', 'set_allow_requests', 'host_leave',
    'auto_end', 'resume_recording'));

-- 3. Backfill part 1 for sessions still waiting for their recording ------------------
insert into public.live_recording_parts
  (session_id, seq, egress_id, status, raw_path, started_at, ended_at)
select s.id, 1, s.egress_id,
       case when s.raw_path is not null then 'complete' else 'recording' end,
       s.raw_path,
       coalesce(s.started_at, s.created_at),
       case when s.raw_path is not null then coalesce(s.ended_at, now()) end
  from public.live_sessions s
 where s.status in ('live', 'ended')
   and s.egress_id ~ '^EG_[A-Za-z0-9]{1,64}$'
   and not exists (select 1 from public.media_jobs j
                    where j.live_session_id = s.id and j.kind = 'live_recording')
   and not exists (select 1 from public.live_recording_parts p where p.session_id = s.id)
on conflict do nothing;

-- =============================================================================
-- 4. Internal: queue the recording job once everything is settled
-- =============================================================================
-- Returns the session's recording job id (existing or new), or NULL while it
-- must wait (session still live / a part still recording or dead / pre-0146
-- session whose egress file has not arrived).
-- p_final (the worker's backstop, settle_live_recording): a pre-0146 session
-- with no parts and no file is failed instead of waiting forever.
-- Nothing recoverable at all → session `failed` + a failed live_recording job
-- carrying the Arabic error (shown on the admin page) + staff inbox notice.
create or replace function public.live_recording_enqueue_if_ready(
  p_session uuid,
  p_final   boolean default false
)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  s       public.live_sessions%rowtype;
  v_job   uuid;
  v_parts int;
  v_open  int;
  v_first text;
  v_id    uuid;
  v_error constant text :=
    'تعذّر حفظ تسجيل هذا المجلس: توقّف خادم التسجيل ولم يُعثر على أي جزء من ملف التسجيل.';
begin
  select * into s from public.live_sessions where id = p_session for update;
  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;

  select j.id into v_job
    from public.media_jobs j
   where j.live_session_id = s.id and j.kind = 'live_recording'
   order by j.created_at desc
   limit 1;
  if v_job is not null then
    return v_job;  -- one recording job per session (a staff retry queues the next)
  end if;
  if s.status <> 'ended' then
    return null;   -- still live: the job starts when the session ends
  end if;

  select count(*)::int, (count(*) filter (where p.status in ('recording', 'dead')))::int
    into v_parts, v_open
    from public.live_recording_parts p
   where p.session_id = s.id;

  if v_parts = 0 then
    v_first := s.raw_path;  -- pre-0146 session: its single egress file (0138 behaviour)
  elsif v_open > 0 then
    return null;            -- a part is still being written or recovered
  else
    select p.raw_path into v_first
      from public.live_recording_parts p
     where p.session_id = s.id and p.raw_path is not null
     order by p.seq
     limit 1;
  end if;

  if v_first is null then
    if v_parts = 0 and not coalesce(p_final, false) then
      return null;          -- 0138: wait for the egress file
    end if;
    update public.live_sessions set status = 'failed' where id = s.id;
    insert into public.media_jobs
      (kind, status, input_key, live_session_id, created_by, error, finished_at)
    values
      ('live_recording', 'failed', 'live-lost:' || s.id::text, s.id, s.host_user_id,
       v_error, now())
    returning id into v_id;
    begin
      insert into public.notifications (user_id, type, title, body, data)
      select p.id,
             'content_reported',
             'تعذّر حفظ تسجيل البث المباشر',
             left('«' || s.title || '» — توقّف خادم التسجيل ولم يُعثر على أي جزء من الملف.', 300),
             jsonb_build_object('route', '/admin/live', 'liveSessionId', s.id)
        from public.profiles p
       where p.role in ('admin', 'publisher');
    exception when others then
      null;
    end;
    return v_id;
  end if;

  update public.live_sessions
     set status = 'processing', raw_path = v_first
   where id = s.id;
  insert into public.media_jobs (kind, input_key, live_session_id, created_by)
  values ('live_recording', v_first, s.id, s.host_user_id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.live_recording_enqueue_if_ready(uuid, boolean)
  from public, anon, authenticated;

-- =============================================================================
-- 5. set_live_session_status — 0138_live_rpcs.sql verbatim except:
--    (a) → live with an egress id registers part 1;
--    (b) → ended: live_recording_enqueue_if_ready replaces the inline
--        "raw_path set and no job yet ⇒ processing + job" block (identical for a
--        pre-0146 session without parts; with parts it waits for all of them).
-- =============================================================================
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

  -- 0146 (a): the first recording part.
  if p_status = 'live' and s.egress_id ~ '^EG_[A-Za-z0-9]{1,64}$' then
    insert into public.live_recording_parts (session_id, seq, egress_id, status, started_at)
    values (s.id, 1, s.egress_id, 'recording', coalesce(s.started_at, now()))
    on conflict do nothing;
  end if;

  -- 0146 (b): queue the recording job when everything is in.
  if p_status = 'ended' then
    perform public.live_recording_enqueue_if_ready(s.id);
    select * into s from public.live_sessions where id = s.id;
  end if;

  return s;
end;
$$;
revoke all on function public.set_live_session_status(uuid, public.live_status, text)
  from public, anon, authenticated;
grant execute on function public.set_live_session_status(uuid, public.live_status, text)
  to service_role;

-- =============================================================================
-- 6. register_live_recording_part — the worker: an egress's file (or its loss)
-- =============================================================================
-- p_status: complete (clean egress_ended) | recovered (partial copied from the
-- egress tmp dir) | lost (nothing found) | dead (egress confirmed dead, file
-- recovery pending — lets live-control resume at once). p_raw_path is required
-- for complete/recovered and must be NULL otherwise; /recordings/<this env>/….
-- An egress with no part row yet (started before 0146 / registration lost) gets
-- the next seq — except on a pre-0146 session that already has its job, where
-- 0138's rules apply (same file ⇒ same job id, else an error).
-- Returns live_recording_enqueue_if_ready: the job id, or NULL while waiting.
create or replace function public.register_live_recording_part(
  p_room_name text,
  p_egress_id text,
  p_raw_path  text,
  p_status    text,
  p_bytes     bigint default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_path   text := nullif(btrim(coalesce(p_raw_path, '')), '');
  v_egress text := btrim(coalesce(p_egress_id, ''));
  v_status text := btrim(coalesce(p_status, ''));
  v_env    text;
  s        public.live_sessions%rowtype;
  p        public.live_recording_parts%rowtype;
  v_job    public.media_jobs%rowtype;
  v_seq    int;
  v_first  text;
  v_other  int;
begin
  if v_status not in ('dead', 'complete', 'recovered', 'lost') then
    raise exception 'invalid recording part status %', v_status;
  end if;
  if (v_status in ('complete', 'recovered')) <> (v_path is not null) then
    raise exception 'a % recording part % a raw path', v_status,
      case when v_path is null then 'needs' else 'cannot have' end;
  end if;
  if v_egress !~ '^EG_[A-Za-z0-9]{1,64}$' then
    raise exception 'invalid egress id';
  end if;
  if p_bytes is not null and p_bytes < 0 then
    raise exception 'invalid size';
  end if;
  if v_path is not null then
    select left(room_prefix, 3) into v_env from public.live_config;
    if v_path not like '/recordings/' || coalesce(v_env, '?') || '/_%'
       or position('..' in v_path) > 0
       or length(v_path) > 512 then
      raise exception 'invalid raw path (expected /recordings/%/…)', v_env;
    end if;
  end if;

  select * into s from public.live_sessions where room_name = p_room_name for update;
  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;
  if s.status in ('scheduled', 'green', 'cancelled') then
    raise exception 'live session is not recordable (status %)', s.status;
  end if;

  if v_path is not null then
    select p2.seq into v_other
      from public.live_recording_parts p2
     where p2.raw_path = v_path and p2.egress_id <> v_egress;
    if v_other is not null then
      raise exception 'this recording file already belongs to part %', v_other;
    end if;
  end if;

  select * into p from public.live_recording_parts where egress_id = v_egress for update;
  if found and p.session_id <> s.id then
    raise exception 'egress belongs to another live session';
  end if;

  if not found then
    if not exists (select 1 from public.live_recording_parts where session_id = s.id) then
      select * into v_job
        from public.media_jobs
       where live_session_id = s.id and kind = 'live_recording'
       order by created_at desc
       limit 1;
      if found then
        -- pre-0146 session already processed: 0138's enqueue rules.
        if v_job.input_key = v_path then
          return v_job.id;
        end if;
        raise exception 'a recording job already exists for this session';
      end if;
    end if;
    select coalesce(max(seq), 0) + 1 into v_seq
      from public.live_recording_parts where session_id = s.id;
    if v_seq > 50 then
      raise exception 'too many recording parts for this live session';
    end if;
    insert into public.live_recording_parts
      (session_id, seq, egress_id, status, raw_path, bytes, started_at, ended_at)
    values
      (s.id, v_seq, v_egress, v_status, v_path, p_bytes, coalesce(s.started_at, now()),
       case when v_status <> 'dead' then now() end);
  elsif p.status = v_status and p.raw_path is not distinct from v_path then
    null;  -- redelivered webhook / repeated sweep
  elsif p.status in ('recording', 'dead')
     or (p.status = 'lost' and v_status in ('complete', 'recovered'))
     or (p.status = 'recovered' and v_status = 'complete') then
    -- (recovered → complete: the egress did finish; its full file wins, the
    -- recovered copy stays on disk unreferenced — the worker logs it.)
    update public.live_recording_parts
       set status   = v_status,
           raw_path = v_path,
           bytes    = coalesce(p_bytes, case when v_path is not distinct from p.raw_path then bytes end),
           ended_at = case when v_status = 'dead' then ended_at else coalesce(ended_at, now()) end
     where egress_id = v_egress;
  else
    raise exception 'recording part % is already % — refusing %', p.seq, p.status, v_status;
  end if;

  -- The session's raw_path = its first part with a file (job input + staff
  -- download). Frozen once the job exists; filled if still empty.
  select p3.raw_path into v_first
    from public.live_recording_parts p3
   where p3.session_id = s.id and p3.raw_path is not null
   order by p3.seq
   limit 1;
  if v_first is not null and s.raw_deleted_at is null then
    update public.live_sessions
       set raw_path = case
                        when raw_path is null
                          or not exists (select 1 from public.media_jobs j
                                          where j.live_session_id = s.id and j.kind = 'live_recording')
                        then v_first
                        else raw_path
                      end
     where id = s.id;
  end if;

  return public.live_recording_enqueue_if_ready(s.id);
end;
$$;
revoke all on function public.register_live_recording_part(text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.register_live_recording_part(text, text, text, text, bigint)
  to service_role;

-- =============================================================================
-- 7. enqueue_live_recording — 0138_live_rpcs.sql signature, now a clean
--    egress_ended = a `complete` part. Same results for the single-egress path:
--    job id (or the same id again for a redelivered webhook), NULL while the
--    session is still live — and now also while another part is still open.
-- =============================================================================
create or replace function public.enqueue_live_recording(
  p_room_name text,
  p_egress_id text,
  p_raw_path  text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_egress text := nullif(btrim(coalesce(p_egress_id, '')), '');
begin
  if v_egress is null then
    select egress_id into v_egress from public.live_sessions where room_name = p_room_name;
  end if;
  return public.register_live_recording_part(p_room_name, v_egress, p_raw_path, 'complete', null);
end;
$$;
revoke all on function public.enqueue_live_recording(text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_live_recording(text, text, text) to service_role;

-- =============================================================================
-- 8. add_live_recording_part — live-control `resume_recording`: the new egress
-- =============================================================================
-- Only while the session is live and no part is `recording` (the worker marks
-- the dead one first). Makes it the session's current egress (live-control
-- `end` stops live_sessions.egress_id). Returns the new seq.
create or replace function public.add_live_recording_part(
  p_session   uuid,
  p_egress_id text
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_egress text := btrim(coalesce(p_egress_id, ''));
  s        public.live_sessions%rowtype;
  v_seq    int;
begin
  if v_egress !~ '^EG_[A-Za-z0-9]{1,64}$' then
    raise exception 'invalid egress id';
  end if;
  select * into s from public.live_sessions where id = p_session for update;
  if not found then
    raise exception 'live session not found' using errcode = 'P0002';
  end if;
  if s.status <> 'live' then
    raise exception 'live session is not live (status %)', s.status;
  end if;
  if exists (select 1 from public.live_recording_parts
              where session_id = s.id and status = 'recording') then
    raise exception 'a recording is already running for this live session';
  end if;
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.live_recording_parts where session_id = s.id;
  if v_seq > 50 then
    raise exception 'too many recording parts for this live session';
  end if;
  insert into public.live_recording_parts (session_id, seq, egress_id, status)
  values (s.id, v_seq, v_egress, 'recording');
  update public.live_sessions set egress_id = v_egress where id = s.id;
  return v_seq;
end;
$$;
revoke all on function public.add_live_recording_part(uuid, text) from public, anon, authenticated;
grant execute on function public.add_live_recording_part(uuid, text) to service_role;

-- =============================================================================
-- 9. live_recording_watch — what the worker's recording guard looks at
-- =============================================================================
-- Every live session, and every ended one still without its recording job,
-- with all its parts (the worker only acts on its own env's rooms).
create or replace function public.live_recording_watch()
returns table (
  session_id uuid,
  room_name  text,
  status     public.live_status,
  started_at timestamptz,
  ended_at   timestamptz,
  has_job    boolean,
  parts      jsonb
)
language sql stable security definer set search_path = public as $$
  select s.id, s.room_name, s.status, s.started_at, s.ended_at,
         exists (select 1 from public.media_jobs j
                  where j.live_session_id = s.id and j.kind = 'live_recording'),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'seq',        p.seq,
                    'egress_id',  p.egress_id,
                    'status',     p.status,
                    'raw_path',   p.raw_path,
                    'started_at', p.started_at) order by p.seq)
             from public.live_recording_parts p
            where p.session_id = s.id), '[]'::jsonb)
    from public.live_sessions s
   where s.status = 'live'
      or (s.status = 'ended'
          and not exists (select 1 from public.media_jobs j
                           where j.live_session_id = s.id and j.kind = 'live_recording'))
   order by s.started_at nulls last;
$$;
revoke all on function public.live_recording_watch() from public, anon, authenticated;
grant execute on function public.live_recording_watch() to service_role;

-- settle_live_recording — the worker's backstop for an `ended` session that has
-- waited too long: queue the job, or fail it loudly (never stuck `ended`).
create or replace function public.settle_live_recording(p_session uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return public.live_recording_enqueue_if_ready(p_session, true);
end;
$$;
revoke all on function public.settle_live_recording(uuid) from public, anon, authenticated;
grant execute on function public.settle_live_recording(uuid) to service_role;

-- =============================================================================
-- 10. Per-part R2 backup + local raw retention
-- =============================================================================
create or replace function public.mark_live_part_backed_up(
  p_session    uuid,
  p_seq        int,
  p_backup_key text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_key text := nullif(btrim(coalesce(p_backup_key, '')), '');
begin
  if v_key is null or v_key not like 'live-raw/_%' or position('..' in v_key) > 0 then
    raise exception 'invalid raw backup key (expected live-raw/…)';
  end if;
  update public.live_recording_parts
     set raw_backup_key = v_key
   where session_id = p_session and seq = p_seq and raw_path is not null;
  if not found then
    raise exception 'recording part not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.mark_live_part_backed_up(uuid, int, text) from public, anon, authenticated;
grant execute on function public.mark_live_part_backed_up(uuid, int, text) to service_role;

-- After the worker deleted a part's local raw. Refuses a part without an R2
-- backup. When no part keeps a local file, the session is stamped too (the admin
-- page's raw_local flag and 0138's mark_live_raw_deleted semantics).
create or replace function public.mark_live_part_raw_deleted(p_session uuid, p_seq int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.live_recording_parts%rowtype;
begin
  -- session row first: the same lock order as register_live_recording_part
  perform 1 from public.live_sessions where id = p_session for update;
  select * into p from public.live_recording_parts
   where session_id = p_session and seq = p_seq
   for update;
  if not found then
    raise exception 'recording part not found' using errcode = 'P0002';
  end if;
  if p.raw_backup_key is null then
    raise exception 'no R2 backup recorded for this part — keep the raw';
  end if;
  update public.live_recording_parts
     set raw_deleted_at = coalesce(raw_deleted_at, now())
   where session_id = p_session and seq = p_seq;

  if not exists (select 1 from public.live_recording_parts
                  where session_id = p_session
                    and raw_path is not null
                    and raw_deleted_at is null) then
    update public.live_sessions
       set raw_deleted_at = coalesce(raw_deleted_at, now())
     where id = p_session
       and raw_backup_key is not null;
  end if;
end;
$$;
revoke all on function public.mark_live_part_raw_deleted(uuid, int) from public, anon, authenticated;
grant execute on function public.mark_live_part_raw_deleted(uuid, int) to service_role;

-- Parts whose local raw may go: the lecture exists (session ready) and EVERY
-- part of that session with a file has its R2 backup recorded.
create or replace function public.live_part_raws_due_for_deletion()
returns table (session_id uuid, seq int, raw_path text, raw_backup_key text)
language sql stable security definer set search_path = public as $$
  select p.session_id, p.seq, p.raw_path, p.raw_backup_key
    from public.live_recording_parts p
    join public.live_sessions s on s.id = p.session_id
   where s.lecture_id is not null
     and s.status = 'ready'
     and p.raw_path is not null
     and p.raw_backup_key is not null
     and p.raw_deleted_at is null
     and not exists (select 1 from public.live_recording_parts q
                      where q.session_id = p.session_id
                        and q.raw_path is not null
                        and q.raw_backup_key is null)
   order by s.updated_at, p.seq;
$$;
revoke all on function public.live_part_raws_due_for_deletion() from public, anon, authenticated;
grant execute on function public.live_part_raws_due_for_deletion() to service_role;

-- live_raws_due_for_deletion — 0139_live_raw_retention.sql verbatim + the last
-- condition: sessions with parts are handled part by part (above).
create or replace function public.live_raws_due_for_deletion()
returns table (session_id uuid, raw_path text, raw_backup_key text)
language sql stable security definer set search_path = public as $$
  select s.id, s.raw_path, s.raw_backup_key
    from public.live_sessions s
   where s.lecture_id is not null
     and s.status = 'ready'
     and s.raw_path is not null
     and s.raw_backup_key is not null
     and s.raw_deleted_at is null
     and not exists (select 1 from public.live_recording_parts p where p.session_id = s.id)
   order by s.updated_at;
$$;
revoke all on function public.live_raws_due_for_deletion() from public, anon, authenticated;
grant execute on function public.live_raws_due_for_deletion() to service_role;
