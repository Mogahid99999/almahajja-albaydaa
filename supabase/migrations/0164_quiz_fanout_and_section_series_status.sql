-- =============================================================================
-- 0164_quiz_fanout_and_section_series_status.sql
-- المَحجّة البَيْضَاء — two small server changes (owner, 2026-11-05).
--
-- A. «اختبار جديد» reached NOBODY and ran inside the publisher's request.
--    notify_quiz_published (0018) still fanned out to SECTION FOLLOWERS, but
--    following was removed from the app back in 0007 (section_follows = 0 rows
--    on prod, 12,353 students). And unlike lectures (0129) and attachments
--    (0148) the fan-out ran synchronously in the quizzes UPDATE — the pattern
--    that froze prod before. Now:
--      * the trigger only enqueues a tiny 'quiz' job on fanout_queue;
--      * process_fanout_queue (pg_cron, every 10 s) delivers it through
--        fanout_to_all_for_section → push_to_users, so it is staggered (0155)
--        and governed (0159) like every other shared push;
--      * recipients = students with a device token whose «اختبار جديد» pref is
--        ON and who can SEE the quiz's section (gender visibility);
--      * a quiz is announced at most ONCE, and only when it is actually OPEN:
--        published as «scheduled» → the job waits until available_from
--        (fanout_queue.run_after); published «closed» / «expired» → no push
--        then, but a later re-open by the admin announces it; moving the
--        window re-times the pending job; unpublished before it ran → dropped.
--
-- B. sections.series_status — «مستمر» / «منتهي» (null = not shown). Set by the
--    content managers in the admin section editor (existing sections RLS);
--    get_home_page / get_section_page return it for the section and its
--    sub-section cards. Old app builds ignore the extra key.
--
-- C. get_section_page lost lectures.audio_size_bytes when 0118 re-created it
--    from the 0045 body (the 0069 addition was dropped) — the size next to the
--    download button stopped showing. Restored here.
--
-- Bodies = the live prod definitions (pg_get_functiondef, 2026-11-05) with only
-- the marked changes. Append-only. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- A1. Jobs can wait; new kind -------------------------------------------------------
alter table public.fanout_queue add column if not exists run_after timestamptz;
comment on column public.fanout_queue.run_after is
  '0164: null → run on the next tick; set → not before this time (a scheduled quiz waits for available_from).';

alter table public.fanout_queue drop constraint if exists fanout_queue_kind_check;
alter table public.fanout_queue
  add constraint fanout_queue_kind_check
  check (kind in ('broadcast', 'lecture', 'live_start', 'live_reminder', 'attachment', 'quiz'));

-- A2. The trigger enqueues (or re-times) instead of fanning out ---------------------
create or replace function public.notify_quiz_published()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_run_after timestamptz;
begin
  if new.status <> 'published' then
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
  after insert or update of status, availability_mode, available_from, available_until
  on public.quizzes
  for each row execute function public.notify_quiz_published();

-- A3. The worker: due jobs only + the 'quiz' kind -----------------------------------
create or replace function public.process_fanout_queue()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  j       record;
  q       record;
  v_done  int := 0;
  v_err   text;
  v_avail text;
  v_wait  boolean;
