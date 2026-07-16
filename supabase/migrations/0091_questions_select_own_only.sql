-- =============================================================================
-- 0091_questions_select_own_only.sql
-- المَحجّة البَيْضَاء — Audit Phase 7 (F-056): close the Q&A anonymity bypass at
-- the RLS layer.
--
-- 0028 gave moderators (sheikh + admin) a RAW SELECT on public.questions via
--   questions_select_own_or_moderator  →  using (asker_id = auth.uid() OR is_moderator())
-- Every LEGITIMATE moderator read, however, goes through the SECURITY DEFINER
-- RPC get_question_inbox (0077/0084), which deliberately:
--   * returns asker_display = 'سائل' for anonymous questions — even to admins;
--   * ships asker_id ONLY to admins (never to sheikhs), for «حظر الكاتب».
-- The raw-table branch bypasses all of that: a sheikh (or admin) can
--   select id, asker_id, is_anonymous, body from public.questions
-- and read the asker_id + is_anonymous of ANONYMOUS questions directly. Because
-- asker_id is a stable per-user UUID, a sheikh can then correlate an anonymous
-- question with any NON-anonymous question by the same asker (whose name the
-- inbox/public list reveals) and deanonymise the asker — exactly the guarantee
-- 0077 was written to provide. Confirmed live against staging (Phase 7 memo):
-- a sheikh's `from('questions').select('asker_id, is_anonymous')` returned the
-- real asker_id of an anonymous question whose inbox row correctly showed
-- 'سائل' / null.
--
-- Fix: drop the moderator branch — SELECT is restricted to OWN rows only. All
-- moderator access already flows through DEFINER RPCs (get_question_inbox,
-- answer_question, delete_question, set_question_hidden), which bypass RLS, so
-- nothing legitimate depends on the raw moderator SELECT. No client code calls
-- `from('questions')` directly (verified repo-wide). Own-row SELECT is kept
-- (harmless; the app reads own questions via the DEFINER get_my_questions, but
-- own-row visibility is the least-surprising floor).
--
-- Append-only — 0001–0090 are never edited. Idempotent.
-- =============================================================================

drop policy if exists questions_select_own_or_moderator on public.questions;
drop policy if exists questions_select_own on public.questions;

create policy questions_select_own on public.questions
  for select to authenticated
  using (asker_id = auth.uid());
