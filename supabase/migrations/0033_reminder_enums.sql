-- =============================================================================
-- 0033_reminder_enums.sql
-- المَحجّة البَيْضَاء — V7 (reminders): new enum values only.
--
-- Adds the two V7 notification types: 'streak_reminder' (the server-cron
-- المداومة keep-alive nudge, Fix 2) and 'beneficial_reminder' (the admin
-- التذكيرات النافعة broadcast). Postgres forbids REFERENCING a freshly added
-- enum label in the same transaction that added it (the 0022/0027 precedent),
-- so the values live HERE alone and are first used in 0034/0035.
--
-- Append-only — 0001–0032 are never edited. Idempotent.
-- =============================================================================

alter type public.notification_type add value if not exists 'streak_reminder';
alter type public.notification_type add value if not exists 'beneficial_reminder';