begin
  for j in
    select * from public.fanout_queue
     where done_at is null and attempts < 5
       and (run_after is null or run_after <= now())  -- 0164
     order by id
     limit 20
     for update skip locked
  loop
    update public.fanout_queue
       set started_at = now(), attempts = attempts + 1
     where id = j.id;
    v_wait := false;
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
      elsif j.kind = 'quiz' then
        -- 0164: still published AND open now; a «scheduled» one waits again.
        select id, section_id, title, status, availability_mode, available_from, available_until
          into q from public.quizzes where id = j.ref_id;
        if found and q.status = 'published' then
          v_avail := public.quiz_availability(q.availability_mode, q.available_from, q.available_until);
          if v_avail = 'open' then
            perform public.fanout_to_all_for_section(
              q.section_id,
              'new_quiz',
              'اختبار جديد',
              q.title || ' — قِس ما تعلمت',
              -- No sectionId on purpose (0018): the tap lands on the quiz intro.
              jsonb_build_object('quizId', q.id, 'route', '/quiz/' || q.id)
            );
            update public.fanout_queue set params = params || '{"sent": true}'::jsonb
             where id = j.id;
          elsif v_avail = 'scheduled' then
            update public.fanout_queue
               set run_after = q.available_from, attempts = 0
             where id = j.id;
            v_wait := true;
          end if;
        end if;
      end if;
      if not v_wait then
        -- Same subtransaction as the inserts: delivered ⇔ marked done.
        update public.fanout_queue set done_at = now(), last_error = null where id = j.id;
        v_done := v_done + 1;
      end if;
    exception when others then
      get stacked diagnostics v_err = message_text;
      update public.fanout_queue set last_error = left(v_err, 500) where id = j.id;
    end;
  end loop;
  return v_done;
end;
$$;

-- B1. The column ----------------------------------------------------------------------
alter table public.sections add column if not exists series_status text;
alter table public.sections drop constraint if exists sections_series_status_check;
alter table public.sections
  add constraint sections_series_status_check
  check (series_status is null or series_status in ('ongoing', 'completed'));
comment on column public.sections.series_status is
  '0164: «مستمر» (ongoing) / «منتهي» (completed) shown to students; null = no badge.';

-- B2 + C. get_section_page ------------------------------------------------------------
create or replace function public.get_section_page(p_section_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with sec as (
    select id, title, description, cover_image, cover_letter, show_header, parent_id,
           series_status  -- 0164
      from public.sections
     where id = p_section_id
  ),
  rollup as (
    select total_lectures, completed_lectures, sheikh_names
      from public.get_section_rollup(p_section_id)
  ),
  subs as (
    select id, title, cover_letter, "order", series_status  -- 0164
      from public.sections
     where parent_id = p_section_id
  ),
  sub_rollups as (
    select section_id, total_lectures, completed_lectures
      from public.get_children_rollups(array(select id from subs))
  ),
  lecs as (
    select l.id, l.title, l.duration_sec, l.audio_size_bytes, l."order" as ord,  -- 0164: size back (0069)
           sh.name as sheikh_name,
           coalesce(p.position_sec, 0) as position_sec,
           coalesce(p.completed, false) as completed
      from public.lectures l
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = auth.uid()
     where l.section_id = p_section_id and l.status = 'published'
  ),
  atts as (
    select id, type, title, description, storage_path, external_url, body, "order" as ord
      from public.attachments
     where section_id = p_section_id
  ),
  qz as (
    select * from public.get_section_quizzes(p_section_id)
  )
  select case when not exists (select 1 from sec) then null else
    jsonb_build_object(
      'section', (
        select jsonb_build_object(
          'id', id, 'title', title, 'description', description,
          'cover_image', cover_image, 'cover_letter', cover_letter,
          'show_header', show_header, 'parent_id', parent_id,
          'series_status', series_status  -- 0164
        ) from sec
      ),
      'parent_title', (
        select p.title from public.sections p
         where p.id = (select parent_id from sec)
      ),
      'rollup', jsonb_build_object(
        'total', coalesce((select total_lectures from rollup), 0),
        'completed', coalesce((select completed_lectures from rollup), 0),
        'sheikh_names', to_jsonb(coalesce((select sheikh_names from rollup), '{}'::text[]))
      ),
      'subsections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id, 'title', s.title, 'cover_letter', s.cover_letter,
            'total', coalesce(r.total_lectures, 0),
            'completed', coalesce(r.completed_lectures, 0),
            'series_status', s.series_status  -- 0164
          ) order by s."order"
        )
        from subs s
        left join sub_rollups r on r.section_id = s.id
      ), '[]'::jsonb),
      'lectures', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'title', title,
            'duration_sec', coalesce(duration_sec, 0),
            'audio_size_bytes', audio_size_bytes,  -- 0164: size back (0069)
            'order', ord, 'sheikh_name', sheikh_name,
            'position_sec', position_sec, 'completed', completed
          ) order by ord
        ) from lecs
      ), '[]'::jsonb),
      'attachments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'type', type, 'title', title, 'description', description,
            'storage_path', storage_path, 'external_url', external_url,
            'body', body, 'order', ord
          ) order by ord
        ) from atts
      ), '[]'::jsonb),
      'quizzes', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id, 'title', title, 'description', description,
            'pass_score', pass_score, 'time_limit_sec', time_limit_sec,
            'max_attempts', max_attempts, 'sort_order', sort_order,
            'question_count', question_count, 'total_score', total_score,
            'attempts_used', attempts_used, 'attempts_left', attempts_left,
            'best_score', best_score, 'passed', passed,
            'in_progress_attempt_id', in_progress_attempt_id,
            'last_result_attempt_id', last_result_attempt_id,
            'availability', availability,
            'available_from', available_from,
            'available_until', available_until
          ) order by sort_order
        ) from qz
      ), '[]'::jsonb)
    )
  end;
