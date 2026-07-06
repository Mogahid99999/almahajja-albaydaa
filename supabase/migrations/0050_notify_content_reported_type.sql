-- =============================================================================
-- 0050_notify_content_reported_type.sql
-- المَحجّة البَيْضَاء — Items 4/6: shared content-reports system, enum value only.
--
-- Adds the 'content_reported' notification type so the report_content fan-out
-- (0051) can insert public.notifications rows of this type for every admin.
-- Postgres forbids referencing a freshly added enum label in the same
-- transaction that added it (the 0012/0019/0027/0033 precedent), so the value
-- lives HERE alone, standalone, and is first used in 0051.
--
-- Append-only — 0001–0049 are never edited. Idempotent.
-- =============================================================================

alter type public.notification_type add value if not exists 'content_reported';
