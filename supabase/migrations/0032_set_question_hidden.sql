-- =============================================================================
-- 0032_set_question_hidden.sql
-- المَحجّة البَيْضَاء — V7: moderator hide / unhide for أسئلة وأجوبة.
--
-- Feature A shipped delete_question (hard delete) and answer_question, but no
-- way to quietly REMOVE a question from view without destroying it. This adds a
-- reversible moderation toggle used by the new admin Q&A screen
-- (app/admin/questions.tsx):
--   * hide  → status 'hidden' (drops out of get_public_questions, which only
--             surfaces status='answered' public questions).
--   * unhide → restore sensibly: 'answered' when an answer exists, else 'pending'
--             (we can't store the pre-hide status, so it is inferred from
--             answer_body — the same signal answer_question uses).
--
-- Same is_moderator() gate as answer_question / delete_question (sheikh + admin).
-- Append-only — 0001–0031 are never edited. Idempotent.
-- =============================================================================

create or replace function public.set_question_hidden(
  p_question_id uuid,
  p_hidden      boolean
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  q public.questions%rowtype;
begin
  if not public.is_moderator() then
    raise exception 'غير مصرح';
  end if;

  select * into q from public.questions where id = p_question_id for update;
  if not found then
    raise exception 'السؤال غير موجود';
  end if;

  if p_hidden then
    update public.questions set status = 'hidden' where id = q.id;
  else
    update public.questions
       set status = case
                      when q.answer_body is not null and length(btrim(q.answer_body)) > 0
                        then 'answered'
                      else 'pending'
                    end
     where id = q.id;
  end if;
end;
$$;
grant execute on function public.set_question_hidden(uuid, boolean) to authenticated;
