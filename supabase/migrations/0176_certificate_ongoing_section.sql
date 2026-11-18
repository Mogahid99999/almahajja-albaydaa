-- =============================================================================
-- 0176_certificate_ongoing_section.sql
-- المَحجّة البَيْضَاء — قسم «مستمر» لا يصدر شهادته حتى ينتهي.
--
-- series_status = 'ongoing' makes certificate_eligibility not eligible, on top of
-- every existing condition. Every issuing path goes through it, so no certificate
-- row and no notice exist early. 'completed' and unset (null) behave as before.
-- Certificates already issued are not touched.
--
-- When a section leaves 'ongoing', a job on fanout_queue issues the certificates
-- of students who already met the conditions, 200 per 10 s tick, outside the
-- admin's request. certificates_one_per_student keeps it free of duplicates, and
-- notices use the existing notifications trigger and paced push queue.
--
-- Storage (db-storage-engineering): one short-lived operational job per status
-- change; no new columns. Rollback: drop the trigger and run function, restore
-- certificate_eligibility_core from 0173 and process_fanout_queue from 0164.
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

create or replace function public.certificate_eligibility_core(p_section uuid, v_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c           public.section_certificate_settings%rowtype;
  v_scope     text;
  v_gender    text;
  v_total     int;
  v_done      int;
  v_required  int;
  v_lect_met  boolean;
  v_items     jsonb;
  v_q_req     int;
  v_q_passed  int;
  v_quiz_met  boolean;
  v_ongoing   boolean;
begin
  if not exists (select 1 from public.sections where id = p_section) then
    raise exception 'القسم غير موجود' using errcode = 'P0002';
  end if;

  select * into c from public.section_certificate_settings where section_id = p_section;
  select gender into v_gender from public.profiles where id = v_user;
  select coalesce(series_status = 'ongoing', false) into v_ongoing
    from public.sections where id = p_section;
  v_scope := coalesce(c.content_scope, 'section');

  -- 'none': lectures are not part of this certificate at all, so nothing is counted.
  if coalesce(c.lecture_rule, 'all') = 'none' then
    v_total := 0;
    v_done := 0;
    v_required := 0;
    v_lect_met := true;
  else
    -- Lectures: published, in the content scope (this section / its whole
    -- subtree), in sections this student may see.
    with sec as (
      select s.id
        from (select p_section as id where v_scope = 'section'
              union all
              select t.id from public.section_subtree_ids(p_section) as t(id) where v_scope = 'subtree') s
       where public.section_visible_to_viewer(s.id, v_gender)
    )
    select count(*)::int,
           count(*) filter (where p.completed)::int
      into v_total, v_done
      from public.lectures l
      left join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = v_user
     where l.status = 'published'
       and l.section_id in (select id from sec);

    v_required := case
      when coalesce(c.lecture_rule, 'all') = 'percent'
        then ceil(v_total * c.lecture_pct / 100.0)::int
      else v_total
    end;
    v_lect_met := v_total > 0 and v_done >= greatest(v_required, 1);
  end if;

  -- Quizzes: the admin's picks that are published and visible to this student.
  if coalesce(c.quiz_rule, 'none') = 'selected' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'quiz_id',         q.id,
             'title',           q.title,
             'passed',          x.passed,
             'pending_grading', x.pending and not x.passed
           ) order by q."order", q.title), '[]'::jsonb),
           count(*)::int,
           count(*) filter (where x.passed)::int
      into v_items, v_q_req, v_q_passed
      from public.section_certificate_quizzes r
      join public.quizzes q on q.id = r.quiz_id
      cross join lateral (
        select coalesce(bool_or(a.passed is true
                                and a.submitted_at is not null
                                and coalesce(a.grading_status, '') <> 'pending'), false) as passed,
               coalesce(bool_or(a.grading_status = 'pending'), false)                    as pending
          from public.quiz_attempts a
         where a.quiz_id = q.id and a.user_id = v_user
      ) x
     where r.section_id = p_section
       and q.status = 'published'
       and public.section_visible_to_viewer(q.section_id, v_gender);
    v_quiz_met := v_q_passed = v_q_req;
  else
    v_items := '[]'::jsonb;
    v_q_req := 0;
    v_q_passed := 0;
    v_quiz_met := true;
  end if;

  return jsonb_build_object(
    'section_id', p_section,
    'user_id',    v_user,
    'enabled',    coalesce(c.enabled, false),
    -- With no lecture condition at least one quiz must really be required of this student:
    -- all required quizzes back to draft, deleted or hidden must never mean «eligible».
    'series_ongoing', v_ongoing,
    'eligible',   coalesce(c.enabled, false) and not v_ongoing and v_lect_met and v_quiz_met
                  and (coalesce(c.lecture_rule, 'all') <> 'none' or v_q_req > 0),
    'lectures', jsonb_build_object(
      'scope',     v_scope,
      'rule',      coalesce(c.lecture_rule, 'all'),
      'pct',       c.lecture_pct,
      'total',     v_total,
      'completed', v_done,
      'required',  v_required,
      'completed_pct', case when v_total > 0 then round(v_done * 100.0 / v_total, 2) else 0 end,
      'met',       v_lect_met),
    'quizzes', jsonb_build_object(
      'rule',           coalesce(c.quiz_rule, 'none'),
      'required_count', v_q_req,
      'passed_count',   v_q_passed,
      'met',            v_quiz_met,
      'items',          v_items)
  );
