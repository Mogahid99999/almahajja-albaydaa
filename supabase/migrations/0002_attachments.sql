-- =============================================================================
-- 0002_attachments.sql
-- منصة دروس العلم الشرعي — Phase 2 · Attachments
--
-- Any section node OR lecture can carry attachments of type
-- pdf / book(كتاب) / transcript(تفريغ) / image(صورة) / link(رابط).
-- Students view & download; admins add/remove per node or per lecture.
--
-- Slots into the existing data-driven renderer (no schema changes to sections
-- /lectures): a node/lecture simply gains an extra `attachments[]` array in its
-- DTO. Append-only migration — 0001 is never edited.
--
-- Idempotent: safe to re-run (drops policies/triggers before recreating).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.attachment_type as enum
    ('pdf', 'book', 'transcript', 'image', 'link');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
-- Polymorphic owner enforced by a CHECK: exactly one of (section_id, lecture_id)
-- is non-null. Mirrors how a node OR a lecture owns the attachment.
create table if not exists public.attachments (
  id            uuid primary key default gen_random_uuid(),
  type          public.attachment_type not null,
  title         text not null,
  description   text,
  storage_path  text,        -- path in the `attachments` bucket (pdf/image/transcript)
  external_url  text,        -- for type='link' and 'book' references
  "order"       integer not null default 0,
  section_id    uuid references public.sections (id) on delete cascade,
  lecture_id    uuid references public.lectures (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint attachment_owner_one check (
    (section_id is not null)::int + (lecture_id is not null)::int = 1
  ),
  constraint attachment_payload check (
    (type = 'link'  and external_url is not null) or
    (type = 'book'  and (external_url is not null or storage_path is not null)) or
    (type in ('pdf', 'image', 'transcript') and storage_path is not null)
  )
);

create index if not exists attachments_section_idx
  on public.attachments (section_id, "order");
create index if not exists attachments_lecture_idx
  on public.attachments (lecture_id, "order");

-- updated_at trigger (reuse public.set_updated_at from 0001)
drop trigger if exists attachments_set_updated_at on public.attachments;
create trigger attachments_set_updated_at
  before update on public.attachments
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.attachments enable row level security;

-- read: section attachments are visible to any signed-in user; lecture
-- attachments only when the parent lecture is published (admins see all).
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated using (
    public.is_admin()
    or section_id is not null
    or exists (
      select 1 from public.lectures l
      where l.id = attachments.lecture_id and l.status = 'published'
    )
  );

drop policy if exists attachments_admin_write on public.attachments;
create policy attachments_admin_write on public.attachments
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.attachments to authenticated;

-- =============================================================================
-- Storage: private bucket for attachment files (pdf/image/transcript)
-- Same policy shape as the `lectures` bucket in 0001.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists attachments_objects_read on storage.objects;
create policy attachments_objects_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments');

drop policy if exists attachments_objects_admin_write on storage.objects;
create policy attachments_objects_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'attachments' and public.is_admin())
  with check (bucket_id = 'attachments' and public.is_admin());
