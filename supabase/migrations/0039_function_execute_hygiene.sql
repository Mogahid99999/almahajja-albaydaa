-- =============================================================================
-- 0039_function_execute_hygiene.sql
-- المَحجّة البَيْضَاء — Security S1: function EXECUTE hygiene.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default. 0001–0038
-- added explicit `grant ... to authenticated` for client-facing RPCs but never
-- revoked the default PUBLIC/anon grant underneath — so the `anon` role (no
-- session at all) could still call any of them over PostgREST. Every function
-- is internally guarded (is_admin()/is_content_manager()/is_moderator(), quiz
-- ownership, anonymous blocks) so no data actually leaked, but a no-session
-- caller should get a permission error, not a chance to reach the guard logic.
--
-- This migration:
--   (1) Revokes EXECUTE from PUBLIC and anon on every function in `public`.
--   (2) Re-grants EXECUTE to `authenticated` for exactly the functions that
--       need it — the union of every `grant ... to authenticated` written in
--       0001–0038 and every `supabase.rpc(...)` call in src/api/*. That union
--       turned out to be the same set (every client RPC already had a grant),
--       so this list is just every prior authenticated grant, carried forward.
--   (3) Sets the default for FUTURE functions to no-PUBLIC/no-anon, so this
--       gap can't reopen by omission.
--
-- Deliberately EXCLUDED from the authenticated re-grant (unchanged from their
-- original migrations — trigger functions run under the triggering statement
-- regardless of grants, and cron jobs run as the job owner, not `authenticated`):
--   set_updated_at, handle_new_user, notify_lecture_published,
--   notify_attachment_added, notify_quiz_published, notify_push_on_notification,
--   notify_buddy_on_completion, fanout_to_followers, fanout_to_all,
--   dispatch_weekly_goal_nudges, dispatch_resume_nudges, dispatch_streak_reminders.
--
-- is_admin() / is_content_manager() / is_moderator() / is_sheikh() ARE
-- re-granted below — they're referenced inside RLS policies evaluated for
-- `authenticated` sessions, same as before.
--
-- Append-only — 0001–0038 are never edited. Idempotent (revoke/grant of an
-- already-revoked/granted privilege is a no-op).
-- =============================================================================

-- (1) Blanket sweep: no function is callable without an authenticated session
-- unless explicitly re-granted below.
revoke execute on all functions in schema public from public, anon;

-- (2) Re-grant to `authenticated` — every function the app (or RLS) needs.
grant execute on function public.add_featured_lecture(uuid) to authenticated;
grant execute on function public.add_lecture_benefit(uuid, text) to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_list_benefits(uuid) to authenticated;
grant execute on function public.admin_progress_analytics() to authenticated;
grant execute on function public.admin_set_benefit_status(uuid, text) to authenticated;
grant execute on function public.admin_user_detail(uuid) to authenticated;
grant execute on function public.admin_user_list(text, int, int) to authenticated;
grant execute on function public.answer_question(uuid, text) to authenticated;
grant execute on function public.ask_question(text, uuid, boolean, text, text) to authenticated;
grant execute on function public.buddy_of(uuid) to authenticated;
grant execute on function public.cancel_buddy() to authenticated;
grant execute on function public.create_broadcast(text, text, boolean) to authenticated;
grant execute on function public.delete_broadcast(uuid) to authenticated;
grant execute on function public.delete_own_benefit(uuid) to authenticated;
grant execute on function public.delete_own_question(uuid) to authenticated;
grant execute on function public.delete_question(uuid) to authenticated;
grant execute on function public.followers_of_section(uuid) to authenticated;
grant execute on function public.get_attempt_detail(uuid) to authenticated;
grant execute on function public.get_attempt_questions(uuid) to authenticated;
grant execute on function public.get_attempt_result(uuid) to authenticated;
grant execute on function public.get_broadcast(uuid) to authenticated;
grant execute on function public.get_buddy_status() to authenticated;
grant execute on function public.get_children_rollups(uuid[]) to authenticated;
grant execute on function public.get_current_streak() to authenticated;
grant execute on function public.get_featured_lectures() to authenticated;
grant execute on function public.get_featured_lectures_admin() to authenticated;
grant execute on function public.get_home_broadcasts() to authenticated;
grant execute on function public.get_incoming_buddy_requests() to authenticated;
grant execute on function public.get_journey_summary() to authenticated;
grant execute on function public.get_lecture_benefits(uuid) to authenticated;
grant execute on function public.get_my_buddy_id() to authenticated;
grant execute on function public.get_my_questions(text, uuid) to authenticated;
grant execute on function public.get_my_quiz_stats() to authenticated;
grant execute on function public.get_public_questions(text, uuid) to authenticated;
grant execute on function public.get_question_inbox(text, text) to authenticated;
grant execute on function public.get_quiz_intro(uuid) to authenticated;
grant execute on function public.get_quiz_results_summary(uuid) to authenticated;
grant execute on function public.get_section_quizzes(uuid) to authenticated;
grant execute on function public.get_section_rollup(uuid) to authenticated;
grant execute on function public.get_sections_flat() to authenticated;
grant execute on function public.get_streak_status() to authenticated;
grant execute on function public.get_week_progress() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_content_manager() to authenticated;
grant execute on function public.is_moderator() to authenticated;
grant execute on function public.is_sheikh() to authenticated;
grant execute on function public.list_quiz_result_rows(uuid) to authenticated;
grant execute on function public.record_daily_listening(uuid, integer) to authenticated;
grant execute on function public.record_meaningful_activity(uuid, integer, boolean) to authenticated;
grant execute on function public.remove_featured_lecture(uuid) to authenticated;
grant execute on function public.reorder_featured_lectures(uuid[]) to authenticated;
grant execute on function public.respond_buddy_request(uuid, boolean) to authenticated;
grant execute on function public.save_quiz_answer(uuid, uuid, uuid) to authenticated;
grant execute on function public.search_buddy_candidates(text) to authenticated;
grant execute on function public.send_buddy_request(uuid) to authenticated;
grant execute on function public.set_app_config(text, text) to authenticated;
grant execute on function public.set_own_profile(text, text) to authenticated;
grant execute on function public.set_question_hidden(uuid, boolean) to authenticated;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;
grant execute on function public.streak_for_user(uuid) to authenticated;
grant execute on function public.submit_quiz_attempt(uuid) to authenticated;
grant execute on function public.touch_last_opened() to authenticated;
grant execute on function public.try_claim_goal_congrats() to authenticated;
grant execute on function public.update_broadcast(uuid, text, text, boolean) to authenticated;
grant execute on function public.week_progress_for_user(uuid) to authenticated;

-- (3) Future-proof: new functions default to no PUBLIC/anon EXECUTE.
alter default privileges in schema public revoke execute on functions from public, anon;
