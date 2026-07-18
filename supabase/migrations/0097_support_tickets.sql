-- =============================================================================
-- 0097_support_tickets.sql
-- المَحجّة البَيْضَاء — item 10: turn the one-shot feedback inbox into a
-- two-way SUPPORT-TICKET system (student ↔ admin thread).
--
-- Built ON TOP of the existing feedback table (0061) so no data is lost and the
-- admin inbox keeps working:
--   * feedback rows ARE tickets now. status gains 'awaiting_student' and
--     'closed' (existing 'new'/'in_review'/'resolved'/'dismissed' kept, so old
--     rows stay valid). UI labels: new→مفتوحة, in_review→قيد المراجعة,
--     awaiting_student→بانتظار ردّك, closed/resolved→مغلقة.
--   * feedback_messages — the reply thread (student + admin turns). Admin turns
--     may carry an image (R2 key) and a CTA button (label + route/url).
--   * submit_feedback also writes the opening message row (so the thread is
--     never empty).
--   * student_reply_ticket / admin_reply_ticket / admin_close_ticket drive the
--     conversation; admin replies notify the student (route → the ticket).
--   * get_my_tickets / get_ticket_thread read them (student = own, admin = all).
--
-- Append-only — 0001–0096 are never edited. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 1) Widen the status check to the ticket lifecycle. -----------------------
alter table public.feedback drop constraint if exists feedback_status_check;
alter table public.feedback
  add constraint feedback_status_check
  check (status in ('new', 'in_review', 'awaiting_student', 'resolved', 'dismissed', 'closed'));

-- 2) The reply thread. -----------------------------------------------------
create table if not exists public.feedback_messages (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  is_admin    boolean not null default false,
  body        text not null,
  image_path  text,           -- R2 key, admin replies only (prefix broadcasts/)
  cta_label   text,           -- optional call-to-action button label
  cta_route   text,           -- in-app route OR external URL for the CTA
  created_at  timestamptz not null default now()
);
create index if not exists feedback_messages_thread_idx
  on public.feedback_messages (feedback_id, created_at);

alter table public.feedback_messages enable row level security;

-- Reads: the ticket owner or an admin. No direct writes (RPCs only).
drop policy if exists feedback_messages_select on public.feedback_messages;
create policy feedback_messages_select on public.feedback_messages
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.feedback f
      where f.id = feedback_id and f.user_id = auth.uid()
    )
  );

grant select on public.feedback_messages to authenticated;

-- 3) submit_feedback — also seed the opening message. ----------------------
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

  -- Opening message of the ticket thread.
  insert into public.feedback_messages (feedback_id, author_id, is_admin, body)
  values (v_id, v_me, false, v_message);

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

