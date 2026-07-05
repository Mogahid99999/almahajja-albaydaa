-- =============================================================================
-- 0048_lecture_notes_block_anonymous.sql
-- المَحجّة البَيْضَاء — Polish: guest accounts can no longer create/edit
-- lecture notes at the database level.
--
-- lecture_notes (0029) was the one private-write feature with no is_anonymous
-- guard — unlike buddy requests (0041), quiz attempts (0017), and questions
-- (0028), which all block guest writes server-side. The app UI already hides
-- the note editor from guests (`isGuest` check in the lecture-note screen),
-- but that is a client-side nicety only — nothing at the RLS layer stopped an
-- anonymous session from writing a note directly. A guest note has nowhere to
-- go if the guest never registers, so it effectively disappears; requiring a
-- real account matches the app-wide pattern and closes that gap.
--
-- Existing guest-authored notes (if any) are left in place — still readable
-- and deletable by their author — only new inserts/edits are blocked.
--
-- Append-only migration — 0001–0047 are never edited. Idempotent.
-- =============================================================================

drop policy if exists lecture_notes_own on public.lecture_notes;
drop policy if exists lecture_notes_read on public.lecture_notes;
drop policy if exists lecture_notes_delete on public.lecture_notes;
drop policy if exists lecture_notes_write on public.lecture_notes;
drop policy if exists lecture_notes_update on public.lecture_notes;

create policy lecture_notes_read on public.lecture_notes
  for select to authenticated
  using (user_id = auth.uid());

create policy lecture_notes_delete on public.lecture_notes
  for delete to authenticated
  using (user_id = auth.uid());

create policy lecture_notes_write on public.lecture_notes
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

create policy lecture_notes_update on public.lecture_notes
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );
