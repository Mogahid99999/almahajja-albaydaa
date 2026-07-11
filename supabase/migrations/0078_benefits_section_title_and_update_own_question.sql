-- =============================================================================
-- 0078_benefits_section_title_and_update_own_question.sql
-- المَحجّة البَيْضَاء — V14 items 2 (benefits side) + 3:
--
--   2) admin_list_benefits also returns `section_title` — the lesson's DIRECT
--      parent section (lectures.section_id → sections.title, no recursion), so
--      مشاركات الدارسين can render «القسم ← الدرس».
--   3) update_own_question — the asker edits their own question's body,
--      audience (public ↔ sheikh) and category. Editing is allowed even after
--      an answer, BUT a changed body resets status to 'pending' and clears the
--      old answer (a stale answer must never sit under new text); an
--      unchanged-body audience/category flip keeps the answer. A moderator-
--      hidden question stays hidden through any edit (editing must not be an
--      unhide loophole). is_anonymous is intentionally NOT editable.
--
-- admin_list_benefits gains a return column → record type changes → drop +
-- recreate, then re-assert 0039 EXECUTE hygiene on both functions.
--
-- Append-only — 0001–0077 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- admin_list_benefits — 0030 body + section_title.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_benefits(uuid);

create or replace function public.admin_list_benefits(p_lecture_id uuid default null)
returns table (
  id            uuid,
  lecture_id    uuid,
  lecture_title text,
  section_title text,
  body          text,
  status        text,
  author_id     uuid,
  author_name   text,
  author_email  text,
  created_at    timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    b.id, b.lecture_id, l.title, s.title, b.body, b.status,
    b.user_id,
    coalesce(p.display_name, 'طالب علم'),
    u.email::text,
    b.created_at
  from public.lecture_benefits b
  join public.lectures l on l.id = b.lecture_id
  left join public.sections s on s.id = l.section_id
  left join public.profiles p on p.id = b.user_id
  left join auth.users u on u.id = b.user_id
  where (p_lecture_id is null or b.lecture_id = p_lecture_id)
  order by b.created_at desc
  limit 500;
end;
$$;
revoke execute on function public.admin_list_benefits(uuid) from public, anon;
grant execute on function public.admin_list_benefits(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_own_question — owner-only edit, validated exactly like ask_question
-- (body 3–2000, audience/category whitelists, blocked-word filter per 0052/53).
-- ---------------------------------------------------------------------------
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
    -- New text invalidates the old answer; a moderator-hidden question stays
    -- hidden (editing is not an unhide path).
    update public.questions
       set body        = v_body,
           audience    = p_audience,
           category    = p_category,
           status      = case when status = 'hidden' then 'hidden' else 'pending' end,
           answer_body = null,
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
