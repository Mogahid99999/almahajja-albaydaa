-- =============================================================================
-- 0019_buddy_request_enum.sql
-- المَحجّة البَيْضَاء — V4 fix (Issue 4): notify a student when they are invited
-- to be a study buddy.
--
-- A buddy invitation currently writes only a `buddy_requests` row (0015) — no
-- `public.notifications` row — so the push pipeline (0009 webhook →
-- notify-on-publish → Expo Push) never fires and the invitee is never told.
-- 0020 fixes that by INSERTing a notification of a NEW type, 'buddy_request'.
--
-- A new enum value cannot be REFERENCED in the same transaction that adds it
-- (Postgres restriction — same split used for 'buddy_activity' in 0015/0016),
-- so the value is added HERE and first used in 0020.
--
-- Append-only migration — 0001–0018 are never edited. Idempotent.
-- =============================================================================

alter type public.notification_type add value if not exists 'buddy_request';
