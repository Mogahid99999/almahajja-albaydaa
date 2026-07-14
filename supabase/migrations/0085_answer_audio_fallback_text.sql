-- =============================================================================
-- 0085_answer_audio_fallback_text.sql
-- المَحجّة البَيْضَاء — جواب صوتي: forward-compatible fallback text.
--
-- A voice-only answer (0084) leaves answer_body NULL. Clients built BEFORE the
-- voice feature don't read answer_audio_path, so they'd render an EMPTY answer.
-- To keep those old clients coherent, an audio-only answer now stores a sentinel
-- text in answer_body («🎧 إجابة صوتية — يرجى تحديث التطبيق للاستماع») so a stale
-- client shows a readable hint instead of a blank. New clients recognise the
-- sentinel (VOICE_ANSWER_SENTINEL in src/api/questions.ts) and HIDE it, showing
-- the VoiceNotePlayer instead.
--
-- Only answer_question changes; the 0084 reads already surface answer_body +
-- answer_audio_path unchanged. Idempotent, append-only.
-- =============================================================================

create or replace function public.answer_question(
  p_question_id       uuid,
  p_answer_body       text,
  p_answer_audio_path text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  q            public.questions%rowtype;
  v_body       text := btrim(coalesce(p_answer_body, ''));
  v_audio      text := nullif(btrim(coalesce(p_answer_audio_path, '')), '');
  v_store_body text;
  v_route      text;
  v_pref       boolean;
  -- Must match VOICE_ANSWER_SENTINEL in src/api/questions.ts.
  c_sentinel   constant text := '🎧 إجابة صوتية — يرجى تحديث التطبيق للاستماع';
begin
  if not public.is_moderator() then
    raise exception 'غير مصرح';
  end if;
  -- At least one of text/audio must carry an answer.
  if length(v_body) < 1 and v_audio is null then
    raise exception 'أضِف نص الجواب أو تسجيلاً صوتياً';
  end if;
  if length(v_body) > 4000 then
    raise exception 'نص الجواب يجب ألا يتجاوز ٤٠٠٠ حرف';
  end if;

  -- Audio-only → store the sentinel so pre-voice clients see a readable hint.
  v_store_body := case
    when length(v_body) >= 1 then v_body
    when v_audio is not null  then c_sentinel
    else null
  end;

  select * into q from public.questions where id = p_question_id for update;
  if not found then
    raise exception 'السؤال غير موجود';
  end if;

  update public.questions
     set answer_body       = v_store_body,
         answer_audio_path = v_audio,
         status            = 'answered',
         answered_by       = auth.uid(),
         answered_at       = now()
   where id = q.id;

  -- Tell the asker (first answer only — a later edit stays quiet).
  if q.status = 'pending' then
    begin
      select enabled into v_pref from public.notification_prefs
       where user_id = q.asker_id and type = 'question_answered';
      if coalesce(v_pref, true) then
        v_route := case when q.scope = 'lecture'
                        then '/(student)/lecture-questions/' || q.lecture_id
                        else '/(student)/questions' end;
        insert into public.notifications (user_id, type, title, body, data)
        values (
          q.asker_id,
          'question_answered',
          'أُجيب عن سؤالك',
          left(q.body, 100),
          jsonb_build_object('route', v_route)
        );
      end if;
    exception when others then
      null;
    end;
  end if;
end;
$$;
grant execute on function public.answer_question(uuid, text, text) to authenticated;
