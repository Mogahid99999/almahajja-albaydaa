-- =============================================================================
-- 0152_rls_initplan_and_fk_indexes.sql
-- المَحجّة البَيْضَاء — PERF (owner 2026-10-03: «اريد احسن performance»).
-- Generated from the LIVE prod policies of 2026-10-03 (scratchpad gen-0152.mjs);
-- no semantic change anywhere — only how often the checks are evaluated.
--
-- 1. auth_rls_initplan (Supabase advisor: 38 WARN): every policy's auth.uid()
--    and zero-arg is_*() helper becomes `(select …)` — evaluated ONCE per
--    statement instead of once per row (0149 did profiles; this is the rest).
-- 2. multiple_permissive_policies (6 WARN): on attachments, lectures, profiles, quizzes, sections, sheikhs
--    the staff «… _admin_write» FOR ALL policy was OR-ed into every SELECT.
--    It is split into INSERT / UPDATE / DELETE policies with the same
--    expressions, and the SELECT policy becomes (old select OR old admin) —
--    exactly the rows each role could read before (e.g. publishers still see
--    draft-lecture attachments through is_content_manager()).
-- 3. unindexed_foreign_keys (14 INFO): a covering index per FK (deleting an
--    account or a parent row no longer scans these tables).
--
-- Append-only. Idempotent (drop … if exists / create … if not exists); statements
-- on a table that does not exist yet (staging drift) are skipped.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1+2. Policies ----------------------------------------------------------------------

-- attachments
alter policy "attachments_select" on public.attachments using ((((select public.is_admin()) OR (section_id IS NOT NULL) OR (EXISTS ( SELECT 1
   FROM lectures l
  WHERE ((l.id = attachments.lecture_id) AND (l.status = 'published'::lecture_status)))))) or ((select public.is_content_manager())));
drop policy if exists "attachments_admin_write" on public.attachments;
drop policy if exists "attachments_admin_insert" on public.attachments;
drop policy if exists "attachments_admin_update" on public.attachments;
drop policy if exists "attachments_admin_delete" on public.attachments;
create policy "attachments_admin_insert" on public.attachments for insert to authenticated with check ((select public.is_content_manager()));
create policy "attachments_admin_update" on public.attachments for update to authenticated using ((select public.is_content_manager())) with check ((select public.is_content_manager()));
create policy "attachments_admin_delete" on public.attachments for delete to authenticated using ((select public.is_content_manager()));

-- lectures
alter policy "lectures_select" on public.lectures using ((((status = 'published'::lecture_status) OR (select public.is_content_manager()))) or ((select public.is_content_manager())));
drop policy if exists "lectures_admin_write" on public.lectures;
drop policy if exists "lectures_admin_insert" on public.lectures;
drop policy if exists "lectures_admin_update" on public.lectures;
drop policy if exists "lectures_admin_delete" on public.lectures;
create policy "lectures_admin_insert" on public.lectures for insert to authenticated with check ((select public.is_content_manager()));
create policy "lectures_admin_update" on public.lectures for update to authenticated using ((select public.is_content_manager())) with check ((select public.is_content_manager()));
create policy "lectures_admin_delete" on public.lectures for delete to authenticated using ((select public.is_content_manager()));

-- profiles
alter policy "profiles_select" on public.profiles using ((((id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_admin() AS is_admin))) or (( SELECT is_admin() AS is_admin)));
drop policy if exists "profiles_admin_write" on public.profiles;
drop policy if exists "profiles_admin_insert" on public.profiles;
drop policy if exists "profiles_admin_update" on public.profiles;
drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_insert" on public.profiles for insert to authenticated with check (( SELECT is_admin() AS is_admin));
create policy "profiles_admin_update" on public.profiles for update to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));
create policy "profiles_admin_delete" on public.profiles for delete to authenticated using (( SELECT is_admin() AS is_admin));

-- quizzes
alter policy "quizzes_select" on public.quizzes using ((((status = 'published'::text) OR (select public.is_quiz_manager()))) or ((select public.is_quiz_manager())));
drop policy if exists "quizzes_admin_write" on public.quizzes;
drop policy if exists "quizzes_admin_insert" on public.quizzes;
drop policy if exists "quizzes_admin_update" on public.quizzes;
drop policy if exists "quizzes_admin_delete" on public.quizzes;
create policy "quizzes_admin_insert" on public.quizzes for insert to authenticated with check ((select public.is_quiz_manager()));
create policy "quizzes_admin_update" on public.quizzes for update to authenticated using ((select public.is_quiz_manager())) with check ((select public.is_quiz_manager()));
create policy "quizzes_admin_delete" on public.quizzes for delete to authenticated using ((select public.is_quiz_manager()));

-- sections
alter policy "sections_select" on public.sections using (true);
drop policy if exists "sections_admin_write" on public.sections;
drop policy if exists "sections_admin_insert" on public.sections;
drop policy if exists "sections_admin_update" on public.sections;
drop policy if exists "sections_admin_delete" on public.sections;
create policy "sections_admin_insert" on public.sections for insert to authenticated with check ((select public.is_content_manager()));
create policy "sections_admin_update" on public.sections for update to authenticated using ((select public.is_content_manager())) with check ((select public.is_content_manager()));
create policy "sections_admin_delete" on public.sections for delete to authenticated using ((select public.is_content_manager()));

