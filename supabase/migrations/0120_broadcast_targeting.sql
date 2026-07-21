-- =============================================================================
-- 0120_broadcast_targeting.sql
-- المَحجّة البَيْضَاء — targeted التذكيرات النافعة.
--
-- Until now every broadcast fanned out to ALL students (fanout_to_all, 0007).
-- Admins now want to aim a reminder at a subset:
--   • specific hand-picked users, and/or
--   • users with NO email, and/or
--   • users who are NOT registered (guest / anonymous sessions).
-- Filters combine with AND (a narrower pool as more are enabled); any
-- explicitly-picked user ids are UNIONed on top of the filtered pool. With no
-- filter and no ids the behaviour is IDENTICAL to today (all students).
--
-- "Registered" == auth.users.is_anonymous = false (same signal as
-- admin_user_list, 0075). "Has email" == auth.users.email is not null.
--
-- Home card: a targeted reminder's «إظهار كبطاقة في الرئيسية» must only surface
-- for the users who actually received it — not globally. We mark such rows
-- broadcasts.is_targeted = true and teach get_home_broadcasts to require, for a
-- targeted row, that the caller has an inbox row for it (data->>'broadcastId').
-- Non-targeted rows keep the old global Home behaviour.
--
-- Three pieces:
--   1. broadcasts.is_targeted column (default false; existing rows = global).
--   2. admin_broadcast_recipients() — admin-only paged candidate picker with the
--      same no_email / not_registered filters, so the UI can list + «select all».
--   3. create_broadcast_targeted() — resolves the recipient set server-side and
--      fans out (inbox rows → push webhook), honouring the beneficial_reminder
--      pref. Legacy create_broadcast is left in place and now delegates to it
--      with an empty target (= all students) so nothing else has to change.
--   4. get_home_broadcasts() — inbox-scoped for targeted rows.
--
-- Append-only — 0001–0119 are never edited. Idempotent.
-- =============================================================================

-- 1. Mark targeted broadcasts ---------------------------------------------------
alter table public.broadcasts
  add column if not exists is_targeted boolean not null default false;

-- 2. Admin candidate picker -----------------------------------------------------
-- Same student pool the fan-out can reach, with optional no-email / not-registered
-- filters (AND) and a search over name / email / phone. Admin-only DEFINER
-- (reads auth.users). Returns a total_count window so the UI can offer «تحديد الكل».
create or replace function public.admin_broadcast_recipients(
  p_search         text    default null,
  p_no_email       boolean default false,
  p_not_registered boolean default false,
  p_limit          int     default 100,
  p_offset         int     default 0
)
returns table (
  id            uuid,
  display_name  text,
  email         text,
  phone         text,
  is_anonymous  boolean,
  total_count   bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select
      p.id,
      coalesce(nullif(p.display_name, ''),
               nullif(u.raw_user_meta_data->>'display_name','')) as display_name,
      u.email,
      u.phone,
      coalesce(u.is_anonymous, false) as is_anonymous
    from public.profiles p
    left join auth.users u on u.id = p.id
    where public.is_admin()
      and p.role = 'student'
      and (
        p_search is null or btrim(p_search) = ''
        or coalesce(p.display_name,'') ilike '%' || p_search || '%'
        or coalesce(u.email,'')        ilike '%' || p_search || '%'
        or coalesce(u.phone,'')        ilike '%' || p_search || '%'
      )
      and (not p_no_email       or u.email is null)
      and (not p_not_registered or coalesce(u.is_anonymous, false) = true)
  )
  select b.*, count(*) over () as total_count
    from base b
   order by b.display_name nulls last, b.id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
revoke execute on function public.admin_broadcast_recipients(text, boolean, boolean, int, int)
  from public, anon;
grant execute on function public.admin_broadcast_recipients(text, boolean, boolean, int, int)
  to authenticated;

