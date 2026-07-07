-- =============================================================================
-- 0061_feedback.sql
-- المَحجّة البَيْضَاء — طلاب feedback: a guided in-app form (مشكلة / اقتراح
-- تحسين / أخرى) that reaches admins only, carrying client-supplied device
-- info (platform/OS/app version) for triage. Requires 0060 applied first
-- (its own transaction, adds the 'feedback_received' enum value).
--
-- Design mirrors content_reports (0051) closely:
--   * user_id is NULLABLE — guest sessions (anon auth, see guest-first
--     foundation) may submit feedback too, same as reporting abuse.
--   * submit_feedback is the only insert path (DEFINER RPC), blocked-word
--     filtered like every other free-text submission (0053 pattern).
--   * admin_list_feedback / admin_set_feedback_status mirror
--     admin_list_reports / admin_set_report_status (0051) for structure,
--     gated on is_admin() — feedback triage is an admin-only concern.
--
-- Append-only — 0001–0060 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete set null,
  category     text not null check (category in ('bug', 'improvement', 'other')),
  message      text not null,
  device_info  jsonb not null default '{}'::jsonb,
  status       text not null default 'new'
                 check (status in ('new', 'in_review', 'resolved', 'dismissed')),
  admin_note   text,
  resolved_by  uuid references auth.users (id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists feedback_status_idx
  on public.feedback (status, created_at desc);
create index if not exists feedback_user_idx
  on public.feedback (user_id);

-- RLS: own-row insert (or anonymous) + own-or-admin select, no direct update/
-- delete — moderation is exclusively admin_set_feedback_status. Mirrors
-- content_reports (0051 L44-58) exactly.
alter table public.feedback enable row level security;

drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid() or user_id is null);

drop policy if exists feedback_select_own_or_admin on public.feedback;
create policy feedback_select_own_or_admin on public.feedback
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select, insert on public.feedback to authenticated;

-- ---------------------------------------------------------------------------
-- submit_feedback — anyone with a session (guest or registered) may submit.
-- Best-effort admin notification fan-out, same exception-swallow shape as
-- report_content (0051/0053).
-- ---------------------------------------------------------------------------
create or replace function public.submit_feedback(
  p_category    text,
  p_message     text,
  p_device_info jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me      uuid := auth.uid();
  v_message text := btrim(coalesce(p_message, ''));
  v_id      uuid;
begin
  if v_me is null then
    raise exception 'يلزم وجود جلسة';
  end if;
  if p_category not in ('bug', 'improvement', 'other') then
    raise exception 'نوع غير صالح';
  end if;
  if length(v_message) < 3 or length(v_message) > 2000 then
    raise exception 'نص الملاحظة يجب أن يكون بين ٣ و ٢٠٠٠ حرف';
  end if;
  if public.contains_blocked_word(v_message) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  insert into public.feedback (user_id, category, message, device_info)
  values (v_me, p_category, v_message, coalesce(p_device_info, '{}'::jsonb))
  returning id into v_id;

  -- Notify every admin (best-effort — a notif hiccup never fails the submission).
  begin
    insert into public.notifications (user_id, type, title, body, data)
    select p.id,
           'feedback_received',
           'ملاحظة جديدة من أحد الدارسين',
           case p_category
             when 'bug' then 'تبليغ عن مشكلة — بحاجة مراجعة'
             when 'improvement' then 'اقتراح تحسين — بحاجة مراجعة'
             else 'ملاحظة عامة — بحاجة مراجعة'
           end,
           jsonb_build_object('route', '/admin/feedback')
      from public.profiles p
     where p.role = 'admin';
  exception when others then
    null;
  end;

  return v_id;
end;
$$;
grant execute on function public.submit_feedback(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin triage — mirrors admin_list_reports / admin_set_report_status
-- (0051 L135-185) exactly for structure/gating.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_feedback(p_status text default null)
returns table (
  id           uuid,
  category     text,
  message      text,
  device_info  jsonb,
  status       text,
  admin_note   text,
  user_id      uuid,
  user_name    text,
  created_at   timestamptz,
  resolved_at  timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    f.id, f.category, f.message, f.device_info, f.status, f.admin_note,
    f.user_id,
    case when f.user_id is null then null
         else coalesce(p.display_name, 'طالب علم') end,
    f.created_at, f.resolved_at
  from public.feedback f
  left join public.profiles p on p.id = f.user_id
  where (p_status is null or f.status = p_status)
  order by f.created_at desc
  limit 500;
end;
$$;
grant execute on function public.admin_list_feedback(text) to authenticated;

create or replace function public.admin_set_feedback_status(
  p_feedback_id uuid,
  p_status      text,
  p_admin_note  text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  if p_status not in ('new', 'in_review', 'resolved', 'dismissed') then
    raise exception 'حالة غير صالحة';
  end if;
  update public.feedback
     set status = p_status,
         admin_note = coalesce(p_admin_note, admin_note),
         resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() else resolved_by end,
         resolved_at = case when p_status in ('resolved', 'dismissed') then now() else resolved_at end
   where id = p_feedback_id;
end;
$$;
grant execute on function public.admin_set_feedback_status(uuid, text, text) to authenticated;
