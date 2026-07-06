-- =============================================================================
-- 0055_release_tracking.sql
-- المَحجّة البَيْضَاء — Item 9: تحديث إجباري تلقائي بعد مرور 30 يومًا من الإصدار.
--
-- Two new keys in the existing world-readable app_config table (0021/0037):
-- `latest_app_version` — the version string of the most recently shipped
-- build, and `latest_released_at` — its ISO-8601 release timestamp. This is
-- INDEPENDENT of the existing manual `min_app_version` emergency switch: the
-- client force-updates when EITHER min_app_version demands it (unchanged), OR
-- the installed build is behind latest_app_version AND more than 30 days have
-- passed since latest_released_at (see UpdateGate.tsx). Both empty by default
-- — no automatic block until an admin fills them in from لوحة الإدارة ←
-- الإعدادات the moment a new build actually ships.
--
-- Append-only — 0001-0054 (and 0057, already landed by a concurrent
-- workstream) are never edited. Idempotent.
-- =============================================================================

insert into public.app_config (key, value) values
  ('latest_app_version', ''),
  ('latest_released_at', '')
on conflict (key) do nothing;
