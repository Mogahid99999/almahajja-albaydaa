-- =============================================================================
-- 0054_sheikh_bio.sql
-- المَحجّة البَيْضَاء — Item 8: التعريف بالشيخ (sheikh bio + photo).
--
-- Adds two nullable columns to the existing `sheikhs` metadata table (0001).
--
-- RLS check (no changes needed, verified against 0001 + 0023):
--   * sheikhs_select  — `for select to authenticated using (true)` — row-level,
--     column-agnostic, already exposes bio/photo_path to every signed-in reader
--     (students included).
--   * sheikhs_admin_write — `for all to authenticated using
--     (is_content_manager()) with check (is_content_manager())` — already
--     covers writes to the new columns for admins/publishers.
--
-- photo_path stores a path inside the existing private `attachments` storage
-- bucket (0002) — no new bucket, no new storage policy. Reads resolve to a
-- signed URL exactly like attachments.storage_path.
--
-- Append-only — 0001-0053 are never edited. Idempotent.
-- =============================================================================

alter table public.sheikhs
  add column if not exists bio text null;

alter table public.sheikhs
  add column if not exists photo_path text null;
