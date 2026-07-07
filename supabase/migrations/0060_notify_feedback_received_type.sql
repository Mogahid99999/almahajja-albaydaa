-- =============================================================================
-- 0060_notify_feedback_received_type.sql
-- المَحجّة البَيْضَاء — طلاب feedback (bug/improvement/other reports to admin).
--
-- Adds the 'feedback_received' notification type so submit_feedback (0061)
-- can insert public.notifications rows of this type for every admin.
-- Postgres forbids referencing a freshly added enum label in the same
-- transaction that added it (the 0012/0019/0027/0033/0050 precedent), so the
-- value lives HERE alone, standalone, and is first used in 0061.
--
-- Append-only — 0001–0059 are never edited. Idempotent.
-- =============================================================================

alter type public.notification_type add value if not exists 'feedback_received';
