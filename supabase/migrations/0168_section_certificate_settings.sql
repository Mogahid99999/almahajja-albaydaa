-- =============================================================================
-- 0168_section_certificate_settings.sql
-- المَحجّة البَيْضَاء — «شهادة إتمام القسم»: settings + eligibility ONLY.
--
-- Phase 1 of certificates: a section may grant a completion certificate, with
-- the conditions the admin sets in the section editor. Issuing / PDF / template /
-- number / QR / the student's certificates screen are NOT here (next phase).
--
-- Settings (one row per section that has ever been configured):
--   enabled       «يمنح هذا القسم شهادة إتمام»
--   lecture_rule  'all'      every lecture of the section must be completed
--                 'percent'  lecture_pct % of them (1–100)
--   quiz_rule     'none'     no quiz required
--                 'selected' every quiz in section_certificate_quizzes must be passed
-- Turning the certificate off keeps the conditions, so turning it on again
-- restores them.
--
-- "The section's lectures" = the published lectures of the section's WHOLE
-- subtree (the same set get_section_rollup counts), restricted to the sections
-- visible to that student's gender (section_visible_to_viewer, 0049) — a sister
-- is never required to finish a brothers-only sub-section she cannot open.
-- Completed = user_lecture_progress.completed, whatever its source (recording
-- or live attendance 0167); there is no per-source condition.
--
-- "The section's quizzes" = quizzes attached to any section of the subtree; the
-- admin picks the required ones. Passed = an attempt with passed = true, using
-- the quiz's own pass_score (no certificate-level score). An attempt whose
-- written answers still await a grader (grading_status 'pending', 0166) has
-- passed = NULL and does not count until the grading is approved. A required
-- quiz that is not published (back to draft) or not visible to that student is
-- not a requirement for them until it is; a deleted quiz drops out (FK cascade).
--
-- A section with no counted lecture never satisfies the lecture condition
-- (no certificate for an empty section).
--
-- Eligibility: certificate_eligibility(section, user) — the single definition
-- the future issuing step and the student's progress view will call. Returns a
-- jsonb breakdown (see the function). The caller may ask for him/herself; staff
-- (content managers) and the service role for anyone.
--
-- Storage (db-storage-engineering): configuration tables, one row per section
-- + one per required quiz — bytes, not KB. No retention (config); cascade with
-- the section / quiz.
--
-- Rollback: drop the 4 functions and the 2 tables (nothing else is touched).
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

-- 1. Tables ------------------------------------------------------------------------
create table if not exists public.section_certificate_settings (
  section_id   uuid primary key references public.sections (id) on delete cascade,
  enabled      boolean not null default false,
  lecture_rule text not null default 'all' check (lecture_rule in ('all', 'percent')),
  lecture_pct  smallint check (lecture_pct between 1 and 100),
  quiz_rule    text not null default 'none' check (quiz_rule in ('none', 'selected')),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,
  constraint section_certificate_settings_pct_rule
    check ((lecture_rule = 'percent') = (lecture_pct is not null))
);
comment on table public.section_certificate_settings is
  '0168: completion-certificate conditions of a section (lectures all / percent, required quizzes). Written only via set_section_certificate_settings; eligibility via certificate_eligibility.';

create table if not exists public.section_certificate_quizzes (
  section_id uuid not null references public.section_certificate_settings (section_id) on delete cascade,
  quiz_id    uuid not null references public.quizzes (id) on delete cascade,
  primary key (section_id, quiz_id)
);
comment on table public.section_certificate_quizzes is
  '0168: quizzes that must be passed for the section certificate (quiz_rule = selected).';
create index if not exists section_certificate_quizzes_quiz_idx
  on public.section_certificate_quizzes (quiz_id);
create index if not exists section_certificate_settings_updated_by_idx
  on public.section_certificate_settings (updated_by);

alter table public.section_certificate_settings enable row level security;
alter table public.section_certificate_quizzes enable row level security;
revoke all on table public.section_certificate_settings from public, anon, authenticated;
revoke all on table public.section_certificate_quizzes from public, anon, authenticated;
grant select, insert, update, delete on table public.section_certificate_settings to service_role;
grant select, insert, update, delete on table public.section_certificate_quizzes to service_role;
-- (no policies: all client access goes through the RPCs below)

