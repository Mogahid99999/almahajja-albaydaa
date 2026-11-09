-- =============================================================================
-- 0175_quiz_integrity_statement.sql
-- المَحجّة البَيْضَاء — إقرار النزاهة قبل اختبار مطلوب لشهادة.
--
-- The app shows the statement before a quiz listed in the requirements of an
-- enabled certificate and sends the version accepted; start_quiz_attempt stores
-- it with the time. Resuming an attempt that already exists needs nothing new.
--
-- Refusing a start with no version is behind a server switch, so builds that
-- cannot send it keep working:
--   app_config.quiz_integrity_enforced = 'true'   refuse (absent = off)
-- Turn it on only once a build that sends the version is available in the stores.
--
-- Storage (db-storage-engineering): one configuration row per statement version;
-- two small nullable columns on quiz_attempts (business facts, kept for good).
-- Rollback: restore start_quiz_attempt(uuid) from 0166, drop the new objects.
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

create table if not exists public.quiz_integrity_statements (
  version    smallint primary key,
  body       text not null,
  created_at timestamptz not null default now()
);
alter table public.quiz_integrity_statements enable row level security;
revoke all on table public.quiz_integrity_statements from public, anon, authenticated;

insert into public.quiz_integrity_statements (version, body) values (1,
  'أُقرّ بأنني سأؤدي هذا الاختبار بنفسي، دون الاستعانة بشخص آخر أو استخدام أي وسائل أو أدوات تساعدني في الوصول إلى الإجابات، وأتعهد بالالتزام بالأمانة والصدق أثناء أداء الاختبار.')
on conflict (version) do nothing;

alter table public.quiz_attempts
  add column if not exists integrity_version     smallint references public.quiz_integrity_statements (version),
  add column if not exists integrity_accepted_at timestamptz;

-- Required means selected by an enabled certificate, the same rows
-- certificate_eligibility reads. Being inside such a section is not enough.
create or replace function public.quiz_requires_integrity(p_quiz_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.section_certificate_quizzes r
      join public.section_certificate_settings c on c.section_id = r.section_id
     where r.quiz_id = p_quiz_id and c.enabled and c.quiz_rule = 'selected'
  );
$$;
revoke all on function public.quiz_requires_integrity(uuid) from public, anon, authenticated;

create or replace function public.get_quiz_integrity(p_quiz_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or not public.quiz_requires_integrity(p_quiz_id) then null
         else (select jsonb_build_object('version', s.version, 'body', s.body)
                 from public.quiz_integrity_statements s
                order by s.version desc limit 1) end;
$$;
revoke all on function public.get_quiz_integrity(uuid) from public, anon;
grant execute on function public.get_quiz_integrity(uuid) to authenticated;

drop function if exists public.start_quiz_attempt(uuid);
create or replace function public.start_quiz_attempt(
  p_quiz_id uuid,
  p_integrity_version integer default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me         uuid := auth.uid();
  v_quiz       public.quizzes%rowtype;
  v_existing   uuid;
  v_used       integer;
  v_attempt_no integer;
  v_id         uuid;
  v_avail      text;
  v_required   boolean;
  v_current    smallint;
  v_enforced   boolean;
  v_accepted   boolean := false;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'يلزم إنشاء حساب لأداء الاختبار';
  end if;

  select * into v_quiz from public.quizzes
   where id = p_quiz_id and status = 'published';
  if not found then
    raise exception 'الاختبار غير متاح';
  end if;

  select a.id into v_existing from public.quiz_attempts a
   where a.quiz_id = p_quiz_id and a.user_id = v_me and a.submitted_at is null
   order by a.started_at desc limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  -- 0166
  if exists (select 1 from public.quiz_attempts a
              where a.quiz_id = p_quiz_id and a.user_id = v_me
                and a.grading_status = 'pending') then
    raise exception 'محاولتك السابقة بانتظار التصحيح، وستظهر نتيجتها بعد اكتمال التصحيح بإذن الله';
  end if;

  v_avail := public.quiz_availability(
    v_quiz.availability_mode, v_quiz.available_from, v_quiz.available_until);
  if v_avail = 'closed' then
    raise exception 'هذا الاختبار غير متاح حاليًا';
  elsif v_avail = 'scheduled' then
    raise exception 'لم يبدأ هذا الاختبار بعد';
  elsif v_avail = 'expired' then
    raise exception 'انتهت مدة هذا الاختبار';
  end if;

  select count(*) filter (where submitted_at is not null),
         coalesce(max(attempt_no), 0) + 1
    into v_used, v_attempt_no
    from public.quiz_attempts
   where quiz_id = p_quiz_id and user_id = v_me;

  if v_quiz.max_attempts is not null and v_used >= v_quiz.max_attempts then
    raise exception 'استنفدت المحاولات المتاحة لهذا الاختبار';
  end if;

  -- 0175: a quiz required for a certificate records the statement accepted.
  v_required := public.quiz_requires_integrity(p_quiz_id);
  if v_required then
    select max(version) into v_current from public.quiz_integrity_statements;
    v_enforced := coalesce(
      (select value = 'true' from public.app_config where key = 'quiz_integrity_enforced'), false);
    if (p_integrity_version is null and v_enforced)
       or (p_integrity_version is not null and p_integrity_version <> v_current) then
      raise exception 'يلزم الموافقة على إقرار النزاهة قبل بدء هذا الاختبار';
    end if;
    v_accepted := p_integrity_version is not null;
  end if;

  insert into public.quiz_attempts (quiz_id, user_id, attempt_no, integrity_version, integrity_accepted_at)
  values (p_quiz_id, v_me, v_attempt_no,
          case when v_accepted then v_current end,
          case when v_accepted then now() end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.start_quiz_attempt(uuid, integer) from public, anon;
grant execute on function public.start_quiz_attempt(uuid, integer) to authenticated;