$function$;

-- B3. get_home_page: root cards carry the status ------------------------------------------
create or replace function public.get_home_page()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with roots as (
    select id, title, cover_letter, "order", series_status  -- 0164
      from public.sections
     where parent_id is null
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(
              id, (select gender from public.profiles where id = auth.uid())
            )
       )
  ),
  root_rollups as (
    select section_id, total_lectures, completed_lectures
      from public.get_children_rollups(array(select id from roots))
  ),
  newest as (
    select l.id, l.title, coalesce(l.duration_sec, 0) as duration_sec,
           sh.name as sheikh_name, s.title as section_title, l.created_at
      from public.lectures l
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.sections s on s.id = l.section_id
     where l.status = 'published' and l.section_id is not null
       and (
         public.is_content_manager()
         or public.section_visible_to_viewer(
              l.section_id, (select gender from public.profiles where id = auth.uid())
            )
       )
     order by l.created_at desc
     limit 8
  ),
  resume as (
    select p.lecture_id, l.title, sh.name as sheikh_name, s.title as section_title,
           p.position_sec, coalesce(l.duration_sec, 0) as duration_sec, p.updated_at
      from public.user_lecture_progress p
      join public.lectures l on l.id = p.lecture_id
      left join public.sheikhs sh on sh.id = l.sheikh_id
      left join public.sections s on s.id = l.section_id
     where p.user_id = auth.uid() and p.completed = false and p.position_sec > 0
       and (
         l.section_id is null
         or public.is_content_manager()
         or public.section_visible_to_viewer(
              l.section_id, (select gender from public.profiles where id = auth.uid())
            )
       )
     order by p.updated_at desc
     limit 1
  )
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id, 'title', r.title, 'cover_letter', r.cover_letter,
          'total', coalesce(ru.total_lectures, 0),
          'completed', coalesce(ru.completed_lectures, 0),
          'series_status', r.series_status  -- 0164
        ) order by r."order"
      )
      from roots r
      left join root_rollups ru on ru.section_id = r.id
    ), '[]'::jsonb),
    'newly_added', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id, 'title', n.title, 'duration_sec', n.duration_sec,
          'sheikh_name', n.sheikh_name, 'section_title', n.section_title
        ) order by n.created_at desc
      ) from newest n
    ), '[]'::jsonb),
    'featured', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lecture_id', f.lecture_id, 'title', f.title, 'duration_sec', f.duration_sec,
          'sheikh_name', f.sheikh_name, 'section_title', f.section_title,
          'order', f."order", 'position_sec', f.position_sec, 'completed', f.completed
        ) order by f."order"
      ) from public.get_featured_lectures() f
    ), '[]'::jsonb),
    'continue_listening', (
      select jsonb_build_object(
        'lecture_id', rz.lecture_id, 'title', rz.title, 'sheikh_name', rz.sheikh_name,
        'section_title', rz.section_title, 'position_sec', rz.position_sec,
        'duration_sec', rz.duration_sec
      ) from resume rz
    )
  );
$function$;
