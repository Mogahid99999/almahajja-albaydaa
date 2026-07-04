-- =============================================================================
-- 0043_perf_fk_indexes.sql
-- المَحجّة البَيْضَاء — PLAN_PERFORMANCE Phase P6: index every foreign key the
-- Supabase performance advisor flagged as uncovered (unindexed_foreign_keys).
--
-- An FK column with no index means every join through it (and every cascading
-- update/delete on the referenced row) does a sequential scan. Low-risk,
-- additive-only change — no query semantics change, just faster plans.
--
-- Append-only migration — 0001–0042 are never edited. Idempotent (IF NOT EXISTS).
-- =============================================================================
create index if not exists idx_broadcasts_created_by
  on public.broadcasts (created_by);

create index if not exists idx_featured_lectures_added_by
  on public.featured_lectures (added_by);

create index if not exists idx_lecture_notes_lecture_id
  on public.lecture_notes (lecture_id);

create index if not exists idx_lectures_sheikh_id
  on public.lectures (sheikh_id);

create index if not exists idx_questions_answered_by
  on public.questions (answered_by);

create index if not exists idx_quiz_attempt_answers_option_id
  on public.quiz_attempt_answers (option_id);

create index if not exists idx_quiz_attempt_answers_question_id
  on public.quiz_attempt_answers (question_id);

create index if not exists idx_sheikhs_user_id
  on public.sheikhs (user_id);

create index if not exists idx_user_lecture_progress_lecture_id
  on public.user_lecture_progress (lecture_id);
