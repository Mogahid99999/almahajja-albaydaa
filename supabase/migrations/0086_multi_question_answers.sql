-- =============================================================================
-- 0086_multi_question_answers.sql
-- المَحجّة البَيْضَاء — تعدد الردود: a question may now carry MANY answers.
--
-- Until now a question held ONE answer (questions.answer_body / answer_audio_path,
-- 0028/0084/0085). A sheikh may want to add a follow-up, or a second sheikh may
-- add his own — so answers move to their own table, ordered chronologically.
--
--   * question_answers — (question_id, answered_by, body, audio_path, created_at).
--     ANY moderator may append (matches answer_question's is_moderator() gate).
--   * answer_question — now APPENDS a row instead of overwriting. It still sets
--     questions.status='answered' and MIRRORS the latest answer into
--     questions.answer_body / answer_audio_path so pre-multi-answer clients (and
--     the existing 0084 reads) keep showing the most recent answer. Audio-only
--     mirror still uses the 0085 sentinel for pre-voice clients.
--   * get_question_answers(question_id) — the ordered answer list (oldest→newest)
--     with each answerer's display name. Readable by the asker, or any auth user
--     for a public+answered question, or a moderator (mirrors the 0084 audio gate
--     and get_public_questions exposure).
--   * The asker notification still fires once — on the FIRST answer only.
--
-- can_read_storage_object already gates `answers/` keys by asker/public/moderator
-- (0084) and is unchanged: audio_path values live in both the mirror column and
-- question_answers, and the gate matches on questions.answer_audio_path OR — as
-- extended below — any question_answers row.
--
-- Append-only, idempotent. 0001–0085 never edited.
-- =============================================================================

create table if not exists public.question_answers (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  answered_by uuid references auth.users (id) on delete set null,
  body        text,
  audio_path  text,
  created_at  timestamptz not null default now(),
  check (coalesce(btrim(body), '') <> '' or coalesce(btrim(audio_path), '') <> '')
);
create index if not exists question_answers_question_idx
  on public.question_answers (question_id, created_at);

-- Reads/writes go through the DEFINER RPCs below; no direct table grants.
alter table public.question_answers enable row level security;

-- ---------------------------------------------------------------------------
-- answer_question — APPEND an answer (was: overwrite). Any moderator may add.
-- ---------------------------------------------------------------------------
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
  v_mirror     text;
  v_route      text;
  v_pref       boolean;
  v_was_first  boolean;
  c_sentinel   constant text := '🎧 إجابة صوتية — يرجى تحديث التطبيق للاستماع';
begin
  if not public.is_moderator() then
    raise exception 'غير مصرح';
  end if;
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

  v_was_first := (q.status = 'pending');

  insert into public.question_answers (question_id, answered_by, body, audio_path)
  values (p_question_id, auth.uid(), nullif(v_body, ''), v_audio);

  -- Mirror the LATEST answer into the questions row (backward-compat for the
  -- 0084 reads + pre-multi-answer clients). Audio-only → 0085 sentinel.
  v_mirror := case when length(v_body) >= 1 then v_body
                   when v_audio is not null  then c_sentinel
                   else null end;
  update public.questions
     set answer_body       = v_mirror,
         answer_audio_path = v_audio,
         status            = 'answered',
         answered_by       = auth.uid(),
         answered_at       = now()
   where id = q.id;

  -- Notify the asker on the FIRST answer only.
  if v_was_first then
    begin
      select enabled into v_pref from public.notification_prefs
       where user_id = q.asker_id and type = 'question_answered';
      if coalesce(v_pref, true) then
        v_route := case when q.scope = 'lecture'
                        then '/(student)/lecture-questions/' || q.lecture_id
                        else '/(student)/questions' end;
        insert into public.notifications (user_id, type, title, body, data)
        values (
          q.asker_id, 'question_answered', 'أُجيب عن سؤالك',
          left(q.body, 100), jsonb_build_object('route', v_route)
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
-- get_question_answers — the ordered answer list for one question.
-- Visibility mirrors get_public_questions + the 0084 audio gate:
--   * the asker always; OR a moderator; OR any auth user when the question is
--     public-audience AND answered.
-- ---------------------------------------------------------------------------
create or replace function public.get_question_answers(p_question_id uuid)
returns table (
  id              uuid,
  body            text,
  audio_path      text,
  answered_by     uuid,
  answerer_name   text,
  created_at      timestamptz
)
language sql stable security definer set search_path = public as $$
  select a.id, a.body, a.audio_path, a.answered_by,
         coalesce(p.display_name, 'الشيخ'), a.created_at
    from public.question_answers a
    join public.questions q on q.id = a.question_id
    left join public.profiles p on p.id = a.answered_by
   where a.question_id = p_question_id
     and (
       public.is_moderator()
       or q.asker_id = auth.uid()
       or (q.audience = 'public' and q.status = 'answered')
     )
   order by a.created_at asc;
$$;
grant execute on function public.get_question_answers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: migrate every EXISTING single answer into question_answers so the
-- new list shows historical answers too. Only where an answer exists and no
-- question_answers row is present yet (idempotent).
-- ---------------------------------------------------------------------------
insert into public.question_answers (question_id, answered_by, body, audio_path, created_at)
select q.id, q.answered_by,
       nullif(case when q.answer_body = '🎧 إجابة صوتية — يرجى تحديث التطبيق للاستماع'
                   then null else q.answer_body end, ''),
       q.answer_audio_path,
       coalesce(q.answered_at, now())
  from public.questions q
 where q.status = 'answered'
   and (coalesce(btrim(q.answer_body), '') <> '' or coalesce(btrim(q.answer_audio_path), '') <> '')
   and not exists (select 1 from public.question_answers a where a.question_id = q.id);

-- ---------------------------------------------------------------------------
-- can_read_storage_object — extend `answers/` to ALSO match question_answers
-- rows (a voice answer's key now lives there too). Every other branch preserved.
-- ---------------------------------------------------------------------------
create or replace function public.can_read_storage_object(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_key like 'lectures/%' then
      public.is_content_manager()
      or exists (select 1 from public.lectures l where l.audio_path = p_key and l.status = 'published')
    when p_key like 'attachments/%' then
      public.is_content_manager()
      or exists (
        select 1 from public.attachments a
        where a.storage_path = p_key
          and (a.section_id is not null
               or exists (select 1 from public.lectures l where l.id = a.lecture_id and l.status = 'published'))
      )
    when p_key like 'broadcasts/%' then
      exists (select 1 from public.broadcasts b where b.image_path = p_key and b.deleted_at is null)
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
