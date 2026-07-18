-- =============================================================================
-- 0098_ticket_reply_notify_admin.sql
-- المَحجّة البَيْضَاء — item 10 follow-up: notify admins when a STUDENT replies
-- to their ticket (standard ticketing behaviour — the admin side must know a
-- reply is waiting, mirroring how admin_reply_ticket already notifies the
-- student).
--
-- Only change vs 0097: student_reply_ticket now inserts a 'feedback_received'
-- notification for every admin (best-effort, route /admin/feedback). Everything
-- else — the owner/closed guard, blocked-word filter, status→in_review — is
-- copied verbatim.
--
-- Append-only — 0001–0097 are never edited. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

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

  -- Notify every admin that the student replied (best-effort).
  begin
    insert into public.notifications (user_id, type, title, body, data)
    select p.id,
           'feedback_received',
           'ردّ جديد على تذكرة',
           left(v_body, 120),
           jsonb_build_object('route', '/admin/feedback')
      from public.profiles p
     where p.role = 'admin';
  exception when others then
    null;
  end;

  return v_id;
end;
$$;
grant execute on function public.student_reply_ticket(uuid, text) to authenticated;
