-- =============================================================================
-- 0011_notify_content_wording.sql
-- المَحجّة البَيْضَاء — PLAN_V3 Phase 4: new-content phrase-bank wording
--
-- New-content notifications already broadcast to EVERY student (fanout_to_all,
-- 0007) — i.e. "all users without admins" (it filters role = 'student', so every
-- admin, including the publisher, is excluded). Audience is therefore already
-- correct; this migration only fixes the WORDING to the §11 bank:
--   * new_lecture  → title "أُضيف درس جديد في [اسم القسم]" (the "الذي تتابعه"
--     follower phrasing is dropped, since this is a full broadcast), body = the
--     lecture title. Unclassified (section_id null) lectures are NOT broadcast
--     for now (locked decision) — the trigger stays silent for them.
--   * new_attachment → title "أُضيف مرفق جديد يساعدك في [اسم الدرس]" for a lecture
--     attachment (names the lesson), or a plain "أُضيف مرفق جديد" for a section
--     attachment (no lesson to name); body = the attachment title.
--
-- Only re-creates the two trigger functions (audience + fan-out mechanism are
-- unchanged). Append-only, idempotent (create-or-replace + drop-before-create).
-- Never edit 0001–0010.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- new_lecture: name the section, drop the follower phrasing, skip unclassified.
-- ---------------------------------------------------------------------------
create or replace function public.notify_lecture_published()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_section_title text;
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    -- Locked decision: unclassified (no section) lectures are NOT broadcast.
    if new.section_id is null then
      return new;
    end if;
    select s.title into v_section_title
      from public.sections s where s.id = new.section_id;
    perform public.fanout_to_all(
      'new_lecture',
      'أُضيف درس جديد في ' || coalesce(v_section_title, ''),
      new.title,
      jsonb_build_object('lectureId', new.id, 'sectionId', new.section_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists lectures_notify_published on public.lectures;
create trigger lectures_notify_published
  after insert or update of status on public.lectures
  for each row execute function public.notify_lecture_published();

-- ---------------------------------------------------------------------------
-- new_attachment: name the lesson for a lecture attachment (bank phrase), or a
-- plain header for a section attachment. Still silent on UNPUBLISHED lectures.
-- ---------------------------------------------------------------------------
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
    v_title := 'أُضيف مرفق جديد';  -- section attachment: no lesson to name
  else
    select l.section_id, (l.status = 'published'), l.title
      into v_section_id, v_published, v_lecture_title
      from public.lectures l
     where l.id = new.lecture_id;
    if not coalesce(v_published, false) then
      return new;  -- attachment on an unpublished lecture: stay silent
    end if;
    v_title := 'أُضيف مرفق جديد يساعدك في ' || coalesce(v_lecture_title, '');
  end if;

  perform public.fanout_to_all(
    'new_attachment',
    v_title,
    new.title,
    jsonb_build_object(
      'attachmentId', new.id,
      'sectionId',    v_section_id,
      'lectureId',    new.lecture_id
    )
  );
  return new;
end;
$$;

drop trigger if exists attachments_notify_added on public.attachments;
create trigger attachments_notify_added
  after insert on public.attachments
  for each row execute function public.notify_attachment_added();
