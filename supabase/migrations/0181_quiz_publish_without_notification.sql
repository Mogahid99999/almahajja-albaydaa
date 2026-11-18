-- =============================================================================
-- 0181_quiz_publish_without_notification.sql
-- المَحجّة البَيْضَاء — «نشر بدون إشعار» for quizzes (lectures have had it since 0123).
--
-- Owner's ask (2026-11-17): publish a quiz without announcing it to the students.
--
-- Server-side, like 0123: a quizzes column the publish trigger reads. The admin
-- web/app sends it only from the publish confirmation; every other save leaves
-- it alone, and clients that don't know the column behave exactly as before.
--
-- Semantics:
--   * notify_on_publish defaults to TRUE (every existing row, every old client).
--   * FALSE: the trigger enqueues nothing, and a pending (not yet sent) quiz job
--     — e.g. a scheduled quiz waiting for available_from — is closed with
--     last_error 'silenced (0181)' instead of being sent. Rows are kept (no delete).
--   * Setting it back to TRUE while published enqueues as usual (the trigger now
--     also fires on this column). A quiz already announced never re-sends (unchanged).
--
-- Table class: quizzes = business rows (2 rows on prod); one boolean with a
-- constant default — no table rewrite. fanout_queue = operational rows.
-- Body = the live prod definition of notify_quiz_published (pg_get_functiondef,
-- 2026-11-17, identical to 0164) with only the marked lines added.
--
-- Rollback (down): re-run the 0164 function + trigger blocks, then
--   alter table public.quizzes drop column notify_on_publish;
-- (old clients never send the column, so they run on either schema).
-- Append-only, idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

alter table public.quizzes
  add column if not exists notify_on_publish boolean not null default true;

comment on column public.quizzes.notify_on_publish is
  '0181: false = publish silently — notify_quiz_published enqueues no push and closes a pending quiz job. Set from the publish confirmation («نشر بدون إشعار»).';

create or replace function public.notify_quiz_published()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_run_after timestamptz;
begin
  if new.status <> 'published' then
    return new;
  end if;
  -- 0181 «نشر بدون إشعار»: nothing goes out, and a job still waiting is closed.
  if not coalesce(new.notify_on_publish, true) then
    update public.fanout_queue
       set done_at = now(), last_error = 'silenced (0181)'
     where kind = 'quiz' and ref_id = new.id and done_at is null;
    return new;
  end if;
  -- Announced once: a quiz that already reached the students never re-sends.
  if exists (select 1 from public.fanout_queue
              where kind = 'quiz' and ref_id = new.id and (params ->> 'sent') = 'true') then
    return new;
  end if;

  v_run_after := case
    when new.availability_mode = 'scheduled' and new.available_from > now()
      then new.available_from
  end;

  -- A pending job follows the latest window; otherwise enqueue one.
  update public.fanout_queue
     set run_after = v_run_after, attempts = 0, last_error = null
   where kind = 'quiz' and ref_id = new.id and done_at is null;
  if not found then
    -- Nothing to announce while it is shut; re-opening it later enqueues.
    if public.quiz_availability(new.availability_mode, new.available_from, new.available_until)
         in ('closed', 'expired') then
      return new;
    end if;
    insert into public.fanout_queue (kind, ref_id, run_after, params)
    values ('quiz', new.id, v_run_after, '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists quizzes_notify_published on public.quizzes;
create trigger quizzes_notify_published
  after insert or update of status, availability_mode, available_from, available_until, notify_on_publish
  on public.quizzes
  for each row execute function public.notify_quiz_published();
