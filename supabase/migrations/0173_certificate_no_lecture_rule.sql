-- =============================================================================
-- 0173_certificate_no_lecture_rule.sql
-- المَحجّة البَيْضَاء — «بدون شرط للمحاضرات»: lecture_rule = 'none'.
--
-- 'none' is a rule of its own, not 0 %: lectures are not counted at all and the
-- certificate rests only on its required quizzes. Certificates using 'all' or
-- 'percent' keep their exact meaning.
--
-- Never issued to everyone. Three independent guards:
--   table constraint  enabled + no lecture rule + no quiz rule cannot be stored
--   save function     also needs at least one published selected quiz
--   eligibility       'none' needs at least one quiz really required of this
--                     student, so quizzes later drafted, deleted or hidden
--                     from them leave the certificate unearned
--
-- Issuing needs no change: the quiz-pass trigger and the catch-up in
-- get_my_certificates go through the same eligibility, and UNIQUE (section, user)
-- still means one certificate. A written quiz counts only once graded and passed.
--
-- Storage (db-storage-engineering): configuration values only, no new rows.
-- Rollback: first set rows with lecture_rule 'none' to 'all' (or disable them),
-- restore the three functions from 0168 / 0170, restore the original check,
-- drop section_certificate_settings_has_condition.
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

alter table public.section_certificate_settings
  drop constraint if exists section_certificate_settings_lecture_rule_check;
alter table public.section_certificate_settings
  add constraint section_certificate_settings_lecture_rule_check
  check (lecture_rule in ('none', 'all', 'percent'));

alter table public.section_certificate_settings
  drop constraint if exists section_certificate_settings_has_condition;
alter table public.section_certificate_settings
  add constraint section_certificate_settings_has_condition
  check (not (enabled and lecture_rule = 'none' and quiz_rule = 'none'));

comment on column public.section_certificate_settings.lecture_rule is
  '0173: none = lectures are not a condition (needs a required quiz) | all | percent (lecture_pct).';

create or replace function public.set_section_certificate_settings(
  p_section       uuid,
  p_enabled       boolean,
  p_content_scope text,
  p_lecture_rule  text,
  p_lecture_pct   int,
  p_quiz_rule     text,
  p_quiz_ids      uuid[] default '{}'
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_quiz_ids, '{}')) x
                             where x is not null), '{}');
  v_pct smallint;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sections where id = p_section) then
    raise exception 'القسم غير موجود' using errcode = 'P0002';
  end if;
  if p_content_scope is null or p_content_scope not in ('section', 'subtree') then
    raise exception 'اختر نطاق محتوى الشهادة';
  end if;
  if p_lecture_rule is null or p_lecture_rule not in ('none', 'all', 'percent') then
    raise exception 'اختر شرط إكمال المحاضرات';
  end if;
  if p_quiz_rule is null or p_quiz_rule not in ('none', 'selected') then
    raise exception 'اختر شرط الاختبارات';
  end if;

  if p_lecture_rule = 'percent' then
    if p_lecture_pct is null or p_lecture_pct < 1 or p_lecture_pct > 100 then
      raise exception 'نسبة المحاضرات المطلوبة يجب أن تكون بين ١ و١٠٠';
    end if;
    v_pct := p_lecture_pct;
  end if;  -- 'all' stores no percentage

  if p_quiz_rule = 'selected' then
    if cardinality(v_ids) = 0 then
      raise exception 'اختر اختبارًا واحدًا على الأقل';
    end if;
    if exists (
      select 1 from unnest(v_ids) x
       where not exists (
         select 1 from public.quizzes q
          where q.id = x and q.section_id in (select public.section_subtree_ids(p_section))
       )
    ) then
      raise exception 'الاختبار المختار ليس من اختبارات هذا القسم';
    end if;
  else
    v_ids := '{}';
  end if;

  -- A certificate that requires nothing would be issued to every student.
  if coalesce(p_enabled, false) and p_lecture_rule = 'none' then
    if p_quiz_rule <> 'selected' then
      raise exception 'الشهادة تحتاج شرطًا واحدًا على الأقل: حدّد شرطًا للمحاضرات أو اختبارًا مطلوبًا';
    end if;
    if not exists (select 1 from public.quizzes q where q.id = any (v_ids) and q.status = 'published') then
      raise exception 'اختر اختبارًا منشورًا واحدًا على الأقل، فالشهادة بلا شرط للمحاضرات تعتمد على الاختبارات';
    end if;
  end if;

  insert into public.section_certificate_settings as c
    (section_id, enabled, content_scope, lecture_rule, lecture_pct, quiz_rule, updated_at, updated_by)
  values (p_section, coalesce(p_enabled, false), p_content_scope, p_lecture_rule, v_pct, p_quiz_rule,
          now(), auth.uid())
  on conflict (section_id) do update
     set enabled      = excluded.enabled,
         content_scope = excluded.content_scope,
         lecture_rule = excluded.lecture_rule,
         lecture_pct  = excluded.lecture_pct,
         quiz_rule    = excluded.quiz_rule,
         updated_at   = excluded.updated_at,
         updated_by   = excluded.updated_by;

  delete from public.section_certificate_quizzes
   where section_id = p_section and not (quiz_id = any (v_ids));
  insert into public.section_certificate_quizzes (section_id, quiz_id)
  select p_section, x from unnest(v_ids) x
  on conflict do nothing;
