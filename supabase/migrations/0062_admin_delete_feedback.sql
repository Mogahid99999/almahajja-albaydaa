-- =============================================================================
-- 0062_admin_delete_feedback.sql
-- المَحجّة البَيْضَاء — admin hard-delete for ملاحظات الطلاب (feedback, 0061).
-- Mirrors delete_question (0028 L222-234) exactly for structure/gating —
-- admin-only (feedback triage has no sheikh angle), permanent removal.
--
-- Append-only — 0001–0061 are never edited. Idempotent.
-- =============================================================================

create or replace function public.admin_delete_feedback(p_feedback_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  delete from public.feedback where id = p_feedback_id;
end;
$$;
grant execute on function public.admin_delete_feedback(uuid) to authenticated;
