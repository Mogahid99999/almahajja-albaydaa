-- =============================================================================
-- 0012_notify_weekly_goal_type.sql
-- المَحجّة البَيْضَاء — PLAN_V3 Phase 6: weekly-goal notification type
--
-- Adds the `weekly_goal` notification type so (a) its per-type pref can be stored
-- in public.notification_prefs and (b) the cron-pushed midweek / 2-days nudges
-- and the local completion-congrats can be stored as notifications rows of this
-- type. Standalone enum migration (a new enum value can't be used in the same
-- transaction it's added) — the rest of Phase 6 lives in 0013.
--
-- Append-only, idempotent (ADD VALUE IF NOT EXISTS). Never edit 0001–0011.
-- =============================================================================

alter type public.notification_type add value if not exists 'weekly_goal';
