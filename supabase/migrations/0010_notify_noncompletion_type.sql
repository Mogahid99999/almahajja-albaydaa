-- =============================================================================
-- 0010_notify_noncompletion_type.sql
-- المَحجّة البَيْضَاء — PLAN_V3 Phase 2: non-completion gentle reminder type
--
-- Adds the LOCAL-only `noncompletion_gentle` notification type so its per-type
-- pref can be stored in public.notification_prefs (whose `type` column is this
-- enum). It is scheduled / presented on-device (src/lib/notifications.ts) as the
-- soft no-shame fallback at the tail of the resume ladder — NEVER inserted as an
-- inbox row or fanned out, so the fan-out triggers/functions are untouched. A
-- missing prefs row still means the type's default (ON), resolved client-side.
--
-- Append-only, idempotent (ADD VALUE IF NOT EXISTS). Never edit 0001–0009.
-- =============================================================================

alter type public.notification_type add value if not exists 'noncompletion_gentle';
