-- =============================================================================
-- 0057_qna_notice.sql
-- المَحجّة البَيْضَاء — V12 Item 7: ملاحظة "سيُجاب عن الأسئلة قريبًا" في صفحتي
-- الأسئلة العامة وأسئلة الدرس.
--
-- A single new key in the existing world-readable app_config table (0021/0023),
-- same "editable without a redeploy" convention as about_intro/telegram_intro
-- etc. Admins edit it from لوحة الإدارة ← الإعدادات via the existing
-- admin-only set_app_config RPC — no new table, no new RPC.
--
-- Append-only — 0001–0056 are never edited. Idempotent.
-- =============================================================================

insert into public.app_config (key, value) values
  ('qna_notice_text', 'سيتم الإجابة عن جميع الأسئلة بإذن الله من قِبل الشيخ خلال فترة قصيرة')
on conflict (key) do nothing;
