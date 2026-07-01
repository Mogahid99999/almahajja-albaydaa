-- =============================================================================
-- 0008_notify_phase_a_types.sql
-- منصة دروس العلم الشرعي / المَحجّة البَيْضَاء — Notifications Phase A
--
-- Adds three LOCAL-only notification types so their per-type prefs can be stored
-- in public.notification_prefs (whose `type` column is this enum):
--   * resume_series      — "تابع سلسلتك العلمية" (continue a started series)
--   * completion_praise  — "أكملت الدرس، نفعك الله بما سمعت" (≥90% encouragement)
--   * daily_reminder     — opt-in once-a-day remembrance (default OFF in-app)
--
-- These are scheduled / presented on-device (src/lib/notifications.ts) and are
-- NEVER inserted as inbox rows or fanned out by fanout_to_all (0007), so the
-- triggers/functions are untouched. A missing prefs row still means the type's
-- default (ON for all but daily_reminder), resolved in the client api layer.
--
-- Append-only, idempotent (ADD VALUE IF NOT EXISTS). Never edit 0001–0007.
-- =============================================================================

alter type public.notification_type add value if not exists 'resume_series';
alter type public.notification_type add value if not exists 'completion_praise';
alter type public.notification_type add value if not exists 'daily_reminder';
