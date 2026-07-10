-- =============================================================================
-- 0070_question_category.sql
-- المَحجّة البَيْضَاء — مساحة الأسئلة: category filter (سؤال عام / فتوى شرعية).
--
-- Independent of `scope` (general/lecture) — a lecture question can be either
-- a plain general question or a formal fatwa request, and so can a general
-- one. Recreates ask_question/get_public_questions/get_my_questions/
-- get_question_inbox to accept/return/filter by p_category.
--
-- Append-only — 0001-0069 are never edited. Idempotent.
-- =============================================================================

alter table public.questions
  add column if not exists category text not null default 'general'
    check (category in ('general', 'fatwa'));

create index if not exists questions_category_idx
  on public.questions (category, status, created_at desc);

-- Drop the old signatures first — adding a parameter creates a new overload,
-- and the client always calls with the full new argument list.
drop function if exists public.ask_question(text, uuid, boolean, text, text);
drop function if exists public.get_public_questions(text, uuid);
drop function if exists public.get_my_questions(text, uuid);
drop function if exists public.get_question_inbox(text, text);

-- ---------------------------------------------------------------------------
-- ask_question — now takes p_category.
-- ---------------------------------------------------------------------------
create or replace function public.ask_question(
  p_scope        text,
  p_lecture_id   uuid,
  p_is_anonymous boolean,
  p_audience     text,
  p_body         text,
  p_category     text default 'general'
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'يلزم إنشاء حساب لطرح سؤال';
  end if;
  if p_scope not in ('general', 'lecture') then
    raise exception 'نطاق غير صالح';
  end if;
  if p_audience not in ('public', 'sheikh') then
    raise exception 'وجهة غير صالحة';
  end if;
  if p_category not in ('general', 'fatwa') then
    raise exception 'تصنيف غير صالح';
  end if;
  if p_scope = 'lecture' then
    if p_lecture_id is null or not exists (
      select 1 from public.lectures l
       where l.id = p_lecture_id and l.status = 'published'
    ) then
      raise exception 'الدرس غير متاح';
    end if;
  elsif p_lecture_id is not null then
    raise exception 'نطاق غير صالح';
  end if;
  if length(v_body) < 3 or length(v_body) > 2000 then
    raise exception 'نص السؤال يجب أن يكون بين ٣ و ٢٠٠٠ حرف';
  end if;

  insert into public.questions (scope, lecture_id, asker_id, is_anonymous, audience, body, category)
  values (p_scope, p_lecture_id, v_me, coalesce(p_is_anonymous, false), p_audience, v_body, p_category)
  returning id into v_id;

  -- Notify every sheikh (best-effort — a notif hiccup never fails the ask).
  begin
    insert into public.notifications (user_id, type, title, body, data)
    select p.id,
           'question_received',
           'سؤال جديد بانتظار الجواب',
           left(v_body, 120),
           jsonb_build_object('route', '/sheikh')
      from public.profiles p
     where p.role = 'sheikh'
       and coalesce((select np.enabled from public.notification_prefs np
                      where np.user_id = p.id and np.type = 'question_received'), true);
  exception when others then
    null;
  end;

  return v_id;
end;
$$;
grant execute on function public.ask_question(text, uuid, boolean, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_public_questions — now filterable by p_category.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_questions(
  p_scope      text,
  p_lecture_id uuid default null,
  p_category   text default null
)
returns table (
  id            uuid,
  body          text,
  answer_body   text,
  asker_display text,
  is_mine       boolean,
  category      text,
  created_at    timestamptz,
  answered_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    q.id,
    q.body,
    q.answer_body,
    case when q.is_anonymous then null
         else coalesce(p.display_name, 'طالب علم') end,
    q.asker_id = auth.uid(),
    q.category,
    q.created_at,
    q.answered_at
  from public.questions q
  left join public.profiles p on p.id = q.asker_id
  where q.scope = p_scope
    and (p_lecture_id is null or q.lecture_id = p_lecture_id)
    and (p_category is null or q.category = p_category)
    and q.status = 'answered'
    and q.audience = 'public'
  order by q.answered_at desc
  limit 200;
$$;
grant execute on function public.get_public_questions(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_questions — now filterable by p_category.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_questions(
  p_scope      text,
  p_lecture_id uuid default null,
  p_category   text default null
)
returns table (
  id           uuid,
  body         text,
  answer_body  text,
  is_anonymous boolean,
  audience     text,
  status       text,
  category     text,
  created_at   timestamptz,
  answered_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    q.id, q.body, q.answer_body, q.is_anonymous, q.audience, q.status, q.category,
    q.created_at, q.answered_at
  from public.questions q
  where q.asker_id = auth.uid()
    and q.scope = p_scope
    and (p_lecture_id is null or q.lecture_id = p_lecture_id)
    and (p_category is null or q.category = p_category)
  order by q.created_at desc
  limit 200;
$$;
grant execute on function public.get_my_questions(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_question_inbox — now filterable by p_category, returns category.
-- ---------------------------------------------------------------------------
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
    q.id, q.scope, q.lecture_id, l.title,
    q.body, q.answer_body, q.is_anonymous, q.audience, q.status, q.category,
    case
      when not q.is_anonymous then coalesce(p.display_name, 'طالب علم')
      when public.is_admin()  then coalesce(p.display_name, 'طالب علم')
      else 'سائل'
    end,
    case when public.is_admin() then q.asker_id else null end,
    q.created_at, q.answered_at
  from public.questions q
  left join public.lectures l on l.id = q.lecture_id
  left join public.profiles p on p.id = q.asker_id
  where (p_scope is null or q.scope = p_scope)
    and (p_status is null or q.status = p_status)
    and (p_category is null or q.category = p_category)
  order by q.created_at desc
  limit 500;
end;
$$;
grant execute on function public.get_question_inbox(text, text, text) to authenticated;
