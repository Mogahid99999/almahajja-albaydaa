-- =============================================================================
-- 0040_storage_draft_scope.sql
-- المَحجّة البَيْضَاء — Security S2: storage reads scoped to published content.
--
-- `lectures_objects_read` (0001/0005) and `attachments_objects_read` (0002) let
-- ANY authenticated session (including anonymous/guest sessions, which hold the
-- `authenticated` role) read ANY object in those buckets, regardless of the
-- owning lecture's draft/published status. Object paths are random-looking
-- (`<timestamp>-<slug>.<ext>`, e.g. `1782893658191-record.mp3`) but not secret,
-- so this is a "guess the path" exposure for unpublished audio/attachments.
-- Verified live: `lectures.audio_path` / `attachments.storage_path` store the
-- exact `storage.objects.name` for that bucket — no folder prefix — so the
-- policies below can join straight from the object name to its owning row.
--
-- This migration:
--   (1) Replaces `lectures_objects_read` so a read is only allowed when
--       is_content_manager() (admin/publisher — same as before) OR a
--       PUBLISHED lecture references that exact object path.
--   (2) Replaces `attachments_objects_read` mirroring the existing
--       `attachments_select` table policy (0002): section-level attachments
--       stay visible to any signed-in user (no publish gate at that level —
--       matches the table policy), lecture-level attachments only when the
--       parent lecture is published, admins/publishers see everything.
--   (3) Caps bucket size + MIME types now that both buckets have real traffic:
--       - lectures: every web upload is transcoded to a small speech MP3
--         (`src/lib/audioTranscode.web.ts`); native admin uploads skip
--         transcoding and can post the extensions in `AUDIO_CONTENT_TYPE`
--         (`src/api/admin.ts`) — m4a/mp4/aac/ogg/wav/webm/flac. 200MB covers
--         an uncompressed native upload with room to spare.
--       - attachments: the admin picker only offers application/pdf (type
--         pdf), image/* (type image), or an open file picker for
--         book/transcript — capped at common document/image formats + a
--         generous 25MB.
--
-- Append-only — 0001–0039 are never edited. Idempotent (drop-if-exists +
-- create policy; bucket UPDATE is a plain column set).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- (1) lectures bucket — publish-gated read
-- ---------------------------------------------------------------------------
drop policy if exists lectures_objects_read on storage.objects;
create policy lectures_objects_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lectures'
    and (
      public.is_content_manager()
      or exists (
        select 1 from public.lectures l
        where l.audio_path = storage.objects.name
          and l.status = 'published'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- (2) attachments bucket — mirrors attachments_select (0002): section-level
--     attachments have no publish gate, lecture-level ones do.
-- ---------------------------------------------------------------------------
drop policy if exists attachments_objects_read on storage.objects;
create policy attachments_objects_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.is_content_manager()
      or exists (
        select 1 from public.attachments a
        where a.storage_path = storage.objects.name
          and (
            a.section_id is not null
            or exists (
              select 1 from public.lectures l
              where l.id = a.lecture_id and l.status = 'published'
            )
          )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- (3) Bucket hardening — size caps + MIME allow-lists
-- ---------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 209715200, -- 200MB
    allowed_mime_types = array[
      'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav',
      'audio/webm', 'audio/flac'
    ]
where id = 'lectures';

update storage.buckets
set file_size_limit = 26214400, -- 25MB
    allowed_mime_types = array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/epub+zip', 'text/plain'
    ]
where id = 'attachments';
