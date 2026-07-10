-- =============================================================================
-- 0072_notify_broadcast_revert_and_lecture_gender_check.sql
-- المَحجّة البَيْضَاء — revert 0071's notify-time gender gate; move the guard to
-- the notification-open path instead.
--
-- Context: 0071 made new_lecture / new_attachment pushes gender-aware at
-- FAN-OUT time (only students who could see the section got notified). Owner
-- decided this added unwanted complexity to the push pipeline and asked to
-- simplify: broadcast to ALL students again (like before 0071), and instead
-- add a lightweight check ONLY at the moment a lecture is opened FROM a
-- notification (push shade or in-app inbox) — if the lecture's section isn't
-- visible to the viewer's gender, show a "this lecture is for the women's
-- section" message instead of silently playing it. No check on the normal
-- browse path (unaffected — get_section_page/get_home_page from 0049 already
-- hide the section there), so no added latency on regular playback.
--
-- Two pieces:
--   1. Re-point notify_lecture_published / notify_attachment_added back to
--      fanout_to_all (0007) — same functions 0071 replaced, reproduced
--      verbatim from 0011. fanout_to_all_for_section (0071) is LEFT IN PLACE,
--      unused, so no data/behavior is dropped elsewhere.
--   2. New RPC lecture_visible_to_viewer(lecture_id) — single round trip,
--      called only from the notification-tap deep-link handler, wrapping
--      section_visible_to_viewer (0049) for the lecture's section. A lecture
--      with no section (unclassified) is always visible (nothing to scope).
--
-- Append-only migration — 0001–0071 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Revert: back to the ungated broadcast-to-all-students fan-out (0007/0011).
-- ---------------------------------------------------------------------------
create or replace function public.notify_lecture_published()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_section_title text;
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
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

-- ---------------------------------------------------------------------------
-- lecture_visible_to_viewer — single-purpose check for the notification-open
-- guard. Returns true when the lecture is unclassified (no section, nothing
-- to scope) OR its section's ancestor chain is visible to the caller's own
-- gender (public.profiles.gender), via the same section_visible_to_viewer
-- (0049) rule the browse path already uses. SECURITY INVOKER — lectures/
-- sections are readable to authenticated already, and a user's own gender is
-- readable under profiles_select RLS.
-- ---------------------------------------------------------------------------
create or replace function public.lecture_visible_to_viewer(p_lecture_id uuid)
returns boolean
language sql stable security invoker set search_path = public as $$
  select case
    when l.section_id is null then true
    else public.section_visible_to_viewer(
           l.section_id, (select gender from public.profiles where id = auth.uid())
         )
  end
  from public.lectures l
  where l.id = p_lecture_id;
$$;

revoke all on function public.lecture_visible_to_viewer(uuid) from public;
grant execute on function public.lecture_visible_to_viewer(uuid) to authenticated;
