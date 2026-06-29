-- =============================================================================
-- 0006_notify_fanout.sql
-- منصة دروس العلم الشرعي — Phase 2 · الإشعارات server-side FAN-OUT
--
-- This is the live-only piece deferred by 0003 (see its trailer): when content
-- lands in a FOLLOWED section subtree, insert an in-app inbox row for every
-- follower whose pref is ON. Push DELIVERY (Expo Push → FCM) is handled by the
-- `notify-on-publish` Edge Function, fired by a Database Webhook on
-- public.notifications INSERT — so the inbox fan-out here works with ZERO
-- external setup, and only the actual device push needs the function + FCM.
--
-- Cross-user inserts bypass the own-rows RLS by design: every function here is
-- SECURITY DEFINER (owned by the migration role), exactly as 0003 anticipated.
-- Subtree semantics reuse the WITH RECURSIVE ancestor walk (CLAUDE.md: rollups
-- and tree-walks are SQL, never client-side).
--
-- Append-only migration. Idempotent: create-or-replace + drop-before-create.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- followers_of_section — distinct users following the section OR any ancestor.
-- A follow on an ancestor implies the whole subtree, so we walk UP from the
-- given section to the root and match follows against every node on the chain.
-- ---------------------------------------------------------------------------
create or replace function public.followers_of_section(p_section_id uuid)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  with recursive ancestors as (
    select id, parent_id from public.sections where id = p_section_id
    union all
    select s.id, s.parent_id
      from public.sections s
      join ancestors a on s.id = a.parent_id
  )
  select distinct sf.user_id
    from public.section_follows sf
    join ancestors a on a.id = sf.section_id;
$$;

-- ---------------------------------------------------------------------------
-- fanout_to_followers — internal helper. Inserts one inbox row per follower
-- whose pref for this type is ON (a missing prefs row = ON, per 0003). NOT for
-- client use: it writes into other users' rows, so EXECUTE is revoked from
-- everyone — triggers still run it (they invoke regardless of EXECUTE grants).
-- ---------------------------------------------------------------------------
create or replace function public.fanout_to_followers(
  p_section_id uuid,
  p_type       public.notification_type,
  p_title      text,
  p_body       text,
  p_data       jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, data)
  select f.user_id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb)
    from public.followers_of_section(p_section_id) f
    left join public.notification_prefs p
      on p.user_id = f.user_id and p.type = p_type
   where coalesce(p.enabled, true);  -- missing pref row = ON
$$;

revoke all on function public.fanout_to_followers(uuid, public.notification_type, text, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: a lecture becomes published → notify followers (new_lecture).
-- Fires on INSERT-as-published and on any UPDATE that transitions INTO
-- published (draft→published), never on re-saves that were already published.
-- ---------------------------------------------------------------------------
create or replace function public.notify_lecture_published()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform public.fanout_to_followers(
      new.section_id,
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
-- Trigger: an attachment is added → notify followers (new_attachment).
-- Section attachments notify that section's subtree. Lecture attachments notify
-- the lecture's section subtree, but only when the parent lecture is published
-- (no leaking draft-lecture activity — mirrors the attachments_select RLS).
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

  if v_section_id is not null then
    perform public.fanout_to_followers(
      v_section_id,
      'new_attachment',
      'مرفق جديد',
      new.title,
      jsonb_build_object(
        'attachmentId', new.id,
        'sectionId',    v_section_id,
        'lectureId',    new.lecture_id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists attachments_notify_added on public.attachments;
create trigger attachments_notify_added
  after insert on public.attachments
  for each row execute function public.notify_attachment_added();

-- followers_of_section is safe to expose (read-only, own follows visible anyway).
grant execute on function public.followers_of_section(uuid) to authenticated;
