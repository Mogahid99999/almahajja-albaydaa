-- =============================================================================
-- 0027_qna_enums.sql
-- المَحجّة البَيْضَاء — V6 (Q&A): new enum values only.
--
-- Adds the 'sheikh' role (a login that receives and answers student questions —
-- distinct from the `sheikhs` metadata table) and the two Q&A notification
-- types. Postgres forbids REFERENCING a freshly added enum label in the same
-- transaction that added it (the 0015/0019/0022 precedent), so the values live
-- HERE alone and are first used in 0028.
--
-- Append-only — 0001–0026 are never edited. Idempotent.
-- =============================================================================

alter type public.app_role add value if not exists 'sheikh';
alter type public.notification_type add value if not exists 'question_received';
alter type public.notification_type add value if not exists 'question_answered';