-- sheikhs
alter policy "sheikhs_select" on public.sheikhs using (true);
drop policy if exists "sheikhs_admin_write" on public.sheikhs;
drop policy if exists "sheikhs_admin_insert" on public.sheikhs;
drop policy if exists "sheikhs_admin_update" on public.sheikhs;
drop policy if exists "sheikhs_admin_delete" on public.sheikhs;
create policy "sheikhs_admin_insert" on public.sheikhs for insert to authenticated with check ((select public.is_content_manager()));
create policy "sheikhs_admin_update" on public.sheikhs for update to authenticated using ((select public.is_content_manager())) with check ((select public.is_content_manager()));
create policy "sheikhs_admin_delete" on public.sheikhs for delete to authenticated using ((select public.is_content_manager()));

-- 1. The other policies: initPlan form only ------------------------------------------
do $g$ begin if to_regclass('public.app_ratings') is not null then execute $s$ alter policy "app_ratings_select_own_or_admin" on public.app_ratings using (((user_id = (select auth.uid())) OR (select public.is_admin()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.backup_log') is not null then execute $s$ alter policy "backup_log_admin_read" on public.backup_log using ((select public.is_admin())) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.broadcast_views') is not null then execute $s$ alter policy "broadcast_views_insert_own" on public.broadcast_views with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.broadcast_views') is not null then execute $s$ alter policy "broadcast_views_select_own" on public.broadcast_views using ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.buddy_encouragements') is not null then execute $s$ alter policy "buddy_encouragements_own" on public.buddy_encouragements using ((from_user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.buddy_goals') is not null then execute $s$ alter policy "buddy_goals_member_read" on public.buddy_goals using (((a_user_id = (select auth.uid())) OR (b_user_id = (select auth.uid())))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.buddy_requests') is not null then execute $s$ alter policy "buddy_requests_insert" on public.buddy_requests with check ((from_user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.buddy_requests') is not null then execute $s$ alter policy "buddy_requests_select" on public.buddy_requests using (((from_user_id = (select auth.uid())) OR (to_user_id = (select auth.uid())))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.buddy_requests') is not null then execute $s$ alter policy "buddy_requests_update" on public.buddy_requests using (((to_user_id = (select auth.uid())) OR ((from_user_id = (select auth.uid())) AND (status = 'pending'::text)))) with check (((from_user_id = (select auth.uid())) OR (to_user_id = (select auth.uid())))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.celebrated') is not null then execute $s$ alter policy "celebrated_own" on public.celebrated using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.content_reports') is not null then execute $s$ alter policy "content_reports_insert_own" on public.content_reports with check (((reporter_id = (select auth.uid())) OR (reporter_id IS NULL))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.content_reports') is not null then execute $s$ alter policy "content_reports_select_own_or_admin" on public.content_reports using (((reporter_id = (select auth.uid())) OR (select public.is_admin()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.daily_listening') is not null then execute $s$ alter policy "daily_listening_own" on public.daily_listening using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.feedback') is not null then execute $s$ alter policy "feedback_insert_own" on public.feedback with check (((user_id = (select auth.uid())) OR (user_id IS NULL))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.feedback') is not null then execute $s$ alter policy "feedback_select_own_or_admin" on public.feedback using (((user_id = (select auth.uid())) OR (select public.is_admin()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.feedback_messages') is not null then execute $s$ alter policy "feedback_messages_select" on public.feedback_messages using (((select public.is_admin()) OR (EXISTS ( SELECT 1
   FROM feedback f
  WHERE ((f.id = feedback_messages.feedback_id) AND (f.user_id = (select auth.uid()))))))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_benefits') is not null then execute $s$ alter policy "lecture_benefits_delete_own_or_admin" on public.lecture_benefits using (((user_id = (select auth.uid())) OR (select public.is_staff_viewer()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_benefits') is not null then execute $s$ alter policy "lecture_benefits_insert_own" on public.lecture_benefits with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_benefits') is not null then execute $s$ alter policy "lecture_benefits_select_own_or_admin" on public.lecture_benefits using (((user_id = (select auth.uid())) OR (select public.is_staff_viewer()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_bookmarks') is not null then execute $s$ alter policy "lecture_bookmarks_own" on public.lecture_bookmarks using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_notes') is not null then execute $s$ alter policy "lecture_notes_delete" on public.lecture_notes using ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_notes') is not null then execute $s$ alter policy "lecture_notes_read" on public.lecture_notes using ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_notes') is not null then execute $s$ alter policy "lecture_notes_update" on public.lecture_notes using ((user_id = (select auth.uid()))) with check (((user_id = (select auth.uid())) AND (NOT ( SELECT is_guest() AS is_guest)))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_notes') is not null then execute $s$ alter policy "lecture_notes_write" on public.lecture_notes with check (((user_id = (select auth.uid())) AND (NOT ( SELECT is_guest() AS is_guest)))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.live_buddy_invites') is not null then execute $s$ alter policy "live_buddy_invites_select_own" on public.live_buddy_invites using ((from_user = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.live_reminders') is not null then execute $s$ alter policy "live_reminders_select_own" on public.live_reminders using ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.live_sessions') is not null then execute $s$ alter policy "live_sessions_select_staff" on public.live_sessions using (((select public.is_content_manager()) OR (select public.is_sheikh()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.media_jobs') is not null then execute $s$ alter policy "media_jobs_select_content_manager" on public.media_jobs using ((select public.is_content_manager())) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.notification_prefs') is not null then execute $s$ alter policy "notification_prefs_own" on public.notification_prefs using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.notifications') is not null then execute $s$ alter policy "notifications_own" on public.notifications using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.push_tokens') is not null then execute $s$ alter policy "push_tokens_own" on public.push_tokens using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.questions') is not null then execute $s$ alter policy "questions_insert_own" on public.questions with check ((asker_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.questions') is not null then execute $s$ alter policy "questions_select_own" on public.questions using ((asker_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.quiz_attempt_answers') is not null then execute $s$ alter policy "quiz_attempt_answers_select" on public.quiz_attempt_answers using ((EXISTS ( SELECT 1
   FROM quiz_attempts a
  WHERE ((a.id = quiz_attempt_answers.attempt_id) AND ((a.user_id = (select auth.uid())) OR (select public.is_staff_viewer())))))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.quiz_attempts') is not null then execute $s$ alter policy "quiz_attempts_select" on public.quiz_attempts using (((user_id = (select auth.uid())) OR (select public.is_staff_viewer()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.quiz_options') is not null then execute $s$ alter policy "quiz_options_admin_all" on public.quiz_options using ((select public.is_staff_viewer())) with check ((select public.is_staff_viewer())) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.quiz_questions') is not null then execute $s$ alter policy "quiz_questions_admin_all" on public.quiz_questions using ((select public.is_staff_viewer())) with check ((select public.is_staff_viewer())) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.restore_sessions') is not null then execute $s$ alter policy "restore_sessions_admin_read" on public.restore_sessions using ((select public.is_admin())) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.section_follows') is not null then execute $s$ alter policy "section_follows_own" on public.section_follows using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.streak_recovery_state') is not null then execute $s$ alter policy "streak_recovery_state_own" on public.streak_recovery_state using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.user_badges') is not null then execute $s$ alter policy "user_badges_own" on public.user_badges using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.user_lecture_progress') is not null then execute $s$ alter policy "progress_own" on public.user_lecture_progress using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.weekly_goal_state') is not null then execute $s$ alter policy "weekly_goal_state_own" on public.weekly_goal_state using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.weekly_goals') is not null then execute $s$ alter policy "weekly_goals_own" on public.weekly_goals using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid()))) $s$; end if; end $g$;

