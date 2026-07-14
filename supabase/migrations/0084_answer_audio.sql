-- =============================================================================
-- 0084_answer_audio.sql
-- المَحجّة البَيْضَاء — جواب صوتي: the sheikh may answer a question with a VOICE
-- recording (WhatsApp-style), in addition to — or instead of — the text answer.
--
--   1) questions.answer_audio_path — the R2 object key (prefix `answers/`) of the
--      recorded m4a, null when the answer is text-only.
--   2) answer_question — now 3-arg (p_answer_body, p_answer_audio_path). At least
--      ONE of body/audio must be non-empty; the body length ceiling still holds
--      when a body is present, but an audio-only answer may carry an empty body.
--   3) get_public_questions / get_my_questions / get_question_inbox — all now
--      also return answer_audio_path (every existing OUT column + filter/anonymity
--      rule preserved).
--   4) can_read_storage_object — a new `answers/%` branch: readable by moderators,
--      or by the asker of the owning question; public-audience answered questions
--      are readable by any authenticated caller (mirrors get_public_questions).
--
-- Adding params / OUT columns changes each function's identity, so the old
-- signatures are dropped first (PostgREST overload resolution) and EXECUTE is
-- re-granted to authenticated afterwards.
--
-- Append-only — 0001–0083 are never edited. Idempotent.
-- =============================================================================

alter table public.questions
  add column if not exists answer_audio_path text;

-- ---------------------------------------------------------------------------
-- answer_question — sheikh or admin. Accepts an optional voice-answer R2 key.
-- Body may be empty when an audio path is supplied; at least one is required.
-- Notifies the ASKER on the first answer (unchanged).
-- ---------------------------------------------------------------------------
drop function if exists public.answer_question(uuid, text);
drop function if exists public.answer_question(uuid, text, text);

create or replace function public.answer_question(
  p_question_id       uuid,
  p_answer_body       text,
  p_answer_audio_path text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  q       public.questions%rowtype;
  v_body  text := btrim(coalesce(p_answer_body, ''));
  v_audio text := nullif(btrim(coalesce(p_answer_audio_path, '')), '');
  v_route text;
  v_pref  boolean;
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

  select * into q from public.questions where id = p_question_id for update;
  if not found then
    raise exception 'السؤال غير موجود';
  end if;

  update public.questions
     set answer_body       = nullif(v_body, ''),
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

-- ---------------------------------------------------------------------------
-- get_public_questions — now also returns answer_audio_path.
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_questions(text, uuid, text);

create or replace function public.get_public_questions(
  p_scope      text,
  p_lecture_id uuid default null,
  p_category   text default null
)
returns table (
  id                uuid,
  body              text,
  answer_body       text,
  answer_audio_path text,
  asker_display     text,
  is_mine           boolean,
  category          text,
  created_at        timestamptz,
  answered_at       timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    q.id,
    q.body,
    q.answer_body,
    q.answer_audio_path,
    case when q.is_anonymous then null
         else coalesce(p.display_name, 'طالب علم') end,
    q.asker_id = auth.uid(),
    q.category,
    q.created_at,
    q.answered_at
  from public.questions q
  left join public.profiles p on p.id = q.asker_id
  where q.scope = p_scope
    and (p_lecture_id is null or q.lecture_id = p_lecture_id)
    and (p_category is null or q.category = p_category)
    and q.status = 'answered'
    and q.audience = 'public'
  order by q.answered_at desc
  limit 200;
$$;
grant execute on function public.get_public_questions(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_questions — now also returns answer_audio_path.
-- ---------------------------------------------------------------------------
drop function if exists public.get_my_questions(text, uuid, text);

create or replace function public.get_my_questions(
  p_scope      text,
  p_lecture_id uuid default null,
  p_category   text default null
)
returns table (
  id                uuid,
  body              text,
  answer_body       text,
  answer_audio_path text,
  is_anonymous      boolean,
  audience          text,
  status            text,
  category          text,
  created_at        timestamptz,
  answered_at       timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    q.id, q.body, q.answer_body, q.answer_audio_path,
    q.is_anonymous, q.audience, q.status, q.category,
    q.created_at, q.answered_at
  from public.questions q
  where q.asker_id = auth.uid()
    and q.scope = p_scope
    and (p_lecture_id is null or q.lecture_id = p_lecture_id)
    and (p_category is null or q.category = p_category)
  order by q.created_at desc
  limit 200;
$$;
grant execute on function public.get_my_questions(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_question_inbox — now also returns answer_audio_path. Preserves the 0077
-- anonymity rule (asker_display = 'سائل' for anonymous, admin included) and the
-- section_title / asker_id (admin-only) columns.
-- ---------------------------------------------------------------------------
drop function if exists public.get_question_inbox(text, text, text);

create or replace function public.get_question_inbox(
  p_scope    text default null,
  p_status   text default null,
  p_category text default null
)
returns table (
  id                uuid,
  scope             text,
  lecture_id        uuid,
  lecture_title     text,
  section_title     text,
  body              text,
  answer_body       text,
  answer_audio_path text,
  is_anonymous      boolean,
  audience          text,
  status            text,
  category          text,
  asker_display     text,
  asker_id          uuid,
  created_at        timestamptz,
  answered_at       timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_moderator() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    q.id, q.scope, q.lecture_id, l.title, s.title,
    q.body, q.answer_body, q.answer_audio_path,
    q.is_anonymous, q.audience, q.status, q.category,
    case
      when q.is_anonymous then 'سائل'
      else coalesce(p.display_name, 'طالب علم')
    end,
    case when public.is_admin() then q.asker_id else null end,
    q.created_at, q.answered_at
  from public.questions q
  left join public.lectures l on l.id = q.lecture_id
  left join public.sections s on s.id = l.section_id
  left join public.profiles p on p.id = q.asker_id
  where (p_scope is null or q.scope = p_scope)
    and (p_status is null or q.status = p_status)
    and (p_category is null or q.category = p_category)
  order by q.created_at desc
  limit 500;
end;
$$;
revoke execute on function public.get_question_inbox(text, text, text) from public, anon;
grant execute on function public.get_question_inbox(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- can_read_storage_object — extend the newest version (0064) with `answers/`.
-- Every existing branch (lectures/ attachments/ broadcasts/) is preserved.
--
-- A voice answer at `answers/…` is readable by:
--   * any moderator (sheikh/admin) — they author and moderate answers; OR
--   * the asker of the owning question — always, incl. private (sheikh) answers;
--   * additionally, if that question is public-audience + answered, ANY
--     authenticated caller may read it (matches get_public_questions exposure).
-- ---------------------------------------------------------------------------
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
        where b.image_path = p_key and b.deleted_at is null
      )
    when p_key like 'answers/%' then
      public.is_moderator()
      or exists (
        select 1 from public.questions q
        where q.answer_audio_path = p_key
          and (
            q.asker_id = auth.uid()
            or (q.audience = 'public' and q.status = 'answered')
          )
      )
    else false
  end;
$$;

grant execute on function public.can_read_storage_object(text) to authenticated;
