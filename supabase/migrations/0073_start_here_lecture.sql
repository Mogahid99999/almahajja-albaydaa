-- =============================================================================
-- 0073_start_here_lecture.sql
-- المَحجّة البَيْضَاء — «ابدأ من هنا»: توصية الطالب الجديد بمحاضرة البداية.
--
-- A single new key in the existing world-readable app_config table (0021/0023).
-- After a newly registered student finishes (or skips) the first-time tour, the
-- app shows a small popup (StartHereCard) recommending the lecture this key
-- points at — «كيف تبدأ الدراسة ؟». Empty value = the popup never shows (same
-- "empty = hidden" convention as telegram_url / support_whatsapp_url). Admins
-- set it from لوحة الإدارة ← الإعدادات via the existing admin-only
-- set_app_config RPC — no new table, no new RPC, no RLS changes.
--
-- The live project's value is set to the actual lecture id out-of-band (the id
-- is environment-specific, so it is not seeded here).
--
-- Append-only — 0001–0072 are never edited. Idempotent.
-- =============================================================================

insert into public.app_config (key, value) values
  ('start_here_lecture_id', '')
on conflict (key) do nothing;
