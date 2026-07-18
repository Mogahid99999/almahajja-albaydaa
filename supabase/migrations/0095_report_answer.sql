-- =============================================================================
-- 0095_report_answer.sql
-- المَحجّة البَيْضَاء — item 4: report an error in a Sheikh's ANSWER.
--
-- Students can already report a question or a benefit (0051 report_content →
-- content_reports → admin /admin/reports). This extends that same pipeline to a
-- THIRD content type, 'answer' (a row in question_answers, 0086), and — unlike
-- question/benefit reports — also notifies the SHEIKH who wrote the answer, so
-- the correction reaches both the admin panel AND the answerer.
--
-- Changes (all append-only, idempotent):
--   1) content_reports.content_type check → allow 'answer'.
--   2) report_content — accept 'answer' (validated against question_answers),
--      notify every admin (route /admin/reports) AND the answering sheikh
--      (route /sheikh). Reuses the existing 'content_reported' notification type
--      (no new enum label, so this stays a single-statement-safe migration).
--   3) admin_list_reports — resolve an 'answer' report's body (the answer text)
--      and author (question_answers.answered_by) so it renders in the queue.
--
-- Everything else in report_content / admin_list_reports is copied verbatim from
-- the live 0059-era definitions.
--
-- Append-only migration — 0001–0094 are never edited.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1) Allow the new content type. -------------------------------------------
alter table public.content_reports
  drop constraint if exists content_reports_content_type_check;
alter table public.content_reports
  add constraint content_reports_content_type_check
  check (content_type in ('question', 'benefit', 'answer'));

-- 2) report_content — + 'answer', + notify the answering sheikh. -----------
create or replace function public.report_content(
  p_content_type text,
  p_content_id   uuid,
  p_reason       text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me      uuid := auth.uid();
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id      uuid;
  v_sheikh  uuid;
begin
  if p_content_type not in ('question', 'benefit', 'answer') then
    raise exception 'نوع غير صالح';
  end if;

  -- Content must exist (mirrors the question/benefit existence checks).
  if p_content_type = 'question' and not exists (
    select 1 from public.questions where id = p_content_id
  ) then
    raise exception 'المحتوى غير موجود';
  end if;
  if p_content_type = 'benefit' and not exists (
    select 1 from public.lecture_benefits where id = p_content_id
  ) then
    raise exception 'المحتوى غير موجود';
  end if;
  if p_content_type = 'answer' and not exists (
    select 1 from public.question_answers where id = p_content_id
  ) then
    raise exception 'المحتوى غير موجود';
  end if;

  -- Blocked-word check on the optional reason (SQLSTATE 'BLOCK', 0053).
  if v_reason is not null and public.contains_blocked_word(v_reason) then
    raise exception using errcode = 'BLOCK', message = 'blocked';
  end if;

  -- One open report per (reporter, content). Anonymous sessions skip this.
  if v_me is not null and exists (
    select 1 from public.content_reports
     where reporter_id = v_me and content_id = p_content_id and status = 'open'
  ) then
    raise exception 'سبق أن أبلغت عن هذا المحتوى';
  end if;

  insert into public.content_reports (content_type, content_id, reporter_id, reason)
  values (p_content_type, p_content_id, v_me, v_reason)
  returning id into v_id;

  -- Notify every admin (best-effort — a notif hiccup never fails the report).
  begin
    insert into public.notifications (user_id, type, title, body, data)
    select p.id,
           'content_reported',
           'بلاغ جديد بحاجة إلى مراجعة',
           case p_content_type
             when 'question' then 'تم الإبلاغ عن سؤال — بحاجة مراجعة'
             when 'benefit'  then 'تم الإبلاغ عن فائدة — بحاجة مراجعة'
             else 'تم الإبلاغ عن خطأ في إجابة — بحاجة مراجعة'
           end,
           jsonb_build_object('route', '/admin/reports')
      from public.profiles p
     where p.role = 'admin';
  exception when others then
    null;
  end;

  -- For an ANSWER report, also notify the sheikh who wrote it (best-effort).
  if p_content_type = 'answer' then
    begin
      select answered_by into v_sheikh
        from public.question_answers where id = p_content_id;
      if v_sheikh is not null then
        insert into public.notifications (user_id, type, title, body, data)
        values (
          v_sheikh,
          'content_reported',
          'ملاحظة على إجابتك بحاجة إلى مراجعة',
          'أبلغ أحد الطلبة عن خطأ محتمل في إحدى إجاباتك',
          jsonb_build_object('route', '/sheikh')
        );
      end if;
    exception when others then
      null;
    end;
  end if;

  return v_id;
end;
$$;
grant execute on function public.report_content(text, uuid, text) to authenticated;

-- 3) admin_list_reports — resolve answer body + author. --------------------
drop function if exists public.admin_list_reports(text);

create function public.admin_list_reports(p_status text default null)
returns table (
  id            uuid,
  content_type  text,
  content_id    uuid,
  content_body  text,
  reason        text,
  status        text,
  reporter_id   uuid,
  reporter_name text,
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
    r.id, r.content_type, r.content_id,
    case r.content_type
      when 'question' then (select q.body from public.questions q where q.id = r.content_id)
      when 'benefit'  then (select b.body from public.lecture_benefits b where b.id = r.content_id)
      when 'answer'   then (select coalesce(nullif(btrim(qa.body), ''), '(إجابة صوتية)')
                              from public.question_answers qa where qa.id = r.content_id)
    end,
    r.reason, r.status, r.reporter_id,
    case when r.reporter_id is null then null
         else coalesce(p.display_name, 'طالب علم') end,
    a.author_id,
    case when a.author_id is null then null
         else coalesce(ap.display_name, 'طالب علم') end,
    au.email::text,
    r.created_at
  from public.content_reports r
  left join public.profiles p on p.id = r.reporter_id
  left join lateral (
    select case r.content_type
      when 'question' then (select q.asker_id    from public.questions q        where q.id = r.content_id)
      when 'benefit'  then (select b.user_id     from public.lecture_benefits b where b.id = r.content_id)
      when 'answer'   then (select qa.answered_by from public.question_answers qa where qa.id = r.content_id)
    end as author_id
  ) a on true
  left join public.profiles ap on ap.id = a.author_id
  left join auth.users au on au.id = a.author_id
  where (p_status is null or r.status = p_status)
  order by r.created_at desc
  limit 500;
end;
$$;
grant execute on function public.admin_list_reports(text) to authenticated;
