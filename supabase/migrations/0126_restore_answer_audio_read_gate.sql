-- =============================================================================
-- 0126_restore_answer_audio_read_gate.sql
-- المَحجّة البَيْضَاء — BUGFIX: sheikh voice answers show «تعذّر تحميل التسجيل الصوتي».
--
-- 0084/0086 gave can_read_storage_object an `answers/` branch (voice answers
-- live under that R2 prefix). 0096 (broadcast audio) rewrote the function from
-- an older copy WITHOUT that branch, and 0101 (ticket images) copied 0096
-- verbatim — so every `answers/…` key fell through to `else false`, r2-read-url
-- returned 403, getReadUrl returned null and VoiceNotePlayer showed the error.
--
-- Fix: 0101's body verbatim + the 0086 `answers/` branch restored unchanged
-- (moderator, the asker, or anyone once the question is public + answered —
-- matching both questions.answer_audio_path and question_answers.audio_path).
--
-- NOTE for future edits: this function is rewritten whole each time — start
-- from the LATEST migration's body, not an older one.
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
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
    when p_key like 'answers/%' then
      public.is_moderator()
      or exists (
        select 1 from public.questions q
        where q.answer_audio_path = p_key
          and (q.asker_id = auth.uid() or (q.audience = 'public' and q.status = 'answered'))
      )
      or exists (
        select 1 from public.question_answers a
        join public.questions q on q.id = a.question_id
        where a.audio_path = p_key
          and (q.asker_id = auth.uid() or (q.audience = 'public' and q.status = 'answered'))
      )
    else false
  end;
$$;
grant execute on function public.can_read_storage_object(text) to authenticated;
