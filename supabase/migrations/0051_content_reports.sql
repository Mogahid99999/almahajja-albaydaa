-- =============================================================================
-- 0051_content_reports.sql
-- المَحجّة البَيْضَاء — Items 4/6: shared "report to admin" system for questions
-- (أسئلة وأجوبة) and فوائد الدارسين (benefits) — ONE mechanism, two content
-- types. Fans a 'content_reported' notification out to every admin (mirrors
-- ask_question's sheikh fan-out in 0028 exactly, incl. the exception-swallow
-- wrapper). Requires 0050 applied first (its own transaction).
--
-- Design:
--   * reporter_id is NULLABLE — anonymous/guest sessions may report too
--     (unlike ask_question / add_lecture_benefit, reporting abuse should
--     never require an account). One open report per (reporter, content) is
--     enforced only when reporter_id is not null (no stable identity to
--     dedupe an anonymous report against).
--   * admin_list_reports / admin_set_report_status mirror
--     admin_list_benefits / admin_set_benefit_status (0030) exactly for
--     structure, gated on is_admin() (reports are an admin-only concern, not
--     sheikh — same gate benefits use, narrower than questions' is_moderator()).
--   * Also seeds the 'admin_notify_email' app_config key (empty default,
--     editable from app/admin/settings.tsx) — the destination address for the
--     email half of item 6 (see the notify-on-publish edge function change).
--
-- Append-only — 0001–0050 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.content_reports (
  id          uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('question', 'benefit')),
  content_id   uuid not null,
  reporter_id  uuid references auth.users (id) on delete set null,
  reason       text,
  status       text not null default 'open'
                 check (status in ('open', 'reviewed', 'dismissed')),
  created_at   timestamptz not null default now()
);

create index if not exists content_reports_content_idx
  on public.content_reports (content_type, content_id, status);
create index if not exists content_reports_status_idx
  on public.content_reports (status, created_at desc);
create index if not exists content_reports_reporter_idx
  on public.content_reports (reporter_id);

-- RLS: mirrors questions (0028) / lecture_benefits (0030) — own-row insert +
-- own-or-admin select. Reports themselves are always created via the
-- report_content DEFINER RPC below; no update/delete policies — moderation is
-- exclusively admin_set_report_status.
alter table public.content_reports enable row level security;

drop policy if exists content_reports_insert_own on public.content_reports;
create policy content_reports_insert_own on public.content_reports
  for insert to authenticated
  with check (reporter_id = auth.uid() or reporter_id is null);

drop policy if exists content_reports_select_own_or_admin on public.content_reports;
create policy content_reports_select_own_or_admin on public.content_reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

grant select, insert on public.content_reports to authenticated;

-- ---------------------------------------------------------------------------
-- report_content — anyone with a session (guest or registered) may report a
-- question or a benefit. Best-effort admin notification fan-out, same
-- exception-swallow shape as ask_question's sheikh fan-out (0028 L143-156).
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

  -- One OPEN report per (reporter, content) — identified reporters only;
  -- anonymous sessions (no stable auth.uid()) skip this check entirely.
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

-- ---------------------------------------------------------------------------
-- Admin moderation — mirrors admin_list_benefits / admin_set_benefit_status
-- (0030 L123-171) exactly for structure/gating.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_reports(p_status text default null)
returns table (
  id            uuid,
  content_type  text,
  content_id    uuid,
  content_body  text,
  reason        text,
  status        text,
  reporter_id   uuid,
  reporter_name text,
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
    end,
    r.reason, r.status, r.reporter_id,
    case when r.reporter_id is null then null
         else coalesce(p.display_name, 'طالب علم') end,
    r.created_at
  from public.content_reports r
  left join public.profiles p on p.id = r.reporter_id
  where (p_status is null or r.status = p_status)
  order by r.created_at desc
  limit 500;
end;
$$;
grant execute on function public.admin_list_reports(text) to authenticated;

create or replace function public.admin_set_report_status(p_report_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  if p_status not in ('open', 'reviewed', 'dismissed') then
    raise exception 'حالة غير صالحة';
  end if;
  update public.content_reports set status = p_status where id = p_report_id;
end;
$$;
grant execute on function public.admin_set_report_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- app_config seed: destination address for the email half of item 6. Empty
-- default = the email step no-ops until an admin fills it in from
-- app/admin/settings.tsx (FieldDef pattern, see client changes below).
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values
  ('admin_notify_email', '')
on conflict (key) do nothing;