-- 4) Student reply — append a message, reopen for review. ------------------
create or replace function public.student_reply_ticket(
  p_feedback_id uuid,
  p_body        text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
  v_ok   boolean;
begin
  if v_me is null then
    raise exception 'يلزم وجود جلسة';
  end if;
  if length(v_body) < 1 or length(v_body) > 2000 then
    raise exception 'نص الرد يجب أن يكون بين ١ و ٢٠٠٠ حرف';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  -- Must be the ticket owner, and not on a closed ticket.
  select (f.user_id = v_me and f.status <> 'closed') into v_ok
    from public.feedback f where f.id = p_feedback_id;
  if not coalesce(v_ok, false) then
    raise exception 'التذكرة غير متاحة';
  end if;

  insert into public.feedback_messages (feedback_id, author_id, is_admin, body)
  values (p_feedback_id, v_me, false, v_body)
  returning id into v_id;

  update public.feedback set status = 'in_review' where id = p_feedback_id;
  return v_id;
end;
$$;
grant execute on function public.student_reply_ticket(uuid, text) to authenticated;

-- 5) Admin reply — message (+ optional image + CTA), notify the student. ---
create or replace function public.admin_reply_ticket(
  p_feedback_id uuid,
  p_body        text,
  p_image_path  text default null,
  p_cta_label   text default null,
  p_cta_route   text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_body  text := btrim(coalesce(p_body, ''));
  v_owner uuid;
  v_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  if length(v_body) < 1 or length(v_body) > 4000 then
    raise exception 'نص الرد يجب أن يكون بين ١ و ٤٠٠٠ حرف';
  end if;

  select user_id into v_owner from public.feedback where id = p_feedback_id;
  if not found then
    raise exception 'التذكرة غير موجودة';
  end if;

  insert into public.feedback_messages
    (feedback_id, author_id, is_admin, body, image_path, cta_label, cta_route)
  values (
    p_feedback_id, v_me, true, v_body,
    nullif(btrim(coalesce(p_image_path, '')), ''),
    nullif(btrim(coalesce(p_cta_label, '')), ''),
    nullif(btrim(coalesce(p_cta_route, '')), '')
  )
  returning id into v_id;

  update public.feedback set status = 'awaiting_student' where id = p_feedback_id;

  -- Notify the student their ticket has a reply (best-effort).
  if v_owner is not null then
    begin
      insert into public.notifications (user_id, type, title, body, data)
      values (
        v_owner,
        'feedback_received',
        'ردّت الإدارة على ملاحظتك',
        left(v_body, 120),
        jsonb_build_object('route', '/(student)/tickets/' || p_feedback_id)
      );
    exception when others then
      null;
    end;
  end if;

  return v_id;
end;
$$;
grant execute on function public.admin_reply_ticket(uuid, text, text, text, text) to authenticated;

-- 6) Admin close. ----------------------------------------------------------
create or replace function public.admin_close_ticket(p_feedback_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  update public.feedback
     set status = 'closed', resolved_by = auth.uid(), resolved_at = now()
   where id = p_feedback_id
  returning user_id into v_owner;

  if v_owner is not null then
    begin
      insert into public.notifications (user_id, type, title, body, data)
      values (
        v_owner,
        'feedback_received',
        'أُغلقت تذكرتك',
        'شكراً لتواصلك — يمكنك فتح تذكرة جديدة في أي وقت',
        jsonb_build_object('route', '/(student)/tickets/' || p_feedback_id)
      );
    exception when others then
      null;
    end;
  end if;
end;
$$;
grant execute on function public.admin_close_ticket(uuid) to authenticated;

-- 7) Student: list my tickets (latest activity first). ---------------------
create or replace function public.get_my_tickets()
returns table (
  id            uuid,
  category      text,
  message       text,
  status        text,
  created_at    timestamptz,
  last_activity timestamptz,
  admin_replied boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'يلزم وجود جلسة';
  end if;
  return query
  select
    f.id, f.category, f.message, f.status, f.created_at,
    coalesce((select max(m.created_at) from public.feedback_messages m
               where m.feedback_id = f.id), f.created_at),
    exists (select 1 from public.feedback_messages m
             where m.feedback_id = f.id and m.is_admin)
  from public.feedback f
  where f.user_id = v_me
  order by 6 desc
  limit 200;
end;
$$;
grant execute on function public.get_my_tickets() to authenticated;

-- 8) The thread of one ticket (owner or admin). ----------------------------
create or replace function public.get_ticket_thread(p_feedback_id uuid)
returns table (
  id          uuid,
  is_admin    boolean,
  body        text,
  image_path  text,
  cta_label   text,
  cta_route   text,
  created_at  timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_me    uuid := auth.uid();
  v_owner uuid;
begin
  select user_id into v_owner from public.feedback where id = p_feedback_id;
  if not found then
    raise exception 'التذكرة غير موجودة';
  end if;
  if not (public.is_admin() or v_owner = v_me) then
    raise exception 'غير مصرح';
  end if;

  return query
  select m.id, m.is_admin, m.body, m.image_path, m.cta_label, m.cta_route, m.created_at
    from public.feedback_messages m
   where m.feedback_id = p_feedback_id
   order by m.created_at asc;
end;
$$;
grant execute on function public.get_ticket_thread(uuid) to authenticated;
