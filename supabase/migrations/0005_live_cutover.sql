-- =============================================================================
-- 0005_live_cutover.sql
-- منصة دروس العلم الشرعي — live-mode cutover adjustments
--
-- Bridges the gap between the mock data model and what the live Supabase
-- schema needs for the first admin upload test:
--
--   1. lectures.section_id  → nullable (unclassified queue concept)
--   2. lectures.audio_path  → nullable (audio file upload UI not yet built)
--   3. sections.cover_letter + show_header → new columns
--   4. attachments.body     → inline transcript text column
--   5. Attachment payload constraint relaxed (UI uses URL field, not file upload)
--   6. Lectures storage bucket + policies
--   7. Table grants for Phase-2 tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. lectures: nullable section_id (unclassified = no section yet)
-- ---------------------------------------------------------------------------
alter table public.lectures
  alter column section_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. lectures: nullable audio_path (file upload UI not built yet)
-- ---------------------------------------------------------------------------
alter table public.lectures
  alter column audio_path drop not null;

-- ---------------------------------------------------------------------------
-- 3. sections: UI-only metadata columns
-- ---------------------------------------------------------------------------
alter table public.sections
  add column if not exists cover_letter text not null default '';

alter table public.sections
  add column if not exists show_header boolean not null default true;

-- ---------------------------------------------------------------------------
-- 4. attachments: inline body for transcript text
-- ---------------------------------------------------------------------------
alter table public.attachments
  add column if not exists body text;

-- ---------------------------------------------------------------------------
-- 5. Relax attachment payload constraint
--    Old: strict per-type rules requiring storage_path for pdf/image/transcript.
--    New: at least one of (storage_path, external_url, body) must be non-null.
--    This lets the current URL-only admin UI add all attachment types without
--    a file-upload picker.
-- ---------------------------------------------------------------------------
alter table public.attachments
  drop constraint if exists attachment_payload;

alter table public.attachments
  add constraint attachment_payload check (
    storage_path is not null
    or external_url is not null
    or body is not null
  );

-- ---------------------------------------------------------------------------
-- 6. Lectures storage bucket + policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('lectures', 'lectures', false)
  on conflict (id) do nothing;

drop policy if exists lectures_objects_read on storage.objects;
create policy lectures_objects_read on storage.objects
  for select to authenticated
  using (bucket_id = 'lectures');

drop policy if exists lectures_objects_admin_write on storage.objects;
create policy lectures_objects_admin_write on storage.objects
  for all to authenticated
  using  (bucket_id = 'lectures' and public.is_admin())
  with check (bucket_id = 'lectures' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. Table-level grants for Phase-2 tables
--    (RLS still gates row access; these are schema-level privileges)
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.attachments        to authenticated;
grant select, insert, update, delete on public.section_follows    to authenticated;
grant select, insert, update, delete on public.push_tokens        to authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;
grant select, insert, update, delete on public.notifications      to authenticated;
grant select, insert, update, delete on public.daily_listening    to authenticated;
grant select, insert, update, delete on public.weekly_goals       to authenticated;
grant select, insert, update, delete on public.user_badges        to authenticated;
