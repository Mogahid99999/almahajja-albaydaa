-- =============================================================================
-- 0007_admin_and_notify_all.sql
-- منصة دروس العلم الشرعي — notify ALL students (drop the follow-gating)
--
-- The "follow a section" feature is being removed from the app. Instead of
-- fanning a new-lecture / new-attachment notification out to the FOLLOWERS of a
-- section subtree (0006), we now fan out to EVERY student whose per-type pref is
-- ON. Per-type prefs (notification_prefs; a missing row = ON, per 0003) keep it
-- calm and let a student mute a type, so "following" is no longer needed.
--
-- This migration only re-points the two notify triggers at a new fan-out helper;
-- NO schema/RLS changes are needed (admin CRUD already has *_admin_write RLS in
-- 0001/0002, and .ogg uploads need no bucket change — the `lectures` bucket has
-- no MIME restriction). The follower helpers (followers_of_section /
-- fanout_to_followers, 0006) are LEFT IN PLACE but go unused, and the
-- section_follows table stays (unused) so no data is dropped.
--
-- Append-only migration. Idempotent: create-or-replace + drop-before-create.
-- Never edit 0001–0006.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- fanout_to_all — internal helper. Inserts one inbox row per STUDENT whose pref
-- for this type is ON (a missing prefs row = ON, per 0003). Admins are NOT
-- notified (they are the ones publishing). NOT for client use: it writes into
-- other users' rows, so EXECUTE is revoked from everyone — triggers still run it
-- (they invoke regardless of EXECUTE grants), exactly like fanout_to_followers.
-- ---------------------------------------------------------------------------
create or replace function public.fanout_to_all(
  p_type  public.notification_type,
  p_title text,
  p_body  text,
  p_data  jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, data)
  select pr.id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb)
    from public.profiles pr
    left join public.notification_prefs p
      on p.user_id = pr.id and p.type = p_type
   where pr.role = 'student'
     and coalesce(p.enabled, true);  -- missing pref row = ON
$$;

revoke all on function public.fanout_to_all(public.notification_type, text, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Re-point: a lecture becomes published → notify ALL students (new_lecture).
-- Same fire conditions as 0006 (INSERT-as-published OR any transition INTO
-- published), only the fan-out target changes (followers → all students).
-- sectionId stays in the payload for deep-linking (may be null = unclassified).
-- ---------------------------------------------------------------------------
create or replace function public.notify_lecture_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform public.fanout_to_all(
      'new_lecture',
      'درس جديد',
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
-- Re-point: an attachment is added → notify ALL students (new_attachment).
-- Still stays SILENT for an attachment on an UNPUBLISHED lecture (no leaking
-- draft activity — mirrors attachments_select RLS). Section attachments always
-- notify. Deep-link payload keeps sectionId (may be null) + lectureId.
-- ---------------------------------------------------------------------------
create or replace function public.notify_attachment_added()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_section_id uuid;
  v_published  boolean;
begin
  if new.section_id is not null then
    v_section_id := new.section_id;
  else
    select l.section_id, (l.status = 'published')
      into v_section_id, v_published
      from public.lectures l
     where l.id = new.lecture_id;
    if not coalesce(v_published, false) then
      return new;  -- attachment on an unpublished lecture: stay silent
    end if;
  end if;

  perform public.fanout_to_all(
    'new_attachment',
    'مرفق جديد',
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
