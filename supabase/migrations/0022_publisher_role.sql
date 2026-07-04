-- =============================================================================
-- 0022_publisher_role.sql
-- المَحجّة البَيْضَاء — V5 (Feature 5): add the limited "ناشر" (publisher) role.
--
-- A publisher is a content-only admin: they may create/edit sections, sheikhs,
-- lectures, quizzes and attachments (and classify incoming lectures), but may
-- NOT see or touch user data, analytics, or app settings.
--
-- This migration adds ONLY the new enum value. Postgres forbids using a freshly
-- added enum label in the SAME transaction that added it, so the policies that
-- reference 'publisher' live in a SEPARATE migration (0023). Apply this one
-- first, on its own.
--
-- Append-only — 0001–0021 are never edited. Idempotent.
-- =============================================================================

alter type public.app_role add value if not exists 'publisher';
