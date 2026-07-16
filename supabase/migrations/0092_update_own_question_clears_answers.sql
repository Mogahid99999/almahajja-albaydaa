-- =============================================================================
-- 0092_update_own_question_clears_answers.sql
-- المَحجّة البَيْضَاء — Audit Phase 7 (F-057): editing a question's body must
-- also clear the 0086 answer THREAD, not just the mirrored answer columns.
--
-- 0078's update_own_question resets a question to 'pending' and clears the
-- mirror (answer_body / answered_by / answered_at) when the body changes — its
-- comment states the invariant «a stale answer must never sit under new text».
-- But 0086 later moved answers into their own table (question_answers) and
-- mirrored only the latest one back onto questions. 0078 was never updated, so
-- a body edit clears the mirror yet leaves the question_answers rows intact.
-- get_question_answers (0086) reads that table, so once the edited question is
-- answered again the OLD answer reappears ABOVE the new one — the exact stale
-- pairing 0078 set out to prevent (and, for a sheikh-audience question, it can
-- resurface a private prior answer under unrelated new text). Confirmed live on
-- staging: edit body → re-answer → thread returned [old answer, new answer].
--
-- Fix: recreate update_own_question (0078 body verbatim) and, on a changed
-- body, also `delete from question_answers where question_id = p_id`. A same-
-- body audience/category flip still keeps the thread. delete_own_question /
-- delete_question are unaffected — question_answers cascades on question delete.
--
-- Append-only — 0001–0091 are never edited. Idempotent.
-- =============================================================================

create or replace function public.update_own_question(
  p_id       uuid,
  p_body     text,
  p_audience text,
  p_category text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  r      public.questions%rowtype;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول';
  end if;

  select * into r from public.questions q where q.id = p_id for update;
  if not found or r.asker_id <> v_me then
    raise exception 'غير مصرح';
  end if;

  if p_audience not in ('public', 'sheikh') then
    raise exception 'وجهة غير صالحة';
  end if;
  if p_category not in ('general', 'fatwa') then
    raise exception 'تصنيف غير صالح';
  end if;
  if length(v_body) < 3 or length(v_body) > 2000 then
    raise exception 'نص السؤال يجب أن يكون بين ٣ و ٢٠٠٠ حرف';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  if v_body <> r.body then
    -- New text invalidates the old answer(s): clear the mirror AND the 0086
    -- answer thread, so no stale answer sits under the new question text. A
    -- moderator-hidden question stays hidden (editing is not an unhide path).
    delete from public.question_answers where question_id = p_id;
    update public.questions
       set body        = v_body,
           audience    = p_audience,
           category    = p_category,
           status      = case when status = 'hidden' then 'hidden' else 'pending' end,
           answer_body = null,
           answer_audio_path = null,
           answered_by = null,
           answered_at = null
     where id = p_id;
  else
    update public.questions
       set audience = p_audience,
           category = p_category
     where id = p_id;
  end if;
end;
$$;
revoke execute on function public.update_own_question(uuid, text, text, text) from public, anon;
grant execute on function public.update_own_question(uuid, text, text, text) to authenticated;
