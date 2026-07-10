-- =============================================================================
-- 0071_notify_gender_scope.sql
-- المَحجّة البَيْضَاء — fix: new_lecture / new_attachment push leaked across gender
--
-- Bug: 0049 taught the READ path (get_home_page/get_section_page/...) to hide a
-- رجال-only or نساء-only section subtree from the other gender via
-- section_visible_to_viewer(), but never touched the NOTIFY path. The
-- new_lecture / new_attachment triggers (0006, re-pointed in 0007/0011) still
-- call fanout_to_all(), which broadcasts to EVERY student regardless of gender
-- — so publishing a lecture into a نساء-only section still pushed "درس جديد"
-- to male students too. Reported: notification for a قسم النساء lecture must
-- go to female students only, none to male.
--
-- Fix: a new fanout_to_all_for_section() helper — identical to fanout_to_all
-- (0007) but additionally requires section_visible_to_viewer(p_section_id,
-- profile.gender) for the recipient, i.e. the same "most restrictive wins"
-- ancestor-chain rule the read path already uses. Only the two
-- section-scoped triggers (notify_lecture_published, notify_attachment_added)
-- are re-pointed at it. fanout_to_all itself is UNCHANGED and stays in use by
-- create_broadcast (0034/0064) — broadcasts are a global admin announcement,
-- not tied to any section, so they are correctly gender-unscoped.
--
-- Append-only migration — 0001–0070 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- fanout_to_all_for_section — like fanout_to_all (0007), but a student only
-- receives the notification if the section (and its whole ancestor chain) is
-- visible to their gender, per section_visible_to_viewer (0049). A guest/null
-- gender profile only qualifies for an 'all'-visibility chain, same safe
-- default as the read path. NOT for client use — EXECUTE revoked, triggers
-- still run it regardless of grants (SECURITY DEFINER).
-- ---------------------------------------------------------------------------
create or replace function public.fanout_to_all_for_section(
  p_section_id uuid,
  p_type       public.notification_type,
  p_title      text,
  p_body       text,
  p_data       jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, data)
  select pr.id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb)
    from public.profiles pr
    left join public.notification_prefs p
      on p.user_id = pr.id and p.type = p_type
   where pr.role = 'student'
     and coalesce(p.enabled, true)  -- missing pref row = ON
     and (
       p_section_id is null
       or public.section_visible_to_viewer(p_section_id, pr.gender)
     )
$$;

revoke all on function public.fanout_to_all_for_section(uuid, public.notification_type, text, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-point: a lecture becomes published → notify students who can SEE this
-- section (gender-scoped). Same fire conditions and wording as 0011; only the
-- fan-out call changes.
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
    perform public.fanout_to_all_for_section(
      new.section_id,
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
-- Re-point: an attachment is added → notify students who can SEE this section
-- (gender-scoped). Same conditions/wording as 0011; only the fan-out call
-- changes. Still silent on an unpublished lecture's attachment.
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

  perform public.fanout_to_all_for_section(
    v_section_id,
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
