-- 0179: a benefit may be up to 3000 characters (was 1000).
-- Students hit the 1000 limit (longest published benefit = exactly 1000; a
-- student split a long one in two and both halves were still refused). The
-- lecture composer has no counter yet, so the server limit is what they meet.
-- Only the length check and its message change; bodies are the live (prod =
-- staging) definitions of 2026-11-14. CREATE OR REPLACE keeps the grants.
-- Rollback: re-run with 1000 / ١٠٠٠ (no data change either way).

CREATE OR REPLACE FUNCTION public.add_general_benefit(p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if length(v_body) < 3 or length(v_body) > 3000 then
    raise exception 'نص الفائدة يجب أن يكون بين ٣ و ٣٠٠٠ حرف';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  insert into public.lecture_benefits (lecture_id, user_id, body)
  values (null, v_me, v_body)
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_lecture_benefit(p_lecture_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول';
  end if;
  if public.is_guest() then
    raise exception 'يلزم إنشاء حساب لمشاركة فائدة';
  end if;
  if not exists (
    select 1 from public.lectures l
     where l.id = p_lecture_id and l.status = 'published'
  ) then
    raise exception 'الدرس غير متاح';
  end if;
  if length(v_body) < 3 or length(v_body) > 3000 then
    raise exception 'نص الفائدة يجب أن يكون بين ٣ و ٣٠٠٠ حرف';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  insert into public.lecture_benefits (lecture_id, user_id, body)
  values (p_lecture_id, v_me, v_body)
  returning id into v_id;
  return v_id;
end;
$function$;
