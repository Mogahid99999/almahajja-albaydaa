-- =============================================================================
-- 0121_broadcast_gender_filter.sql
-- المَحجّة البَيْضَاء — add a gender filter to targeted التذكيرات النافعة (0120).
--
-- Admins can now also narrow recipients to رجال (male) or نساء (female). Gender
-- is a single value per student (profiles.gender = 'male' | 'female' | null),
-- so the picker treats it as one selectable value (null = any gender), combined
-- with the existing no-email / not-registered filters via AND. A null/empty
-- p_gender preserves the current behaviour exactly.
--
-- Both functions gain a trailing `p_gender text` param (new identity → new
-- overload; the 0120 versions are dropped so we don't leave a stale one behind).
--
-- Append-only — 0001–0120 are never edited. Idempotent.
-- =============================================================================

-- 1. Picker: + p_gender ---------------------------------------------------------
drop function if exists public.admin_broadcast_recipients(text, boolean, boolean, int, int);

create or replace function public.admin_broadcast_recipients(
  p_search         text    default null,
  p_no_email       boolean default false,
  p_not_registered boolean default false,
  p_gender         text    default null,
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
      and (p_gender is null or btrim(p_gender) = '' or p.gender = p_gender)
  )
  select b.*, count(*) over () as total_count
    from base b
   order by b.display_name nulls last, b.id
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
revoke execute on function public.admin_broadcast_recipients(text, boolean, boolean, text, int, int)
  from public, anon;
grant execute on function public.admin_broadcast_recipients(text, boolean, boolean, text, int, int)
  to authenticated;

-- 2. Targeted create: + p_gender ------------------------------------------------
drop function if exists public.create_broadcast_targeted(
  text, text, boolean, text, text, text, text, boolean, boolean, uuid[]);

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
  p_gender         text      default null,
  p_user_ids       uuid[]    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid;
  v_targeted  boolean;
  v_gender    text := nullif(btrim(coalesce(p_gender, '')), '');
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;

  v_targeted := coalesce(p_no_email, false)
             or coalesce(p_not_registered, false)
             or v_gender is not null
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
                 and (v_gender is null                      or p.gender = v_gender)
                ))
           -- when specific ids are given AND no attribute filter is on, the pool
           -- is JUST those ids (handled by the union below); exclude the broad set
           and (
                 coalesce(p_no_email, false)
              or coalesce(p_not_registered, false)
              or v_gender is not null
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
  text, text, boolean, text, text, text, text, boolean, boolean, text, uuid[])
  from public, anon;
grant execute on function public.create_broadcast_targeted(
  text, text, boolean, text, text, text, text, boolean, boolean, text, uuid[])
  to authenticated;

-- Legacy create_broadcast now delegates with a null gender (all-students).
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
    p_audio_path, false, false, null, null
  );
$$;
revoke execute on function public.create_broadcast(text, text, boolean, text, text, text, text)
  from public, anon;
grant execute on function public.create_broadcast(text, text, boolean, text, text, text, text)
  to authenticated;
