-- =============================================================================
-- 0064_broadcasts_image_link.sql
-- المَحجّة البَيْضَاء — التذكيرات النافعة: optional image + action button.
--
-- Adds `image_path` (R2 key, bucket-relative, prefix `broadcasts/`), `link_url`
-- and `link_label` to broadcasts, threaded through create/update/get. The image
-- key also rides along in the push notification's `data` payload (as
-- `imagePath`) so notify-on-publish can mint a presigned R2 GET and attach it
-- as `richContent.image` (Expo Push → FCM BigPictureStyle / iOS attachment).
--
-- Broadcasts are already fully open-read (broadcasts_read policy, 0034 — no
-- publish gate), so their images get the same open gate in
-- can_read_storage_object (0063): any authenticated caller, no draft check.
--
-- Append-only — 0001–0063 are never edited. Idempotent.
-- =============================================================================

alter table public.broadcasts
  add column if not exists image_path text,
  add column if not exists link_url   text,
  add column if not exists link_label text;

-- ---------------------------------------------------------------------------
-- create_broadcast — now accepts the optional image/link fields. The extra
-- trailing params change the function's identity signature, so the old
-- 3-arg overload from 0034 must be dropped or PostgREST can't pick one
-- unambiguously when called with only the original 3 named params.
-- ---------------------------------------------------------------------------
drop function if exists public.create_broadcast(text, text, boolean);
create or replace function public.create_broadcast(
  p_title        text,
  p_body         text,
  p_show_on_home boolean default false,
  p_image_path   text default null,
  p_link_url     text default null,
  p_link_label   text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;

  insert into public.broadcasts (title, body, show_on_home, created_by, published_at, image_path, link_url, link_label)
  values (
    trim(p_title), trim(p_body), coalesce(p_show_on_home, false), auth.uid(), now(),
    nullif(trim(coalesce(p_image_path, '')), ''),
    nullif(trim(coalesce(p_link_url, '')), ''),
    nullif(trim(coalesce(p_link_label, '')), '')
  )
  returning id into v_id;

  begin
    perform public.fanout_to_all(
      'beneficial_reminder',
      trim(p_title),
      left(trim(p_body), 300),
      jsonb_build_object(
        'route',       '/(student)/reminder/' || v_id,
        'broadcastId', v_id
      ) || case when p_image_path is not null and trim(p_image_path) <> ''
             then jsonb_build_object('imagePath', trim(p_image_path))
             else '{}'::jsonb
           end
    );
  exception when others then
    null;  -- the broadcast exists even if the fan-out hiccups
  end;

  return v_id;
end;
$$;
grant execute on function public.create_broadcast(text, text, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- update_broadcast — same additions (fan-out already happened at create time).
-- Same overload-drop reasoning as create_broadcast above.
-- ---------------------------------------------------------------------------
drop function if exists public.update_broadcast(uuid, text, text, boolean);
create or replace function public.update_broadcast(
  p_id           uuid,
  p_title        text,
  p_body         text,
  p_show_on_home boolean,
  p_image_path   text default null,
  p_link_url     text default null,
  p_link_label   text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  update public.broadcasts
     set title        = coalesce(trim(p_title), title),
         body         = coalesce(trim(p_body), body),
         show_on_home = coalesce(p_show_on_home, show_on_home),
         image_path   = nullif(trim(coalesce(p_image_path, '')), ''),
         link_url     = nullif(trim(coalesce(p_link_url, '')), ''),
         link_label   = nullif(trim(coalesce(p_link_label, '')), ''),
         updated_at   = now()
   where id = p_id and deleted_at is null;
end;
$$;
grant execute on function public.update_broadcast(uuid, text, text, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_broadcast — returns the new fields for the detail page. Return type
-- changed (new OUT columns) so the old signature must be dropped first.
-- ---------------------------------------------------------------------------
drop function if exists public.get_broadcast(uuid);
create or replace function public.get_broadcast(p_id uuid)
returns table (
  id           uuid,
  title        text,
  body         text,
  show_on_home boolean,
  published_at timestamptz,
  updated_at   timestamptz,
  image_path   text,
  link_url     text,
  link_label   text
)
language sql stable security invoker set search_path = public as $$
  select b.id, b.title, b.body, b.show_on_home, b.published_at, b.updated_at,
         b.image_path, b.link_url, b.link_label
    from public.broadcasts b
   where b.id = p_id and b.deleted_at is null;
$$;
grant execute on function public.get_broadcast(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- can_read_storage_object (0063) — extend with the `broadcasts/` prefix.
-- Broadcasts have no publish gate at all (0034's broadcasts_read), so their
-- images are equally open to any authenticated caller.
-- ---------------------------------------------------------------------------
create or replace function public.can_read_storage_object(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_key like 'lectures/%' then
      public.is_content_manager()
      or exists (
        select 1 from public.lectures l
        where l.audio_path = p_key and l.status = 'published'
      )
    when p_key like 'attachments/%' then
      public.is_content_manager()
      or exists (
        select 1 from public.attachments a
        where a.storage_path = p_key
          and (
            a.section_id is not null
            or exists (
              select 1 from public.lectures l
              where l.id = a.lecture_id and l.status = 'published'
            )
          )
      )
    when p_key like 'broadcasts/%' then
      exists (
        select 1 from public.broadcasts b
        where b.image_path = p_key and b.deleted_at is null
      )
    else false
  end;
$$;

grant execute on function public.can_read_storage_object(text) to authenticated;
