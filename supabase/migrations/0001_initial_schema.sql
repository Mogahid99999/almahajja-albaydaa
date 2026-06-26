-- =============================================================================
-- 0001_initial_schema.sql
-- منصة دروس العلم الشرعي — initial schema
--
-- Nested section tree + lectures + per-user progress, with RLS and the
-- recursive-CTE rollup functions described in
-- .claude/skills/nested-sections/SKILL.md (Supabase/Postgres implementation).
--
-- Idempotent: safe to re-run (drops policies/triggers before recreating).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.lecture_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.app_role as enum ('student', 'admin');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One profile per auth user; carries the role (student | admin).
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.app_role not null default 'student',
  display_name text,
  created_at   timestamptz not null default now()
);

-- Recursive section tree. A node may hold child sections, lectures, or both;
-- "leaf" is determined by data, not by a separate type.
create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  cover_image text,
  "order"     integer not null default 0,
  parent_id   uuid references public.sections (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.sheikhs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- A lecture always belongs to exactly one section. Drafts are invisible to
-- students (enforced by RLS below).
create table if not exists public.lectures (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  audio_path   text not null,                          -- path in the `lectures` storage bucket
  duration_sec integer,                                -- filled in after upload processing
  "order"      integer not null default 0,
  status       public.lecture_status not null default 'draft',
  section_id   uuid not null references public.sections (id) on delete cascade,
  sheikh_id    uuid references public.sheikhs (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Personal progress. Never compared between students; never rolls sideways.
create table if not exists public.user_lecture_progress (
  user_id      uuid not null references auth.users (id) on delete cascade,
  lecture_id   uuid not null references public.lectures (id) on delete cascade,
  position_sec integer not null default 0,
  completed    boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, lecture_id)
);

-- ---------------------------------------------------------------------------
-- Indexes (hot paths from the nested-sections skill)
-- ---------------------------------------------------------------------------
create index if not exists sections_parent_order_idx
  on public.sections (parent_id, "order");
create index if not exists lectures_section_order_idx
  on public.lectures (section_id, "order");
create index if not exists lectures_status_idx
  on public.lectures (status);
create index if not exists user_progress_user_idx
  on public.user_lecture_progress (user_id);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at + profile-on-signup
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists sections_set_updated_at on public.sections;
create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

drop trigger if exists lectures_set_updated_at on public.lectures;
create trigger lectures_set_updated_at
  before update on public.lectures
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Authorization helper (SECURITY DEFINER avoids RLS recursion on profiles)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles               enable row level security;
alter table public.sections               enable row level security;
alter table public.sheikhs                enable row level security;
alter table public.lectures               enable row level security;
alter table public.user_lecture_progress  enable row level security;

-- profiles: a user reads their own; admins read all; only admins write.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- sections / sheikhs: any signed-in user reads; only admins write.
drop policy if exists sections_select on public.sections;
create policy sections_select on public.sections
  for select to authenticated using (true);

drop policy if exists sections_admin_write on public.sections;
create policy sections_admin_write on public.sections
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists sheikhs_select on public.sheikhs;
create policy sheikhs_select on public.sheikhs
  for select to authenticated using (true);

drop policy if exists sheikhs_admin_write on public.sheikhs;
create policy sheikhs_admin_write on public.sheikhs
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- lectures: students see PUBLISHED only; admins see all and write.
drop policy if exists lectures_select on public.lectures;
create policy lectures_select on public.lectures
  for select to authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists lectures_admin_write on public.lectures;
create policy lectures_admin_write on public.lectures
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- progress: a user reads/writes only their own rows.
drop policy if exists progress_own on public.user_lecture_progress;
create policy progress_own on public.user_lecture_progress
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants (RLS still gates row access; these are table-level privileges)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.sections to authenticated;
grant select, insert, update, delete on public.sheikhs to authenticated;
grant select, insert, update, delete on public.lectures to authenticated;
grant select, insert, update, delete on public.user_lecture_progress to authenticated;
grant update on public.profiles to authenticated;

-- =============================================================================
-- Recursive rollup functions (called from the client via supabase.rpc(...))
-- All run with the caller's identity: progress is scoped to auth.uid() and
-- only PUBLISHED lectures are counted.
-- =============================================================================

-- Subtree rollup for a single section (header counts + sheikh list).
create or replace function public.get_section_rollup(p_section_id uuid)
returns table (
  total_lectures     bigint,
  completed_lectures bigint,
  sheikh_names       text[]
)
language sql stable security invoker set search_path = public as $$
  with recursive subtree as (
    select id from public.sections where id = p_section_id
    union all
    select s.id from public.sections s
      join subtree t on s.parent_id = t.id
  )
  select
    count(l.id)                                          as total_lectures,
    count(p.lecture_id) filter (where p.completed)       as completed_lectures,
    coalesce(
      array_agg(distinct sh.name) filter (where sh.name is not null),
      '{}'::text[]
    )                                                    as sheikh_names
  from subtree st
  join public.lectures l
    on l.section_id = st.id and l.status = 'published'
  left join public.user_lecture_progress p
    on p.lecture_id = l.id and p.user_id = auth.uid()
  left join public.sheikhs sh
    on sh.id = l.sheikh_id;
$$;

-- Per-root rollup for a set of sibling sections (subsection cards / home grid).
-- Roots with zero published lectures are omitted; the client defaults them to 0.
create or replace function public.get_children_rollups(p_section_ids uuid[])
returns table (
  section_id         uuid,
  total_lectures     bigint,
  completed_lectures bigint
)
language sql stable security invoker set search_path = public as $$
  with recursive subtree as (
    select id, id as root_id
      from public.sections
     where id = any(p_section_ids)
    union all
    select s.id, t.root_id
      from public.sections s
      join subtree t on s.parent_id = t.id
  )
  select
    st.root_id                                     as section_id,
    count(l.id)                                    as total_lectures,
    count(p.lecture_id) filter (where p.completed) as completed_lectures
  from subtree st
  join public.lectures l
    on l.section_id = st.id and l.status = 'published'
  left join public.user_lecture_progress p
    on p.lecture_id = l.id and p.user_id = auth.uid()
  group by st.root_id;
$$;

-- Whole tree flattened with depth + path, for the admin parent-section picker.
create or replace function public.get_sections_flat()
returns table (
  id        uuid,
  title     text,
  parent_id uuid,
  depth     integer,
  path      text[]
)
language sql stable security invoker set search_path = public as $$
  with recursive tree as (
    select s.id, s.title, s.parent_id, 0 as depth, array[s.title] as path
      from public.sections s
     where s.parent_id is null
    union all
    select s.id, s.title, s.parent_id, t.depth + 1, t.path || s.title
      from public.sections s
      join tree t on s.parent_id = t.id
  )
  select id, title, parent_id, depth, path
    from tree
   order by path;
$$;

grant execute on function public.get_section_rollup(uuid)   to authenticated;
grant execute on function public.get_children_rollups(uuid[]) to authenticated;
grant execute on function public.get_sections_flat()        to authenticated;
grant execute on function public.is_admin()                 to authenticated;

-- =============================================================================
-- Storage: private bucket for lecture audio + downloads
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('lectures', 'lectures', false)
on conflict (id) do nothing;

-- Any signed-in user may read (so the app can mint signed URLs); admins write.
drop policy if exists lectures_objects_read on storage.objects;
create policy lectures_objects_read on storage.objects
  for select to authenticated
  using (bucket_id = 'lectures');

drop policy if exists lectures_objects_admin_write on storage.objects;
create policy lectures_objects_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'lectures' and public.is_admin())
  with check (bucket_id = 'lectures' and public.is_admin());
