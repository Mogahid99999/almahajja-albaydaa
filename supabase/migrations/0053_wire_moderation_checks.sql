-- =============================================================================
-- 0053_wire_moderation_checks.sql
-- المَحجّة البَيْضَاء — Item 5: wire the blocked-word filter into every
-- free-text submission path (questions, benefits, report reasons).
--
-- create-or-replace of THREE existing/just-created functions, each
-- reproducing its full existing body verbatim plus one new check before the
-- insert. A distinct SQLSTATE ('BLOCK', 5 chars, custom/unreserved) lets the
-- client catch this specific rejection and show the calm Arabic message
-- instead of a generic error (see src/api/reports.ts).
--
-- Append-only — 0001–0052 are never edited (this is a NEW file re-declaring
-- the functions via create-or-replace, not an edit to 0028/0030/0051).
-- Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ask_question (0028 body, verbatim) + blocked-word check on p_body.
-- ---------------------------------------------------------------------------
create or replace function public.ask_question(
  p_scope        text,
  p_lecture_id   uuid,
  p_is_anonymous boolean,
  p_audience     text,
  p_body         text
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
  if public.contains_blocked_word(v_body) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  insert into public.questions (scope, lecture_id, asker_id, is_anonymous, audience, body)
  values (p_scope, p_lecture_id, v_me, coalesce(p_is_anonymous, false), p_audience, v_body)
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
grant execute on function public.ask_question(text, uuid, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_lecture_benefit (0030 body, verbatim) + blocked-word check on p_body.
-- ---------------------------------------------------------------------------
create or replace function public.add_lecture_benefit(p_lecture_id uuid, p_body text)
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
    raise exception 'يلزم إنشاء حساب لمشاركة فائدة';
  end if;
  if not exists (
    select 1 from public.lectures l
     where l.id = p_lecture_id and l.status = 'published'
  ) then
    raise exception 'الدرس غير متاح';
  end if;
  if length(v_body) < 3 or length(v_body) > 1000 then
    raise exception 'نص الفائدة يجب أن يكون بين ٣ و ١٠٠٠ حرف';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  insert into public.lecture_benefits (lecture_id, user_id, body)
  values (p_lecture_id, v_me, v_body)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.add_lecture_benefit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- report_content (0051 body, verbatim) + blocked-word check on the reason.
-- Only checked when a reason was actually given — an empty/omitted reason is
-- always allowed through unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.report_content(
  p_content_type text,
  p_content_id   uuid,
  p_reason       text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  if p_content_type not in ('question', 'benefit') then
    raise exception 'نوع محتوى غير صالح';
  end if;
  if p_content_type = 'question' and not exists (
    select 1 from public.questions q where q.id = p_content_id
  ) then
    raise exception 'العنصر غير موجود';
  end if;
  if p_content_type = 'benefit' and not exists (
    select 1 from public.lecture_benefits b where b.id = p_content_id
  ) then
    raise exception 'العنصر غير موجود';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'سبب البلاغ طويل جداً';
  end if;
  if v_reason is not null and public.contains_blocked_word(v_reason) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  if v_me is not null and exists (
    select 1 from public.content_reports
     where reporter_id = v_me and content_id = p_content_id and status = 'open'
  ) then
    raise exception 'سبق أن أبلغت عن هذا المحتوى';
  end if;

  insert into public.content_reports (content_type, content_id, reporter_id, reason)
  values (p_content_type, p_content_id, v_me, v_reason)
  returning id into v_id;

  begin
    insert into public.notifications (user_id, type, title, body, data)
    select p.id,
           'content_reported',
           'بلاغ جديد بحاجة إلى مراجعة',
           case p_content_type
             when 'question' then 'تم الإبلاغ عن سؤال — بحاجة مراجعة'
             else 'تم الإبلاغ عن فائدة — بحاجة مراجعة'
           end,
           jsonb_build_object('route', '/admin/reports')
      from public.profiles p
     where p.role = 'admin';
  exception when others then
    null;
  end;

  return v_id;
end;
$$;
grant execute on function public.report_content(text, uuid, text) to authenticated;
