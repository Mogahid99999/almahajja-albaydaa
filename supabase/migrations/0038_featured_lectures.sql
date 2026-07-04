-- =============================================================================
-- 0038_featured_lectures.sql
-- المَحجّة البَيْضَاء — V8 Feature B: مختارات (curated picks) — REPLACES the
-- auto-sorted «أُضيف حديثاً» Home rail with an admin/publisher-curated list.
--
-- Staff hand-pick existing PUBLISHED lectures from anywhere on the platform and
-- add them to an ordered "مختارات" list that renders in the same Home slot.
--   * public.featured_lectures — the curated rows. World-readable (like
--     sections/lectures); ALL writes go through DEFINER RPCs gated on
--     is_content_manager() (admin OR publisher) — never a raw table write.
--   * get_featured_lectures — INVOKER: joins to lectures (+ sheikhs, sections)
--     filtered to status = 'published', folds in the CALLING user's own
--     progress via a left join on auth.uid(); one function serves both the Home
--     rail (ignores position/completed) and the full-list screen (uses them),
--     same pattern as get_section_rollup / get_streak_status.
--   * get_featured_lectures_admin — DEFINER, is_content_manager gate, NO status
--     filter (staff manage an entry even after its lecture is unpublished — it
--     just silently drops from the public rail per the filter above).
--   * add_/remove_/reorder_featured_lecture(s) — DEFINER, same gate.
--
-- Requires 0023 (is_content_manager). Append-only — 0001–0037 are never edited.
-- Idempotent.
-- =============================================================================

create table if not exists public.featured_lectures (
  id         uuid primary key default gen_random_uuid(),
  lecture_id uuid not null unique references public.lectures (id) on delete cascade,
  "order"    integer not null default 0,
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists featured_lectures_order_idx
  on public.featured_lectures ("order");

alter table public.featured_lectures enable row level security;

-- World-readable (any authenticated user, incl. native guests). Writes are
-- DEFINER RPCs only — no write policy.
drop policy if exists featured_lectures_read on public.featured_lectures;
create policy featured_lectures_read on public.featured_lectures
  for select to authenticated using (true);

grant select on public.featured_lectures to authenticated;

-- ---------------------------------------------------------------------------
-- get_featured_lectures — INVOKER. Public rail + full-list screen. auth.uid()
-- resolves to the caller, so the left-joined progress is always the caller's.
-- status = 'published' filter keeps an unpublished pick out of the public rail.
-- ---------------------------------------------------------------------------
create or replace function public.get_featured_lectures()
returns table (
  lecture_id    uuid,
  title         text,
  duration_sec  integer,
  sheikh_name   text,
  section_title text,
  "order"       integer,
  position_sec  integer,
  completed     boolean
)
language sql stable security invoker set search_path = public as $$
  select
    l.id,
    l.title,
    l.duration_sec,
    sh.name,
    s.title,
    f."order",
    coalesce(p.position_sec, 0),
    coalesce(p.completed, false)
  from public.featured_lectures f
  join public.lectures l
    on l.id = f.lecture_id and l.status = 'published'
  left join public.sheikhs sh on sh.id = l.sheikh_id
  left join public.sections s on s.id = l.section_id
  left join public.user_lecture_progress p
    on p.lecture_id = l.id and p.user_id = auth.uid()
  order by f."order" asc, f.created_at asc;
$$;

grant execute on function public.get_featured_lectures() to authenticated;

-- ---------------------------------------------------------------------------
-- get_featured_lectures_admin — DEFINER, is_content_manager gate. No status
-- filter (drafts/unclassified stay visible to staff). `status` is the app-level
-- status: 'unclassified' when the lecture has no section, else its db status.
-- ---------------------------------------------------------------------------
create or replace function public.get_featured_lectures_admin()
returns table (
  lecture_id    uuid,
  title         text,
  status        text,
  duration_sec  integer,
  sheikh_name   text,
  section_title text,
  "order"       integer
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  return query
    select
      l.id,
      l.title,
      case when l.section_id is null then 'unclassified' else l.status::text end,
      l.duration_sec,
      sh.name,
      s.title,
      f."order"
    from public.featured_lectures f
    join public.lectures l on l.id = f.lecture_id
    left join public.sheikhs sh on sh.id = l.sheikh_id
    left join public.sections s on s.id = l.section_id
    order by f."order" asc, f.created_at asc;
end;
$$;

grant execute on function public.get_featured_lectures_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- add_featured_lecture — append at max("order")+1. Idempotent per lecture.
-- ---------------------------------------------------------------------------
create or replace function public.add_featured_lecture(p_lecture_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  insert into public.featured_lectures (lecture_id, "order", added_by)
  values (
    p_lecture_id,
    coalesce((select max("order") from public.featured_lectures), 0) + 1,
    auth.uid()
  )
  on conflict (lecture_id) do nothing;
end;
$$;

grant execute on function public.add_featured_lecture(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- remove_featured_lecture — drop a curated entry.
-- ---------------------------------------------------------------------------
create or replace function public.remove_featured_lecture(p_lecture_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  delete from public.featured_lectures where lecture_id = p_lecture_id;
end;
$$;

grant execute on function public.remove_featured_lecture(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reorder_featured_lectures — set "order" = array position for each id. The
-- admin screen's ▲/▼ swap two entries client-side and pass the whole new order.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_featured_lectures(p_lecture_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_content_manager() then
    raise exception 'not allowed';
  end if;
  update public.featured_lectures f
     set "order" = u.ord::int
    from unnest(p_lecture_ids) with ordinality as u(lid, ord)
   where f.lecture_id = u.lid;
end;
$$;

grant execute on function public.reorder_featured_lectures(uuid[]) to authenticated;
