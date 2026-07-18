-- =============================================================================
-- 0100_admin_reply_sets_in_review.sql
-- المَحجّة البَيْضَاء — item 10 tweak: an admin reply keeps the ticket under
-- «قيد المراجعة».
--
-- admin_reply_ticket (0097) set status to 'awaiting_student' after a reply, which
-- dropped the ticket out of the admin's «قيد المراجعة» tab. The owner wants a
-- replied ticket to stay in review (the admin is still handling it), so this
-- redefines the function to set status = 'in_review' instead. Everything else —
-- the message insert (+image+CTA), the admin-only gate, the student
-- notification — is copied verbatim from 0097.
--
-- ('awaiting_student' remains a valid status in the check constraint; it is just
--  no longer set here.)
--
-- Append-only — 0001–0099 are never edited. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

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

  -- Stay under review after a reply (the admin is still handling it).
  update public.feedback set status = 'in_review' where id = p_feedback_id;

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
