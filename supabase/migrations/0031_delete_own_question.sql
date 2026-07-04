-- =============================================================================
-- 0031_delete_own_question.sql
-- المَحجّة البَيْضَاء — V6 follow-up: the ASKER may delete their own question.
--
-- User-requested addition to Feature A: a student can remove a question they
-- asked (any status — pending or answered; deleting an answered question also
-- removes it from the public list). Own-rows only, enforced server-side:
-- `asker_id = auth.uid()` inside the DEFINER function, so nobody can delete
-- someone else's question through this path (moderators keep delete_question).
--
-- Append-only — 0001–0030 are never edited. Idempotent.
-- =============================================================================

create or replace function public.delete_own_question(p_question_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.questions
   where id = p_question_id and asker_id = auth.uid();
end;
$$;
grant execute on function public.delete_own_question(uuid) to authenticated;