end;
$$;
revoke all on function public.certificate_eligibility_core(uuid, uuid) from public, anon, authenticated;

alter table public.fanout_queue drop constraint if exists fanout_queue_kind_check;
alter table public.fanout_queue
  add constraint fanout_queue_kind_check
  check (kind in ('broadcast', 'lecture', 'live_start', 'live_reminder', 'attachment', 'quiz', 'certificates'));

-- Returns the cursor for the next batch, or null when finished.
create or replace function public.run_certificate_reevaluation(p_section uuid, p_after uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c      public.section_certificate_settings%rowtype;
  r      record;
  v_n    int := 0;
  v_last uuid;
begin
  select * into c from public.section_certificate_settings where section_id = p_section and enabled;
  if not found then return null; end if;
  if exists (select 1 from public.sections where id = p_section and series_status = 'ongoing') then
    return null;  -- moved back while the job waited
  end if;

  for r in
    select u.user_id from (
      select p.user_id
        from public.user_lecture_progress p
        join public.lectures l on l.id = p.lecture_id
       where c.lecture_rule <> 'none' and p.completed
         and l.section_id in (
           select p_section where c.content_scope = 'section'
           union all
           select t.id from public.section_subtree_ids(p_section) as t(id) where c.content_scope = 'subtree')
      union
      select a.user_id
        from public.quiz_attempts a
        join public.section_certificate_quizzes q on q.quiz_id = a.quiz_id
       where q.section_id = p_section and a.passed is true and a.submitted_at is not null
         and coalesce(a.grading_status, '') <> 'pending'
    ) u
     where p_after is null or u.user_id > p_after
     order by u.user_id
     limit 200
  loop
    v_n := v_n + 1;
    v_last := r.user_id;
    begin
      perform public.issue_certificate_if_eligible(p_section, r.user_id);
    exception when others then
      raise warning 'certificate reevaluation failed (section %, user %): %', p_section, r.user_id, sqlerrm;
    end;
  end loop;
  return case when v_n = 200 then v_last end;
end;
$$;
revoke all on function public.run_certificate_reevaluation(uuid, uuid) from public, anon, authenticated;

create or replace function public.sections_on_series_finished()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.section_certificate_settings
              where section_id = new.id and enabled) then
    insert into public.fanout_queue (kind, ref_id) values ('certificates', new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.sections_on_series_finished() from public, anon, authenticated;
drop trigger if exists sections_on_series_finished on public.sections;
create trigger sections_on_series_finished
  after update of series_status on public.sections
  for each row
  when (old.series_status = 'ongoing' and new.series_status is distinct from 'ongoing')
  execute function public.sections_on_series_finished();

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
  v_next  uuid;
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
      elsif j.kind = 'certificates' then
        -- 0176: one batch per tick; the job comes back until the list is exhausted.
        v_next := public.run_certificate_reevaluation(j.ref_id, (j.params ->> 'after')::uuid);
        if v_next is not null then
          update public.fanout_queue
             set params = params || jsonb_build_object('after', v_next), attempts = 0
           where id = j.id;
          v_wait := true;
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
revoke all on function public.process_fanout_queue() from public, anon, authenticated;