-- 3. Targeted create + fan-out --------------------------------------------------
-- Resolves the recipient set = (filtered student pool) ∪ (explicit p_user_ids),
-- then inserts one beneficial_reminder inbox row per recipient whose pref is ON
-- (missing pref row = ON). p_user_ids NULL/empty and both filters false → the
-- whole student pool = the historical fanout_to_all behaviour, and the row is
-- flagged is_targeted only when a real filter/selection is present.
create or replace function public.create_broadcast_targeted(
  p_title          text,
  p_body           text,
  p_show_on_home   boolean   default false,
  p_image_path     text      default null,
  p_link_url       text      default null,
  p_link_label     text      default null,
  p_audio_path     text      default null,
  p_no_email       boolean   default false,
  p_not_registered boolean   default false,
  p_user_ids       uuid[]    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid;
  v_targeted  boolean;
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;

  v_targeted := coalesce(p_no_email, false)
             or coalesce(p_not_registered, false)
             or coalesce(array_length(p_user_ids, 1), 0) > 0;

  insert into public.broadcasts
    (title, body, show_on_home, created_by, published_at,
     image_path, link_url, link_label, audio_path, is_targeted)
  values (
    trim(p_title), trim(p_body), coalesce(p_show_on_home, false), auth.uid(), now(),
    nullif(trim(coalesce(p_image_path, '')), ''),
    nullif(trim(coalesce(p_link_url, '')), ''),
    nullif(trim(coalesce(p_link_label, '')), ''),
    nullif(trim(coalesce(p_audio_path, '')), ''),
    v_targeted
  )
  returning id into v_id;

  begin
    insert into public.notifications (user_id, type, title, body, data)
    select r.id, 'beneficial_reminder', trim(p_title), left(trim(p_body), 300),
           jsonb_build_object(
             'route',       '/(student)/reminder/' || v_id,
             'broadcastId', v_id
           ) || case when p_image_path is not null and trim(p_image_path) <> ''
                  then jsonb_build_object('imagePath', trim(p_image_path))
                  else '{}'::jsonb
                end
      from (
        -- filtered student pool (only applied when this IS a targeted send)
        select p.id
          from public.profiles p
          left join auth.users u on u.id = p.id
         where p.role = 'student'
           and (not v_targeted
                or (
                     (not coalesce(p_no_email, false)       or u.email is null)
                 and (not coalesce(p_not_registered, false) or coalesce(u.is_anonymous, false) = true)
                ))
           -- when specific ids are given AND no attribute filter is on, the pool
           -- is JUST those ids (handled by the union below); exclude the broad set
           and (
                 coalesce(p_no_email, false)
              or coalesce(p_not_registered, false)
              or coalesce(array_length(p_user_ids, 1), 0) = 0
               )
        union
        -- explicitly picked users (union on top of the filtered pool)
        select p.id
          from public.profiles p
         where p.role = 'student'
           and p_user_ids is not null
           and p.id = any(p_user_ids)
      ) r
      left join public.notification_prefs np
        on np.user_id = r.id and np.type = 'beneficial_reminder'
     where coalesce(np.enabled, true);  -- missing pref row = ON
  exception when others then
    null;  -- the broadcast exists even if the fan-out hiccups
  end;

  return v_id;
end;
$$;
revoke execute on function public.create_broadcast_targeted(
  text, text, boolean, text, text, text, text, boolean, boolean, uuid[])
  from public, anon;
grant execute on function public.create_broadcast_targeted(
  text, text, boolean, text, text, text, text, boolean, boolean, uuid[])
  to authenticated;

-- Legacy create_broadcast now delegates (all-students, non-targeted). Keeps the
-- existing 7-arg identity + grant so nothing else changes.
create or replace function public.create_broadcast(
  p_title        text,
  p_body         text,
  p_show_on_home boolean default false,
  p_image_path   text default null,
  p_link_url     text default null,
  p_link_label   text default null,
  p_audio_path   text default null
) returns uuid
language sql security definer set search_path = public as $$
  select public.create_broadcast_targeted(
    p_title, p_body, p_show_on_home, p_image_path, p_link_url, p_link_label,
    p_audio_path, false, false, null
  );
$$;
-- Tighten a latent hygiene gap: create_broadcast has carried the default PUBLIC
-- EXECUTE grant since 0034 (the is_content_manager() gate always blocked misuse,
-- so it was never exploitable). Bring it in line with the new functions.
revoke execute on function public.create_broadcast(text, text, boolean, text, text, text, text)
  from public, anon;
grant execute on function public.create_broadcast(text, text, boolean, text, text, text, text)
  to authenticated;

-- 4. Home card, inbox-scoped for targeted rows ----------------------------------
-- Non-targeted rows: global (unchanged). Targeted rows: only if the caller has a
-- beneficial_reminder inbox row for this broadcast (i.e. was a recipient).
create or replace function public.get_home_broadcasts()
returns table (id uuid, title text, body text, published_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select b.id, b.title, b.body, b.published_at
    from public.broadcasts b
   where b.deleted_at is null
     and b.show_on_home
     and b.published_at > now() - interval '1 day'
     and (
       not b.is_targeted
       or exists (
         select 1 from public.notifications n
          where n.user_id = auth.uid()
            and n.data->>'broadcastId' = b.id::text
       )
     )
   order by b.published_at desc;
$$;
grant execute on function public.get_home_broadcasts() to authenticated;
