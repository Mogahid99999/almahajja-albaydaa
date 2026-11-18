-- =============================================================================
-- 0174_quiz_offline_finalize.sql
-- المَحجّة البَيْضَاء — إكمال الاختبار دون اتصال.
--
-- The app keeps an attempt on the device and sends all its answers once, in one
-- transaction, when the attempt ends. save_quiz_answer refuses anything 30 s past
-- the deadline, which would throw away answers given in time while offline.
--
-- finalize_quiz_attempt is idempotent: the row lock serialises retries, and an
-- attempt already submitted returns its result without writing anything. Grading
-- stays in submit_quiz_attempt, so the score is computed once by the same code.
--
-- Trade-off: the server cannot tell when an offline answer was given, so answers
-- arriving after the deadline are accepted and the attempt is marked
-- synced_offline for review. client_finished_at is the device's claim, never used
-- for grading.
--
-- Storage (db-storage-engineering): two small columns on quiz_attempts (business
-- facts, kept for good); no new rows. Rollback: drop the function, then the columns.
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

alter table public.quiz_attempts
  add column if not exists synced_offline     boolean not null default false,
  add column if not exists client_finished_at timestamptz;

comment on column public.quiz_attempts.synced_offline is
  '0174: answers reached the server after the deadline + 30 s grace (taken offline).';
comment on column public.quiz_attempts.client_finished_at is
  '0174: when the device says the attempt ended. Unverified; for review only.';

create or replace function public.finalize_quiz_attempt(
  p_attempt_id         uuid,
  p_answers            jsonb,
  p_client_finished_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a       public.quiz_attempts%rowtype;
  z       public.quizzes%rowtype;
  v_item  jsonb;
  v_qid   uuid;
  v_oid   uuid;
  v_kind  text;
  v_text  text;
begin
  select * into a from public.quiz_attempts
   where id = p_attempt_id and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'المحاولة غير موجودة';
  end if;
  if a.submitted_at is not null then
    return public.quiz_result_payload(a.id);
  end if;
  if jsonb_typeof(coalesce(p_answers, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_answers, '[]'::jsonb)) > 1000 then
    raise exception 'إجابات غير صالحة';
  end if;
  select * into z from public.quizzes where id = a.quiz_id;

  -- A question removed since the attempt began is skipped: refusing it would
  -- leave this attempt unable to ever be delivered.
  for v_item in select value from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    begin
      v_qid := (v_item ->> 'questionId')::uuid;
      v_oid := (v_item ->> 'optionId')::uuid;
    exception when invalid_text_representation then
      continue;
    end;
    select q.kind into v_kind from public.quiz_questions q
     where q.id = v_qid and q.quiz_id = a.quiz_id;
    if not found then
      continue;
    end if;

    if v_kind = 'text' then
      v_text := left(nullif(btrim(coalesce(v_item ->> 'text', '')), ''), 8000);
      if v_text is null then
        delete from public.quiz_attempt_answers
         where attempt_id = a.id and question_id = v_qid;
      else
        insert into public.quiz_attempt_answers (attempt_id, question_id, option_id, text_answer)
        values (a.id, v_qid, null, v_text)
        on conflict (attempt_id, question_id) do update set text_answer = excluded.text_answer;
      end if;
    elsif v_oid is not null
      and exists (select 1 from public.quiz_options o
                   where o.id = v_oid and o.question_id = v_qid) then
      insert into public.quiz_attempt_answers (attempt_id, question_id, option_id)
      values (a.id, v_qid, v_oid)
      on conflict (attempt_id, question_id) do update set option_id = excluded.option_id;
    end if;
  end loop;

  update public.quiz_attempts
     set client_finished_at = p_client_finished_at,
         synced_offline = z.time_limit_sec is not null
           and now() > a.started_at + make_interval(secs => z.time_limit_sec + 30)
   where id = a.id;

  return public.submit_quiz_attempt(a.id);
end;
$$;
revoke all on function public.finalize_quiz_attempt(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.finalize_quiz_attempt(uuid, jsonb, timestamptz) to authenticated;
