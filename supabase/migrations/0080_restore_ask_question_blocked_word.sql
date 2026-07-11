-- =============================================================================
-- 0080_restore_ask_question_blocked_word.sql
-- المَحجّة البَيْضَاء — restore the blocked-word filter in ask_question.
--
-- 0053 wired public.contains_blocked_word() into ask_question, but 0070's
-- recreation (adding p_category) reproduced the 0028 body and silently dropped
-- that check — new questions have bypassed the word filter since. This is the
-- 0070 body verbatim plus the one restored check, placed exactly where 0053
-- had it (after the length validation, before the insert). update_own_question
-- (0078) already checks; this brings asking back in line.
--
-- Same signature as 0070 → create or replace keeps the existing grant, but
-- re-assert 0039 hygiene anyway.
--
-- Append-only — 0001–0079 are never edited. Idempotent.
-- =============================================================================

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
  if public.contains_blocked_word(v_body) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
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
revoke execute on function public.ask_question(text, uuid, boolean, text, text, text) from public, anon;
grant execute on function public.ask_question(text, uuid, boolean, text, text, text) to authenticated;
