-- =============================================================================
-- 0132_media_jobs.sql
-- المَحجّة البَيْضَاء — V23 P1: server-side media worker (lecture compression
-- moves from the admin's browser to the VPS).
--
-- (PLAN_LIVE_V23 §4 "0135_media_jobs" — renumbered: the worker ships first, so
-- media_jobs is the first V23 migration; live_sessions follows in 0133, which
-- also adds the media_jobs.live_session_id FK.)
--
-- Flow (lecture_transcode):
--   admin web  → signed PUT of the ORIGINAL to R2 `incoming/…`
--              → creates the draft lecture
--              → enqueue_lecture_transcode(lecture, 'incoming/…')   [content manager]
--   worker     → claim_media_job() every few s                        [service_role]
--              → ffmpeg; writes progress / heartbeat_at directly     [service_role]
--              → complete_lecture_transcode(job, key, dur, size)     [service_role]
--                or fail_media_job(job, error) → 'retry' | 'failed'  [service_role]
--   admin web  → polls media_jobs.progress (content managers may SELECT)
--
-- Retry policy: a job gets 3 attempts in total (attempts is bumped by claim).
-- fail_media_job re-queues with backoff (1 min, then 5 min); the third failure
-- is final and drops a staff inbox notification. A worker that dies mid-job
-- stops heart-beating; claim re-hands the job out after 2 minutes of silence
-- (still within the 3-attempt budget) and finalises it as failed beyond that.
-- The original upload in R2 is never deleted on failure (the worker only deletes
-- it after a successful complete).
--
-- Staff notification type: the existing admin-facing 'content_reported'
-- («بلاغ جديد (لحساب الإدارة)» · flag icon · "needs review") is reused. A new
-- enum value would need its own migration AND a client release (labels/prefs
-- records are exhaustive over NotificationType), and the admin inbox already
-- routes via data.route. data deliberately carries NO `lectureId` key: the
-- inbox would open the player on a draft with no audio.
--
-- Publish guard: lectures.audio_path is nullable (0005) and nothing stopped a
-- draft with no audio from being published. A lecture whose audio is still
-- being compressed on the server (queued/running job, audio_path null) can now
-- not be flipped to 'published' — the student would get a lesson that cannot
-- play. Every other publish path is unchanged.
--
-- app_config.server_transcode = 'false' — the admin-web switch between the old
-- in-browser ffmpeg.wasm path and this server path (§6.1). Readable by every
-- signed-in session through the existing app_config_read policy (0021:
-- `to authenticated using (true)`), so admin and publisher web sessions read it
-- with no change. (The known «anon key reads app_config as []» gotcha only hits
-- a bare anon-key request with NO user session — the admin web always has one.)
-- Flipped by an admin through the existing set_app_config RPC.
--
-- Append-only — 0001–0131 are never edited. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Enums ------------------------------------------------------------------------
do $$ begin
  create type public.media_job_kind as enum ('lecture_transcode', 'live_recording');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.media_job_status as enum ('queued', 'running', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- 2. Table ------------------------------------------------------------------------
create table if not exists public.media_jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            public.media_job_kind   not null,
  status          public.media_job_status not null default 'queued',
  progress        real not null default 0 check (progress >= 0 and progress <= 1),
  input_key       text not null,             -- incoming/… (upload) or live-raw/… (recording)
  output_key      text,                      -- final MP3 key, set on completion
  lecture_id      uuid references public.lectures (id) on delete set null,
  live_session_id uuid,                      -- FK → live_sessions(id) added in 0133
  attempts        int  not null default 0,   -- bumped by claim_media_job
  error           text,                      -- last failure reason (worker-supplied)
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  heartbeat_at    timestamptz,               -- worker liveness; stale > 2 min ⇒ reclaimable
  not_before      timestamptz not null default now()  -- retry backoff gate
);

comment on table public.media_jobs is
  'V23 media worker queue (ffmpeg on the VPS). Clients: content managers SELECT only; all writes via enqueue_lecture_transcode (content manager) or the service-role worker RPCs.';

-- claim_media_job scans only the live part of the queue.
create index if not exists media_jobs_claim_idx
  on public.media_jobs (created_at)
  where status in ('queued', 'running');
-- Publish guard + admin progress lookups by lecture (also the FK index).
create index if not exists media_jobs_lecture_idx
  on public.media_jobs (lecture_id);

-- 3. RLS: content managers read (progress UI); nobody writes from a client -------
alter table public.media_jobs enable row level security;

revoke all on table public.media_jobs from public, anon, authenticated;
grant select on table public.media_jobs to authenticated;
grant select, insert, update, delete on table public.media_jobs to service_role;

drop policy if exists media_jobs_select_content_manager on public.media_jobs;
create policy media_jobs_select_content_manager on public.media_jobs
  for select to authenticated
  using (public.is_content_manager());

-- 4. Staff notification on a final failure (internal helper) -------------------
-- Every admin, plus the job's creator when they are a publisher. Best-effort:
-- a notification hiccup never rolls back the job state change.
create or replace function public.notify_media_job_failed(p_job uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  j       record;
  v_title text;
  v_body  text;
  v_route text;
begin
  select mj.id, mj.kind, mj.created_by, l.title as lecture_title
    into j
    from public.media_jobs mj
    left join public.lectures l on l.id = mj.lecture_id
   where mj.id = p_job;
  if not found then
    return;
  end if;

  if j.kind = 'live_recording' then
    v_title := 'تعذّرت معالجة تسجيل البث المباشر';
    v_body  := 'لم يُضغط تسجيل المجلس على الخادم بعد ٣ محاولات. التسجيل الأصلي محفوظ.';
    v_route := '/admin/unclassified';
  else
    v_title := 'تعذّر ضغط ملف المحاضرة';
    v_body  := case
                 when j.lecture_title is not null
                   then '«' || left(j.lecture_title, 120) || '» — لم يُضغط الملف على الخادم بعد ٣ محاولات. الملف الأصلي محفوظ.'
                 else 'لم يُضغط الملف على الخادم بعد ٣ محاولات. الملف الأصلي محفوظ.'
               end;
    v_route := '/admin/lectures';
  end if;

  begin
    insert into public.notifications (user_id, type, title, body, data)
    select p.id,
           'content_reported',
           v_title,
           v_body,
           jsonb_build_object('route', v_route, 'mediaJobId', j.id)
      from public.profiles p
     where p.role = 'admin'
        or (p.id = j.created_by and p.role = 'publisher');
  exception when others then
    null;
  end;
end;
$$;
revoke all on function public.notify_media_job_failed(uuid) from public, anon, authenticated;

-- 5. claim_media_job — the worker's only way to take work ---------------------
-- Returns 0 or 1 row. Oldest first. `for update skip locked` so two claimers
-- can never take the same job. Before picking, it finalises jobs that can
-- never make progress again:
--   * running, silent > 2 min, attempts already 3  → failed (+ staff notice)
--   * lecture_transcode whose lecture was deleted  → failed (no notice: the
--     admin deleted it on purpose)
create or replace function public.claim_media_job()
returns setof public.media_jobs
language plpgsql security definer set search_path = public as $$
declare
  z    record;
  v_id uuid;
  r    public.media_jobs%rowtype;
begin
  for z in
    update public.media_jobs
       set status      = 'failed',
           finished_at = now(),
           error       = coalesce(error || ' · ', '') || 'توقّف العامل عن الاستجابة بعد ٣ محاولات'
     where status = 'running'
       and attempts >= 3
       and coalesce(heartbeat_at, started_at, created_at) < now() - interval '2 minutes'
    returning id
  loop
    perform public.notify_media_job_failed(z.id);
  end loop;

  update public.media_jobs
     set status      = 'failed',
         finished_at = now(),
         error       = 'حُذفت المحاضرة قبل اكتمال المعالجة'
   where kind = 'lecture_transcode'
     and lecture_id is null
     and status in ('queued', 'running')
     and (status = 'queued'
          or coalesce(heartbeat_at, started_at, created_at) < now() - interval '2 minutes');

  select c.id into v_id
    from public.media_jobs c
   where (c.status = 'queued' and c.not_before <= now())
      or (c.status = 'running'
          and c.attempts < 3
          and coalesce(c.heartbeat_at, c.started_at, c.created_at) < now() - interval '2 minutes')
   order by c.created_at, c.id
   limit 1
   for update skip locked;

  if v_id is null then
    return;
  end if;

  update public.media_jobs
     set status       = 'running',
         attempts     = attempts + 1,
         started_at   = now(),
         heartbeat_at = now(),
         finished_at  = null,
         progress     = 0
   where id = v_id
  returning * into r;

  return next r;
end;
$$;
revoke all on function public.claim_media_job() from public, anon, authenticated;
grant execute on function public.claim_media_job() to service_role;

-- 6. complete_lecture_transcode — atomic: lecture audio + job done -------------
-- Idempotent for a worker that retries the call after a lost response (same
-- output key on an already-done job is a no-op). Raises when the lecture was
-- deleted mid-job; fail_media_job then finalises without retrying.
-- NOTE for the worker: the previous lectures.audio_path (a re-upload) is simply
-- overwritten here — if the new key differs, the old object is the worker's to
-- delete, and it must NOT delete it when the keys are equal.
create or replace function public.complete_lecture_transcode(
  p_job          uuid,
  p_output_key   text,
  p_duration_sec int,
  p_size_bytes   bigint
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  j public.media_jobs%rowtype;
begin
  if coalesce(btrim(p_output_key), '') = '' then
    raise exception 'output key is required';
  end if;
  if p_duration_sec is not null and p_duration_sec < 0 then
    raise exception 'invalid duration';
  end if;
  if p_size_bytes is not null and p_size_bytes < 0 then
    raise exception 'invalid size';
  end if;

  select * into j from public.media_jobs where id = p_job for update;
  if not found then
    raise exception 'media job not found' using errcode = 'P0002';
  end if;
  if j.kind <> 'lecture_transcode' then
    raise exception 'not a lecture_transcode job';
  end if;
  if j.status = 'done' and j.output_key = p_output_key then
    return;  -- duplicate call after a lost response
  end if;
  if j.status <> 'running' then
    raise exception 'media job is not running (status %)', j.status;
  end if;
  if j.lecture_id is null then
    raise exception 'lecture_not_found' using errcode = 'P0002';
  end if;

  update public.lectures
     set audio_path       = p_output_key,
         duration_sec     = coalesce(p_duration_sec, duration_sec),
         audio_size_bytes = coalesce(p_size_bytes, audio_size_bytes)
   where id = j.lecture_id;
  if not found then
    raise exception 'lecture_not_found' using errcode = 'P0002';
  end if;

  update public.media_jobs
     set status       = 'done',
         progress     = 1,
         output_key   = p_output_key,
         finished_at  = now(),
         heartbeat_at = now(),
         error        = null
   where id = p_job;
end;
$$;
revoke all on function public.complete_lecture_transcode(uuid, text, int, bigint)
  from public, anon, authenticated;
grant execute on function public.complete_lecture_transcode(uuid, text, int, bigint)
  to service_role;

-- 7. fail_media_job — 'retry' (re-queued with backoff) or 'failed' (final) ------
create or replace function public.fail_media_job(p_job uuid, p_error text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  j       public.media_jobs%rowtype;
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 2000);
begin
  select * into j from public.media_jobs where id = p_job for update;
  if not found then
    raise exception 'media job not found' using errcode = 'P0002';
  end if;

  -- Duplicate calls (worker retried after a lost response) change nothing.
  if j.status = 'failed' then
    return 'failed';
  end if;
  if j.status = 'queued' then
    return 'retry';
  end if;
  if j.status = 'done' then
    raise exception 'media job already done';
  end if;

  -- The lecture it was compressing is gone: retrying is pointless and the
  -- admin deleted it on purpose, so no notification either.
  if j.kind = 'lecture_transcode' and j.lecture_id is null then
    update public.media_jobs
       set status = 'failed', finished_at = now(), error = v_error
     where id = p_job;
    return 'failed';
  end if;

  if j.attempts < 3 then
    update public.media_jobs
       set status       = 'queued',
           error        = v_error,
           progress     = 0,
           heartbeat_at = null,
           not_before   = now() + case when j.attempts <= 1
                                       then interval '1 minute'
                                       else interval '5 minutes' end
     where id = p_job;
    return 'retry';
  end if;

  update public.media_jobs
     set status = 'failed', finished_at = now(), error = v_error
   where id = p_job;
  perform public.notify_media_job_failed(p_job);
  return 'failed';
end;
$$;
revoke all on function public.fail_media_job(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_media_job(uuid, text) to service_role;

-- 8. enqueue_lecture_transcode — the admin web's single write path -----------
-- Content managers (admin + publisher) only. Idempotent for a retried request:
-- if the lecture already has an active job for the SAME input key, that job's
-- id is returned; a DIFFERENT file while one is still queued/running is refused
-- (two jobs racing on one lecture would leave whichever finished last).
create or replace function public.enqueue_lecture_transcode(p_lecture uuid, p_input_key text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_key      text := btrim(coalesce(p_input_key, ''));
  v_existing public.media_jobs%rowtype;
  v_id       uuid;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if v_key not like 'incoming/_%'
     or position('..' in v_key) > 0
     or length(v_key) > 512 then
    raise exception 'مفتاح الملف غير صالح';
  end if;
  if p_lecture is null
     or not exists (select 1 from public.lectures where id = p_lecture) then
    raise exception 'المحاضرة غير موجودة';
  end if;

  -- Serialise concurrent enqueues for the same lecture.
  perform 1 from public.lectures where id = p_lecture for update;

  select * into v_existing
    from public.media_jobs
   where lecture_id = p_lecture
     and kind = 'lecture_transcode'
     and status in ('queued', 'running')
   order by created_at desc
   limit 1;
  if found then
    if v_existing.input_key = v_key then
      return v_existing.id;
    end if;
    raise exception 'يجري ضغط ملف آخر لهذه المحاضرة، انتظر حتى يكتمل';
  end if;

  insert into public.media_jobs (kind, input_key, lecture_id, created_by)
  values ('lecture_transcode', v_key, p_lecture, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.enqueue_lecture_transcode(uuid, text) from public, anon;
grant execute on function public.enqueue_lecture_transcode(uuid, text) to authenticated;

-- 9. Publish guard -----------------------------------------------------------------
-- Blocks draft→published while the audio is still being compressed on the
-- server (audio_path null + a queued/running job). Unchanged otherwise.
create or replace function public.guard_publish_pending_audio()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published'
     and old.status is distinct from 'published'
     and new.audio_path is null
     and exists (
       select 1 from public.media_jobs j
        where j.lecture_id = new.id
          and j.status in ('queued', 'running')
     ) then
    raise exception 'لا يمكن نشر المحاضرة قبل اكتمال ضغط ملفها الصوتي على الخادم';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_publish_pending_audio() from public, anon, authenticated;

drop trigger if exists lectures_guard_pending_audio on public.lectures;
create trigger lectures_guard_pending_audio
  before update of status on public.lectures
  for each row execute function public.guard_publish_pending_audio();

-- 10. Feature flag (§6.1): off until P1 is verified --------------------------------
insert into public.app_config (key, value) values ('server_transcode', 'false')
on conflict (key) do nothing;