end;
$$;
revoke all on function public.set_section_certificate_settings(uuid, boolean, text, text, int, text, uuid[]) from public, anon;
grant execute on function public.set_section_certificate_settings(uuid, boolean, text, text, int, text, uuid[]) to authenticated;

create or replace function public.certificate_eligibility_core(p_section uuid, v_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c           public.section_certificate_settings%rowtype;
  v_scope     text;
  v_gender    text;
  v_total     int;
  v_done      int;
  v_required  int;
  v_lect_met  boolean;
  v_items     jsonb;
  v_q_req     int;
  v_q_passed  int;
  v_quiz_met  boolean;
begin
  if not exists (select 1 from public.sections where id = p_section) then
    raise exception 'القسم غير موجود' using errcode = 'P0002';
  end if;

  select * into c from public.section_certificate_settings where section_id = p_section;
  select gender into v_gender from public.profiles where id = v_user;
  v_scope := coalesce(c.content_scope, 'section');

  -- 'none': lectures are not part of this certificate at all, so nothing is counted.
  if coalesce(c.lecture_rule, 'all') = 'none' then
    v_total := 0;
    v_done := 0;
    v_required := 0;
    v_lect_met := true;
  else
    -- Lectures: published, in the content scope (this section / its whole
    -- subtree), in sections this student may see.
    with sec as (
      select s.id
        from (select p_section as id where v_scope = 'section'
              union all
              select t.id from public.section_subtree_ids(p_section) as t(id) where v_scope = 'subtree') s
       where public.section_visible_to_viewer(s.id, v_gender)
    )
    select count(*)::int,
           count(*) filter (where p.completed)::int
      into v_total, v_done
      from public.lectures l
      left join public.user_lecture_progress p
        on p.lecture_id = l.id and p.user_id = v_user
     where l.status = 'published'
       and l.section_id in (select id from sec);

    v_required := case
      when coalesce(c.lecture_rule, 'all') = 'percent'
        then ceil(v_total * c.lecture_pct / 100.0)::int
      else v_total
    end;
    v_lect_met := v_total > 0 and v_done >= greatest(v_required, 1);
  end if;

  -- Quizzes: the admin's picks that are published and visible to this student.
  if coalesce(c.quiz_rule, 'none') = 'selected' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'quiz_id',         q.id,
             'title',           q.title,
             'passed',          x.passed,
             'pending_grading', x.pending and not x.passed
           ) order by q."order", q.title), '[]'::jsonb),
           count(*)::int,
           count(*) filter (where x.passed)::int
      into v_items, v_q_req, v_q_passed
      from public.section_certificate_quizzes r
      join public.quizzes q on q.id = r.quiz_id
      cross join lateral (
        select coalesce(bool_or(a.passed is true
                                and a.submitted_at is not null
                                and coalesce(a.grading_status, '') <> 'pending'), false) as passed,
               coalesce(bool_or(a.grading_status = 'pending'), false)                    as pending
          from public.quiz_attempts a
         where a.quiz_id = q.id and a.user_id = v_user
      ) x
     where r.section_id = p_section
       and q.status = 'published'
       and public.section_visible_to_viewer(q.section_id, v_gender);
    v_quiz_met := v_q_passed = v_q_req;
  else
    v_items := '[]'::jsonb;
    v_q_req := 0;
    v_q_passed := 0;
    v_quiz_met := true;
  end if;

  return jsonb_build_object(
    'section_id', p_section,
    'user_id',    v_user,
    'enabled',    coalesce(c.enabled, false),
    -- With no lecture condition at least one quiz must really be required of this student:
    -- all required quizzes back to draft, deleted or hidden must never mean «eligible».
    'eligible',   coalesce(c.enabled, false) and v_lect_met and v_quiz_met
                  and (coalesce(c.lecture_rule, 'all') <> 'none' or v_q_req > 0),
    'lectures', jsonb_build_object(
      'scope',     v_scope,
      'rule',      coalesce(c.lecture_rule, 'all'),
      'pct',       c.lecture_pct,
      'total',     v_total,
      'completed', v_done,
      'required',  v_required,
      'completed_pct', case when v_total > 0 then round(v_done * 100.0 / v_total, 2) else 0 end,
      'met',       v_lect_met),
    'quizzes', jsonb_build_object(
      'rule',           coalesce(c.quiz_rule, 'none'),
      'required_count', v_q_req,
      'passed_count',   v_q_passed,
      'met',            v_quiz_met,
      'items',          v_items)
  );
