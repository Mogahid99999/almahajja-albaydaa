-- =============================================================================
-- 0101_ticket_image_read_gate.sql
-- المَحجّة البَيْضَاء — item 10 BUGFIX: ticket-reply images never displayed.
--
-- Admin ticket replies attach an image via uploadBroadcastImage, so the R2 key
-- lands under the `broadcasts/` prefix. But can_read_storage_object's
-- `broadcasts/` branch only allowed keys that belong to a BROADCAST row — a
-- feedback_messages.image_path was rejected, so the signed-URL read was denied
-- and the image showed for neither the admin nor the student.
--
-- Fix: the `broadcasts/` branch now ALSO allows a key that is a
-- feedback_messages.image_path, but only for someone who may see that ticket —
-- an admin, or the ticket's owner (student). Ticket privacy is preserved: a
-- third party still can't read another student's ticket image.
--
-- Everything else in the function is copied verbatim from 0096.
-- Append-only — 0001–0100 are never edited. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

create or replace function public.can_read_storage_object(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_key like 'lectures/%' then
      public.is_content_manager()
      or exists (
        select 1 from public.lectures l
        where l.audio_path = p_key and l.status = 'published'
      )
    when p_key like 'attachments/%' then
      public.is_content_manager()
      or exists (
        select 1 from public.attachments a
        where a.storage_path = p_key
          and (
            a.section_id is not null
            or exists (
              select 1 from public.lectures l
              where l.id = a.lecture_id and l.status = 'published'
            )
          )
      )
    when p_key like 'broadcasts/%' then
      exists (
        select 1 from public.broadcasts b
        where (b.image_path = p_key or b.audio_path = p_key) and b.deleted_at is null
      )
      -- Ticket-reply images live under broadcasts/ too — allow the admin or the
      -- ticket owner to read them, no one else.
      or exists (
        select 1
          from public.feedback_messages m
          join public.feedback f on f.id = m.feedback_id
         where m.image_path = p_key
           and (public.is_admin() or f.user_id = auth.uid())
      )
    else false
  end;
$$;
grant execute on function public.can_read_storage_object(text) to authenticated;
