-- =============================================================================
-- 0083_broadcast_views.sql
-- المَحجّة البَيْضَاء — التذكيرات النافعة: per-reminder view tracking.
--
-- Records the DISTINCT users who opened a التذكير النافع detail page so admins
-- can see how many people each reminder reached (a plain reach count — no
-- ranking, no per-user exposure). One row per (broadcast, user); the first open
-- wins its `viewed_at` (upsert `on conflict do nothing`).
--
-- `record_broadcast_view` is DEFINER so a student can log their own view without
-- read access to anyone else's rows; it skips guests/anon (auth.uid() null) and
-- refuses orphan rows for missing/deleted broadcasts.
-- `get_broadcast_view_counts` is DEFINER + is_content_manager()-gated and returns
-- one (broadcast_id, view_count) pair per reminder for the admin list to map in.
--
-- Append-only — 0001–0082 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.broadcast_views (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  user_id      uuid not null references auth.users(id)        on delete cascade,
  viewed_at    timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);

create index if not exists broadcast_views_broadcast_idx
  on public.broadcast_views (broadcast_id);

alter table public.broadcast_views enable row level security;

-- Own-row insert + own-row select only. No update/delete policy (rows are
-- immutable; the DEFINER RPCs do the cross-user aggregate).
drop policy if exists broadcast_views_insert_own on public.broadcast_views;
create policy broadcast_views_insert_own on public.broadcast_views
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists broadcast_views_select_own on public.broadcast_views;
create policy broadcast_views_select_own on public.broadcast_views
  for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- record_broadcast_view — log the caller's view of a reminder (idempotent).
-- Guests/anon are skipped gracefully; a missing/deleted broadcast is a no-op so
-- we never accrue orphan rows. The first open keeps its viewed_at.
-- ---------------------------------------------------------------------------
create or replace function public.record_broadcast_view(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;  -- guest / anonymous session — nothing to attribute
  end if;
  if not exists (
    select 1 from public.broadcasts b
    where b.id = p_id and b.deleted_at is null
  ) then
    return;  -- unknown or deleted reminder — avoid orphan rows
  end if;

  insert into public.broadcast_views (broadcast_id, user_id)
  values (p_id, auth.uid())
  on conflict (broadcast_id, user_id) do nothing;
end;
$$;
grant execute on function public.record_broadcast_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_broadcast_view_counts — admin-only reach counts, one row per reminder.
-- ---------------------------------------------------------------------------
create or replace function public.get_broadcast_view_counts()
returns table (
  broadcast_id uuid,
  view_count   integer
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  return query
    select v.broadcast_id, count(distinct v.user_id)::integer as view_count
      from public.broadcast_views v
     group by v.broadcast_id;
end;
$$;
grant execute on function public.get_broadcast_view_counts() to authenticated;
