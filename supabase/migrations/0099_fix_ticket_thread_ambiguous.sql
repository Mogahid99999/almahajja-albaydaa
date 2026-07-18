-- =============================================================================
-- 0099_fix_ticket_thread_ambiguous.sql
-- المَحجّة البَيْضَاء — item 10 BUGFIX: get_ticket_thread (0097) failed with
-- «column reference "id" is ambiguous» (SQLSTATE 42702) because the RETURNS
-- TABLE OUT column `id` collided with `feedback_messages.id` in the SELECT.
--
-- Effect of the bug: the RPC errored for EVERYONE, so the student's thread query
-- threw and the ticket screen showed no messages — the reported "student does
-- not see the admin's reply". Same latent risk for the other OUT names.
--
-- Fix: `#variable_conflict use_column` tells plpgsql to resolve an ambiguous
-- bare name (id/body/…) to the COLUMN rather than the same-named RETURNS TABLE
-- OUT variable — the standard remedy for this class of error. The OUT column
-- names (and therefore the JSON keys the client maps on) are unchanged, so no
-- client change is needed. Behaviour is otherwise identical to 0097.
--
-- Append-only — 0001–0098 are never edited. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

drop function if exists public.get_ticket_thread(uuid);

create function public.get_ticket_thread(p_feedback_id uuid)
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
#variable_conflict use_column
declare
  v_me    uuid := auth.uid();
  v_owner uuid;
begin
  select f.user_id into v_owner from public.feedback f where f.id = p_feedback_id;
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