-- 3. Covering indexes for the foreign keys ------------------------------------------
do $g$ begin if to_regclass('public.backup_log') is not null then execute $s$ create index if not exists backup_log_actor_id_idx on public.backup_log (actor_id) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.broadcast_views') is not null then execute $s$ create index if not exists broadcast_views_user_id_idx on public.broadcast_views (user_id) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.buddy_encouragements') is not null then execute $s$ create index if not exists buddy_encouragements_to_user_id_idx on public.buddy_encouragements (to_user_id) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.buddy_goals') is not null then execute $s$ create index if not exists buddy_goals_created_by_idx on public.buddy_goals (created_by) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.feedback') is not null then execute $s$ create index if not exists feedback_resolved_by_idx on public.feedback (resolved_by) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.feedback_messages') is not null then execute $s$ create index if not exists feedback_messages_author_id_idx on public.feedback_messages (author_id) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.lecture_bookmarks') is not null then execute $s$ create index if not exists lecture_bookmarks_lecture_id_idx on public.lecture_bookmarks (lecture_id) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.live_buddy_invites') is not null then execute $s$ create index if not exists live_buddy_invites_from_user_idx on public.live_buddy_invites (from_user) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.live_comment_blocks') is not null then execute $s$ create index if not exists live_comment_blocks_blocked_by_idx on public.live_comment_blocks (blocked_by) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.live_comments') is not null then execute $s$ create index if not exists live_comments_deleted_by_idx on public.live_comments (deleted_by) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.live_moderation_log') is not null then execute $s$ create index if not exists live_moderation_log_actor_user_id_idx on public.live_moderation_log (actor_user_id) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.live_sessions') is not null then execute $s$ create index if not exists live_sessions_host_user_id_idx on public.live_sessions (host_user_id) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.media_jobs') is not null then execute $s$ create index if not exists media_jobs_created_by_idx on public.media_jobs (created_by) $s$; end if; end $g$;
do $g$ begin if to_regclass('public.question_answers') is not null then execute $s$ create index if not exists question_answers_answered_by_idx on public.question_answers (answered_by) $s$; end if; end $g$;
