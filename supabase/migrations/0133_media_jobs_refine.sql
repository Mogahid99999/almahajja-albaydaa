-- =============================================================================
-- 0133_media_jobs_refine.sql
-- المَحجّة البَيْضَاء — V23 P1: media worker contract refinements on top of 0132
-- (0132 is applied and never edited).
--
--   a. claim_media_job(p_kinds media_job_kind[] default null) — the worker
--      claims only live_recording jobs while an egress is recording (§3.6: no
--      transcodes during a live). null = every kind. The 0-arg version is
--      dropped first so a call can never be ambiguous; `rpc('claim_media_job')`
--      with no args still resolves (default).
--   b. touch_media_job(job, progress) — progress (clamped 0..1; null keeps it)
--      + heartbeat_at = now() on the DB clock, only while the job is running.
--      Returns false when no running job matched (reclaimed / finished / gone):
--      the worker should stop working on it.
--   c. fail_media_job is a no-op returning 'ignored' unless the job is running,
--      so a lost/duplicated reply can never re-queue (or re-fail) a job that has
--      already moved on. Return values: 'retry' | 'failed' | 'ignored'.
--   d. complete_lecture_transcode accepts p_duration_sec / p_size_bytes null
--      (the lecture keeps its existing value).
--   e. Server-side publish-on-done: media_jobs.publish_on_done, set through
--      enqueue_lecture_transcode(lecture, key, p_publish_on_done default false)
--      (old 2-arg signature dropped first). When true, complete_lecture_transcode
--      publishes the lecture with a plain status update AFTER the audio fields
--      are set, so the 0132 publish guard (audio_path null) passes and the
--      existing publish trigger applies unchanged — incl. «نشر بدون إشعار»
--      (lectures.notify_on_publish, 0123) and the async fan-out (0129).
--      The publish step runs in its own subtransaction: if it ever fails, the
--      finished transcode is still kept (job done, audio in place) and the reason
--      is left in media_jobs.error for the admin page.
--
-- enqueue after a failed (or done) job for the same lecture is allowed; only a
-- queued/running job blocks it. A retried request for the SAME file while that
-- job is active returns the existing job id (and can only turn
-- publish_on_done on, never off).
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- e. column ---------------------------------------------------------------------------
alter table public.media_jobs
  add column if not exists publish_on_done boolean not null default false;

comment on column public.media_jobs.publish_on_done is
  'lecture_transcode only: complete_lecture_transcode publishes the lecture once its audio is in place (normal publish trigger, notify_on_publish respected).';

-- a. claim_media_job(p_kinds) ------------------------------------------------------------
drop function if exists public.claim_media_job();

create or replace function public.claim_media_job(p_kinds public.media_job_kind[] default null)
returns setof public.media_jobs
language plpgsql security definer set search_path = public as $$
declare
  z    record;
  v_id uuid;
  r    public.media_jobs%rowtype;
begin
  -- Housekeeping (all kinds, same as 0132): jobs that can never progress again.
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
   where (p_kinds is null or c.kind = any (p_kinds))
     and (   (c.status = 'queued' and c.not_before <= now())
          or (c.status = 'running'
              and c.attempts < 3
              and coalesce(c.heartbeat_at, c.started_at, c.created_at) < now() - interval '2 minutes'))
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
revoke all on function public.claim_media_job(public.media_job_kind[]) from public, anon, authenticated;
grant execute on function public.claim_media_job(public.media_job_kind[]) to service_role;

-- b. touch_media_job ------------------------------------------------------------------------
create or replace function public.touch_media_job(p_job uuid, p_progress real)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.media_jobs
     set progress     = case when p_progress is null or p_progress = 'NaN'::real then progress
                             else least(greatest(p_progress, 0), 1) end,
         heartbeat_at = now()
   where id = p_job
     and status = 'running';
  return found;
end;
$$;
revoke all on function public.touch_media_job(uuid, real) from public, anon, authenticated;
grant execute on function public.touch_media_job(uuid, real) to service_role;

-- c. fail_media_job: only a running job can fail ----------------------------------------
create or replace function public.fail_media_job(p_job uuid, p_error text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  j       public.media_jobs%rowtype;
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 2000);
begin
  select * into j from public.media_jobs where id = p_job for update;
  if not found or j.status <> 'running' then
    return 'ignored';  -- lost/duplicated reply, reclaimed, finished or deleted
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

-- d + e. complete_lecture_transcode: null duration/size OK; publish-on-done -------------
create or replace function public.complete_lecture_transcode(
  p_job          uuid,
  p_output_key   text,
  p_duration_sec int,
  p_size_bytes   bigint
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  j     public.media_jobs%rowtype;
  v_err text;
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
    return;  -- duplicate call after a lost response (never re-publishes)
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

  -- Publish-on-done: audio is in place and the job is done, so the 0132 guard
  -- passes; the ordinary publish trigger does the rest (notify_on_publish, 0129).
  if j.publish_on_done then
    begin
      update public.lectures
         set status = 'published'
       where id = j.lecture_id
         and status is distinct from 'published';
    exception when others then
      get stacked diagnostics v_err = message_text;
      update public.media_jobs
         set error = left('تعذّر النشر التلقائي: ' || v_err, 2000)
       where id = p_job;
    end;
  end if;
end;
$$;
revoke all on function public.complete_lecture_transcode(uuid, text, int, bigint)
  from public, anon, authenticated;
grant execute on function public.complete_lecture_transcode(uuid, text, int, bigint)
  to service_role;

-- e. enqueue_lecture_transcode(p_lecture, p_input_key, p_publish_on_done) ---------------
drop function if exists public.enqueue_lecture_transcode(uuid, text);

create or replace function public.enqueue_lecture_transcode(
  p_lecture         uuid,
  p_input_key       text,
  p_publish_on_done boolean default false
)
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
      -- Retried request for the same file: same job; publish can only turn on.
      if coalesce(p_publish_on_done, false) and not v_existing.publish_on_done then
        update public.media_jobs set publish_on_done = true where id = v_existing.id;
      end if;
      return v_existing.id;
    end if;
    raise exception 'يجري ضغط ملف آخر لهذه المحاضرة، انتظر حتى يكتمل';
  end if;

  -- No active job (none yet, or the previous one is done/failed): enqueue.
  insert into public.media_jobs (kind, input_key, lecture_id, created_by, publish_on_done)
  values ('lecture_transcode', v_key, p_lecture, auth.uid(), coalesce(p_publish_on_done, false))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.enqueue_lecture_transcode(uuid, text, boolean) from public, anon;
grant execute on function public.enqueue_lecture_transcode(uuid, text, boolean) to authenticated;