-- 2. Subtree helper ----------------------------------------------------------------
create or replace function public.section_subtree_ids(p_section uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive t as (
    select id from public.sections where id = p_section
    union all
    select s.id from public.sections s join t on s.parent_id = t.id
  )
  select id from t;
$$;
revoke all on function public.section_subtree_ids(uuid) from public, anon, authenticated;
grant execute on function public.section_subtree_ids(uuid) to service_role;

-- 3. Admin: read the settings + the subtree's quizzes ---------------------------------
-- {section_id, enabled, lecture_rule, lecture_pct, quiz_rule, updated_at,
--  quizzes: [{id, title, section_id, section_title, status, selected}]}
-- A section never configured returns the defaults (enabled false, all, none).
create or replace function public.get_section_certificate_settings(p_section uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.section_certificate_settings%rowtype;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sections where id = p_section) then
    raise exception 'القسم غير موجود' using errcode = 'P0002';
  end if;
  select * into c from public.section_certificate_settings where section_id = p_section;

  return jsonb_build_object(
    'section_id',   p_section,
    'enabled',      coalesce(c.enabled, false),
    'lecture_rule', coalesce(c.lecture_rule, 'all'),
    'lecture_pct',  c.lecture_pct,
    'quiz_rule',    coalesce(c.quiz_rule, 'none'),
    'updated_at',   c.updated_at,
    'quizzes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',            q.id,
               'title',         q.title,
               'section_id',    q.section_id,
               'section_title', s.title,
               'status',        q.status,
               'selected',      exists (select 1 from public.section_certificate_quizzes r
                                         where r.section_id = p_section and r.quiz_id = q.id)
             ) order by (q.section_id = p_section) desc, s.title, q."order", q.title)
        from public.quizzes q
        join public.sections s on s.id = q.section_id
       where q.section_id in (select public.section_subtree_ids(p_section))
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_section_certificate_settings(uuid) from public, anon;
grant execute on function public.get_section_certificate_settings(uuid) to authenticated;

-- 4. Admin: save (atomic; replaces the required-quiz list) ----------------------------
create or replace function public.set_section_certificate_settings(
  p_section      uuid,
  p_enabled      boolean,
  p_lecture_rule text,
  p_lecture_pct  int,
  p_quiz_rule    text,
  p_quiz_ids     uuid[] default '{}'
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
  if p_lecture_rule is null or p_lecture_rule not in ('all', 'percent') then
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

  insert into public.section_certificate_settings as c
    (section_id, enabled, lecture_rule, lecture_pct, quiz_rule, updated_at, updated_by)
  values (p_section, coalesce(p_enabled, false), p_lecture_rule, v_pct, p_quiz_rule, now(), auth.uid())
  on conflict (section_id) do update
     set enabled      = excluded.enabled,
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
revoke all on function public.set_section_certificate_settings(uuid, boolean, text, int, text, uuid[]) from public, anon;
grant execute on function public.set_section_certificate_settings(uuid, boolean, text, int, text, uuid[]) to authenticated;

-- 5. Eligibility (the single definition) -------------------------------------------
-- p_user NULL = the caller. Returns
-- { section_id, user_id, enabled, eligible,
--   lectures: { rule, pct, total, completed, required, met },
--   quizzes:  { rule, required_count, passed_count, met,
--               items: [{ quiz_id, title, passed, pending_grading }] } }
-- eligible = enabled AND lectures.met AND quizzes.met. While enabled = false the
-- breakdown is still computed (eligible stays false) so staff can preview it.
create or replace function public.certificate_eligibility(p_section uuid, p_user uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user      uuid := coalesce(p_user, auth.uid());
  c           public.section_certificate_settings%rowtype;
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
  if v_user is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if v_user is distinct from auth.uid()
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sections where id = p_section) then
    raise exception 'القسم غير موجود' using errcode = 'P0002';
  end if;

  select * into c from public.section_certificate_settings where section_id = p_section;
  select gender into v_gender from public.profiles where id = v_user;

  -- Lectures: published, anywhere in the subtree, in sections this student may see.
  with sec as (
    select id from public.section_subtree_ids(p_section) id
     where public.section_visible_to_viewer(id, v_gender)
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
    'eligible',   coalesce(c.enabled, false) and v_lect_met and v_quiz_met,
    'lectures', jsonb_build_object(
      'rule',      coalesce(c.lecture_rule, 'all'),
      'pct',       c.lecture_pct,
      'total',     v_total,
      'completed', v_done,
      'required',  v_required,
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
revoke all on function public.certificate_eligibility(uuid, uuid) from public, anon;
grant execute on function public.certificate_eligibility(uuid, uuid) to authenticated, service_role;
