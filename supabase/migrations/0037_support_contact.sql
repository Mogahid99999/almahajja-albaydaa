-- =============================================================================
-- 0037_support_contact.sql
-- المَحجّة البَيْضَاء — V8 Feature A: رابط الدعم الفني عبر واتساب على شاشة الدخول.
--
-- A single new key in the existing world-readable app_config table (0021/0023).
-- The sign-in screen renders a small "هل لديك مشكلة؟ تواصل مع الدعم الفني للمنصة"
-- line with a WhatsApp glyph ONLY when this key is non-empty (same "empty =
-- hidden" convention as telegram_url). Admins set it from
-- لوحة الإدارة ← الإعدادات via the existing admin-only set_app_config RPC — no
-- new table, no new RPC.
--
-- Append-only — 0001–0036 are never edited. Idempotent.
-- =============================================================================

insert into public.app_config (key, value) values
  ('support_whatsapp_url', '')
on conflict (key) do nothing;