end;
$$;
revoke all on function public.certificate_eligibility_core(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_my_certificates()
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_gender text;
  r        record;
  e        jsonb;
  v_rows   jsonb := '[]'::jsonb;
  v_seen   uuid[] := '{}';
  v_issued public.certificates%rowtype;
begin
  if v_uid is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select gender into v_gender from public.profiles where id = v_uid;

  for r in
    select s.id, s.title, p.title as parent_title
      from public.section_certificate_settings c
      join public.sections s on s.id = c.section_id
      left join public.sections p on p.id = s.parent_id
     where c.enabled
       and public.section_visible_to_viewer(s.id, v_gender)
  loop
    e := public.certificate_eligibility_core(r.id, v_uid);
    -- Listed when it has a condition this student can work on.
    if (case when e -> 'lectures' ->> 'rule' = 'none'
            then coalesce((e -> 'quizzes' ->> 'required_count')::int, 0) > 0
            else coalesce((e -> 'lectures' ->> 'total')::int, 0) > 0 end) then
      if (e ->> 'eligible')::boolean then
        perform public.issue_certificate_if_eligible(r.id, v_uid);
      end if;
      select * into v_issued from public.certificates where section_id = r.id and user_id = v_uid;
      v_seen := v_seen || r.id;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'section_id',   r.id,
        'title',        r.title,
        'parent_title', r.parent_title,
        'ancestor_ids', (
          with recursive anc as (
            select s.parent_id as id, 1 as depth from public.sections s where s.id = r.id
            union all
            select s.parent_id, a.depth + 1
              from anc a join public.sections s on s.id = a.id
             where a.id is not null
          )
          select coalesce(jsonb_agg(a.id order by a.depth), '[]'::jsonb)
            from anc a where a.id is not null
        ),
        'eligibility',  e,
        'issued',       case when v_issued.id is null then null else public.certificate_issued_json(v_issued) end));
    end if;
  end loop;

  -- Issued certificates of sections no longer listed above.
  for v_issued in
    select * from public.certificates x
     where x.user_id = v_uid and x.status <> 'void'
       and (x.section_id is null or not (x.section_id = any (v_seen)))
  loop
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'section_id',   v_issued.section_id,
      'title',        v_issued.snapshot ->> 'title',
      'parent_title', null,
      'ancestor_ids', '[]'::jsonb,
      'eligibility',  jsonb_build_object('section_id', v_issued.section_id, 'user_id', v_uid,
                        'enabled', false, 'eligible', true,
                        'lectures', jsonb_build_object('total', 0, 'completed', 0, 'required', 0, 'met', true),
                        'quizzes', jsonb_build_object('rule', 'none', 'required_count', 0, 'passed_count', 0, 'met', true, 'items', '[]'::jsonb)),
      'issued',       public.certificate_issued_json(v_issued)));
  end loop;

  return coalesce((
    select jsonb_agg(x order by
             (coalesce(x -> 'issued', 'null'::jsonb) <> 'null'::jsonb) desc,
             (x -> 'eligibility' ->> 'eligible')::boolean desc,
             coalesce((x -> 'eligibility' -> 'lectures' ->> 'completed_pct')::numeric, 0) desc,
             x ->> 'title')
      from jsonb_array_elements(v_rows) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_my_certificates() from public, anon;
grant execute on function public.get_my_certificates() to authenticated;
