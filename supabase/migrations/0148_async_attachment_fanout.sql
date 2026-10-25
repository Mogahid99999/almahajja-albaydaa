-- =============================================================================
-- 0148_async_attachment_fanout.sql
-- المَحجّة البَيْضَاء — BUGFIX: «تعذّر إضافة المرفق» in the admin section tree.
--
-- 0129 moved the broadcast and lecture fan-outs onto fanout_queue, but the
-- attachments trigger (notify_attachment_added, last defined in 0072) still
-- called fanout_to_all INSIDE the admin's insert: one notifications row per
-- student (10,967 on prod, 2026-10-02) under the `authenticated` 8 s
-- statement_timeout → POST /rest/v1/attachments 500, code 57014, and the
-- insert rolls back. Prod's last successful attachment was 2026-07-14.
--
-- Fix: the trigger only ENQUEUES a tiny 'attachment' job; pg_cron's
-- process_fanout_queue() (every 10 s, 0129) delivers it outside any request
-- timeout. The job is skipped when the attachment was deleted — or, for a
-- lecture attachment, its lecture unpublished — before it runs.
--
-- Recipient rules and copy are unchanged (fanout_to_all, 0072 wording).
-- process_fanout_queue = the 0142 body verbatim + the 'attachment' branch.
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1. Allow the new job kind -----------------------------------------------------
alter table public.fanout_queue drop constraint if exists fanout_queue_kind_check;
alter table public.fanout_queue
  add constraint fanout_queue_kind_check
  check (kind in ('broadcast', 'lecture', 'live_start', 'live_reminder', 'attachment'));

-- 2. The trigger enqueues instead of fanning out ---------------------------------
create or replace function public.notify_attachment_added()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_section_id    uuid;
  v_published     boolean;
  v_lecture_title text;
  v_title         text;
begin
  if new.section_id is not null then
    v_section_id := new.section_id;
    v_title := 'أُضيف مرفق جديد';
  else
    select l.section_id, (l.status = 'published'), l.title
      into v_section_id, v_published, v_lecture_title
      from public.lectures l
     where l.id = new.lecture_id;
    if not coalesce(v_published, false) then
      return new;
    end if;
    v_title := 'أُضيف مرفق جديد يساعدك في ' || coalesce(v_lecture_title, '');
  end if;

  insert into public.fanout_queue (kind, ref_id, params)
  values ('attachment', new.id, jsonb_build_object(
    'title', v_title,
    'body',  new.title,
    'data',  jsonb_build_object(
      'attachmentId', new.id,
      'sectionId',    v_section_id,
      'lectureId',    new.lecture_id
    )
  ));
  return new;
end;
$$;

-- 3. The worker learns the 'attachment' kind ------------------------------------
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
      elsif j.kind = 'attachment' then
        -- 0148: only if the attachment still exists and, for a lecture
        -- attachment, that lecture is still published.
        if exists (select 1
                     from public.attachments a
                     left join public.lectures l on l.id = a.lecture_id
                    where a.id = j.ref_id
                      and (a.section_id is not null or l.status = 'published')) then
          perform public.fanout_to_all(
            'new_attachment',
            j.params ->> 'title',
            j.params ->> 'body',
            coalesce(j.params -> 'data', '{}'::jsonb)
          );
        end if;
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
