-- =============================================================================
-- 0077_inbox_anonymity_and_section_title.sql
-- المَحجّة البَيْضَاء — V14 items 1+2 (inbox side):
--
--   1) Anonymous questions hide the asker's name from EVERYONE, admin included.
--      0070 deliberately revealed the real name to admins; that branch is
--      removed — `asker_display` is now 'سائل' whenever is_anonymous, for both
--      sheikh and admin. Moderation is unaffected: `asker_id` still ships to
--      admins only, so «حظر الكاتب» keeps working.
--   2) The inbox also returns `section_title` — the lesson's DIRECT parent
--      section (lectures.section_id → sections.title, no recursion), so the
--      screens can render «القسم ← الدرس» instead of the bare lesson title.
--
-- Adding a return column changes the record type, so the 0070 function must be
-- dropped (not replaced) — which resets EXECUTE to Postgres's PUBLIC default;
-- the 0039 revoke/grant hygiene below restores authenticated-only.
--
-- Append-only — 0001–0076 are never edited. Idempotent.
-- =============================================================================

drop function if exists public.get_question_inbox(text, text, text);

create or replace function public.get_question_inbox(
  p_scope    text default null,
  p_status   text default null,
  p_category text default null
)
returns table (
  id            uuid,
  scope         text,
  lecture_id    uuid,
  lecture_title text,
  section_title text,
  body          text,
  answer_body   text,
  is_anonymous  boolean,
  audience      text,
  status        text,
  category      text,
  asker_display text,
  asker_id      uuid,
  created_at    timestamptz,
  answered_at   timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_moderator() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    q.id, q.scope, q.lecture_id, l.title, s.title,
    q.body, q.answer_body, q.is_anonymous, q.audience, q.status, q.category,
    case
      when q.is_anonymous then 'سائل'
      else coalesce(p.display_name, 'طالب علم')
    end,
    case when public.is_admin() then q.asker_id else null end,
    q.created_at, q.answered_at
  from public.questions q
  left join public.lectures l on l.id = q.lecture_id
  left join public.sections s on s.id = l.section_id
  left join public.profiles p on p.id = q.asker_id
  where (p_scope is null or q.scope = p_scope)
    and (p_status is null or q.status = p_status)
    and (p_category is null or q.category = p_category)
  order by q.created_at desc
  limit 500;
end;
$$;
revoke execute on function public.get_question_inbox(text, text, text) from public, anon;
grant execute on function public.get_question_inbox(text, text, text) to authenticated;
