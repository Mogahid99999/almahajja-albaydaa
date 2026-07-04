-- =============================================================================
-- 0034_broadcasts.sql
-- المَحجّة البَيْضَاء — V7 feature: التذكيرات النافعة (beneficial reminder broadcasts)
--
-- Admin/publisher broadcast messages to ALL students about virtuous seasons /
-- sunan (عاشوراء، عرفة، سنن الجمعة…). Distinct from activity notifications.
--
--   * public.broadcasts — the reminder records (soft-deleted, editable).
--     Read is plain RLS (any authenticated user, non-deleted rows); ALL writes
--     go through DEFINER RPCs gated on is_content_manager() (admin OR
--     publisher) — never raw table writes.
--   * create_broadcast — inserts + immediately FANS OUT one notifications row
--     of type 'beneficial_reminder' per student (per-type pref honoured via
--     the 0007 fanout_to_all helper) → the 0009 webhook pushes each.
--   * update_broadcast / delete_broadcast — edit / soft-delete; delete also
--     removes the broadcast's inbox rows so stale reminders don't linger.
--   * get_home_broadcasts — the Home-card window: show_on_home AND published
--     within the last 1 day AND not deleted.
--   * get_broadcast — the full record for the detail page.
--
-- Requires 0033 ('beneficial_reminder' enum value) committed first.
-- Append-only — 0001–0033 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.broadcasts (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  show_on_home boolean not null default false,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz,
  deleted_at   timestamptz
);

alter table public.broadcasts enable row level security;

drop policy if exists broadcasts_read on public.broadcasts;
create policy broadcasts_read on public.broadcasts
  for select to authenticated
  using (deleted_at is null);

grant select on public.broadcasts to authenticated;

-- ---------------------------------------------------------------------------
-- create_broadcast — insert + fan out to every student (pref-gated by
-- fanout_to_all). The push/inbox body is trimmed; the detail page loads the
-- full text from the broadcasts row via the carried route.
-- ---------------------------------------------------------------------------
create or replace function public.create_broadcast(
  p_title        text,
  p_body         text,
  p_show_on_home boolean default false
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

  insert into public.broadcasts (title, body, show_on_home, created_by, published_at)
  values (trim(p_title), trim(p_body), coalesce(p_show_on_home, false), auth.uid(), now())
  returning id into v_id;

  begin
    perform public.fanout_to_all(
      'beneficial_reminder',
      trim(p_title),
      left(trim(p_body), 300),
      jsonb_build_object(
        'route',       '/(student)/reminder/' || v_id,
        'broadcastId', v_id
      )
    );
  exception when others then
    null;  -- the broadcast exists even if the fan-out hiccups
  end;

  return v_id;
end;
$$;
grant execute on function public.create_broadcast(text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- update_broadcast — edits the record (already-sent inbox rows keep their
-- original wording; the detail page reflects the edit via the broadcast id).
-- ---------------------------------------------------------------------------
create or replace function public.update_broadcast(
  p_id           uuid,
  p_title        text,
  p_body         text,
  p_show_on_home boolean
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
         updated_at   = now()
   where id = p_id and deleted_at is null;
end;
$$;
grant execute on function public.update_broadcast(uuid, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_broadcast — soft-delete + remove its inbox rows (a deleted reminder
-- should not linger in students' inboxes or re-open its detail page).
-- ---------------------------------------------------------------------------
create or replace function public.delete_broadcast(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  update public.broadcasts set deleted_at = now(), updated_at = now()
   where id = p_id and deleted_at is null;
  delete from public.notifications
   where type = 'beneficial_reminder'
     and data->>'broadcastId' = p_id::text;
end;
$$;
grant execute on function public.delete_broadcast(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_home_broadcasts — active Home cards (1-day window). INVOKER: the RLS
-- read policy already scopes to non-deleted rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_home_broadcasts()
returns table (id uuid, title text, body text, published_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select b.id, b.title, b.body, b.published_at
    from public.broadcasts b
   where b.deleted_at is null
     and b.show_on_home
     and b.published_at > now() - interval '1 day'
   order by b.published_at desc;
$$;
grant execute on function public.get_home_broadcasts() to authenticated;

-- ---------------------------------------------------------------------------
-- get_broadcast — the full reminder for the detail page.
-- ---------------------------------------------------------------------------
create or replace function public.get_broadcast(p_id uuid)
returns table (
  id           uuid,
  title        text,
  body         text,
  show_on_home boolean,
  published_at timestamptz,
  updated_at   timestamptz
)
language sql stable security invoker set search_path = public as $$
  select b.id, b.title, b.body, b.show_on_home, b.published_at, b.updated_at
    from public.broadcasts b
   where b.id = p_id and b.deleted_at is null;
$$;
grant execute on function public.get_broadcast(uuid) to authenticated;
