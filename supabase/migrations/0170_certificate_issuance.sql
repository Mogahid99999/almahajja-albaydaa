-- =============================================================================
-- 0170_certificate_issuance.sql
-- المَحجّة البَيْضَاء — real certificates: content details, one-time issuing with
-- an immutable snapshot, versioned server-side templates, render queue, verification.
--
-- Storage class (db-storage-engineering):
--   certificates           BUSINESS FACT. Never pruned. ~1.5 KB a row; the PDF and
--                          the preview image live in R2, this table holds keys.
--   certificate_templates  configuration. Immutable once published; a new design
--                          is a new version row, so old certificates keep theirs.
--
-- Issuing: issue_certificate_if_eligible(section, user) is the only writer. Called
-- from the lecture-completion and quiz-pass triggers, and from get_my_certificates
-- as the catch-up path (certificate enabled after the student had finished).
-- UNIQUE (section_id, user_id) + ON CONFLICT DO NOTHING = at most one certificate
-- and one notification, however many times it runs.
--
-- Rendering lives on the server (vps/certs): the worker claims rows without a PDF,
-- renders the row's own template_version and stores the files in R2.
-- The app and the public never touch these tables: every read is an RPC.
-- verify_certificate is service_role only, so the public page (rate-limited, in
-- vps/certs) is the single public door and PostgREST cannot be used to probe ids.
--
-- Deploy order: this migration → scripts/certs/publish-template.mjs (without an
-- active template nothing is issued) → certificate-files function → worker.
-- Rollback: drop the triggers, the functions, certificates, certificate_templates,
-- the settings columns; restore 0168/0169 bodies. Dropping certificates destroys
-- issued records: export it first.
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

alter type public.notification_type add value if not exists 'certificate_issued';

-- prune_notifications (0166 body): the certificate notice is kept like the others.
create or replace function public.prune_notifications()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_notifs int;
  v_outbox int;
  v_cron   int := 0;
begin
  delete from public.notifications
   where type::text not in ('question_answered', 'question_received', 'buddy_request',
                            'buddy_activity', 'feedback_received', 'content_reported', 'live_invite',
                            'quiz_graded', 'certificate_issued')
     and created_at < now() - interval '3 days';
  get diagnostics v_notifs = row_count;

  delete from public.push_outbox where created_at < now() - interval '3 days';
  get diagnostics v_outbox = row_count;

  begin
    delete from cron.job_run_details where end_time < now() - interval '2 days';
    get diagnostics v_cron = row_count;
  exception when others then
    v_cron := -1;
  end;

  return jsonb_build_object('notifications', v_notifs, 'push_outbox', v_outbox, 'cron_log', v_cron);
end;
$$;
revoke all on function public.prune_notifications() from public, anon, authenticated;

-- 1. What the certificate prints, set once per section ------------------------------
alter table public.section_certificate_settings
  add column if not exists certificate_title  text,   -- blank = the section's title
  add column if not exists author             text,   -- optional: no author, no line
  add column if not exists presenter_name     text,
  add column if not exists presentation_form  text not null default 'بشرح',  -- بشرح / تقديم / …
  add column if not exists custom_text        text;   -- replaces the default closing text

-- 2. Templates ----------------------------------------------------------------------
create table if not exists public.certificate_templates (
  version      integer primary key check (version > 0),
  html         text not null,
  notes        text,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now()
);
comment on table public.certificate_templates is
  '0170: versioned server-side certificate templates (Mustache HTML). html is immutable; a new design is a new version, activated for NEW certificates only.';
create unique index if not exists certificate_templates_one_active
  on public.certificate_templates (is_active) where is_active;
alter table public.certificate_templates enable row level security;
revoke all on table public.certificate_templates from public, anon, authenticated;
grant select, insert, update on table public.certificate_templates to service_role;

create or replace function public.certificate_templates_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.html is distinct from old.html or new.version is distinct from old.version then
    raise exception 'قالب الشهادة لا يُعدَّل بعد نشره؛ أنشئ إصدارًا جديدًا';
  end if;
  return new;
end;
$$;
drop trigger if exists certificate_templates_immutable on public.certificate_templates;
create trigger certificate_templates_immutable
  before update on public.certificate_templates
  for each row execute function public.certificate_templates_immutable();

-- 3. Certificates --------------------------------------------------------------------
create table if not exists public.certificates (
  id               text primary key check (id ~ '^MAH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  user_id          uuid references auth.users (id) on delete set null,
  section_id       uuid references public.sections (id) on delete set null,
  template_version integer not null references public.certificate_templates (version),
  status           text not null default 'valid' check (status in ('valid', 'revoked', 'void')),
  issued_at        timestamptz not null default now(),
  snapshot         jsonb not null,
  issue_date_text  text,
  pdf_key          text,
  preview_key      text,
  rendered_at      timestamptz,
  render_claimed_at timestamptz,
  render_attempts  smallint not null default 0,
  render_error     text,
  constraint certificates_one_per_student unique (section_id, user_id)
);
comment on table public.certificates is
  '0170: issued certificates. Business record, never pruned. snapshot and identity are immutable (trigger). status: valid | revoked (by staff) | void (account deleted; the name is erased).';
create index if not exists certificates_user_idx on public.certificates (user_id);
create index if not exists certificates_template_idx on public.certificates (template_version);
create index if not exists certificates_render_queue_idx
  on public.certificates (issued_at) where pdf_key is null and status = 'valid' and render_attempts < 5;
create index if not exists certificates_void_files_idx
  on public.certificates (id) where status = 'void' and pdf_key is not null;
alter table public.certificates enable row level security;
revoke all on table public.certificates from public, anon, authenticated;
grant select, insert, update, delete on table public.certificates to service_role;
-- (no policies: all access goes through the RPCs below)

create or replace function public.certificates_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.user_id is not null and new.user_id is null then
    -- The account was deleted: its name must not stay publicly verifiable.
    new.status := 'void';
    new.snapshot := old.snapshot - 'student_name' - 'gender';
    return new;
  end if;
  if new.id is distinct from old.id
     or new.issued_at is distinct from old.issued_at
     or new.template_version is distinct from old.template_version
     or new.snapshot is distinct from old.snapshot
     or new.user_id is distinct from old.user_id
     or (new.section_id is distinct from old.section_id and new.section_id is not null) then
    raise exception 'بيانات الشهادة الصادرة لا تتغير';
  end if;
  if old.issue_date_text is not null and new.issue_date_text is distinct from old.issue_date_text then
    raise exception 'بيانات الشهادة الصادرة لا تتغير';
  end if;
  return new;
end;
$$;
drop trigger if exists certificates_guard on public.certificates;
create trigger certificates_guard
  before update on public.certificates
  for each row execute function public.certificates_guard();

-- 4. Eligibility: same rules as 0168, the caller check moves to a thin wrapper so a
--    grader's approval or a live completion can issue another student's certificate.
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

create or replace function public.certificate_eligibility(p_section uuid, p_user uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
begin
  if v_user is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if v_user is distinct from auth.uid()
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  return public.certificate_eligibility_core(p_section, v_user);
end;
$$;
revoke all on function public.certificate_eligibility(uuid, uuid) from public, anon;
grant execute on function public.certificate_eligibility(uuid, uuid) to authenticated, service_role;

-- 5. Admin settings: read + write the printed details -------------------------------
create or replace function public.get_section_certificate_details(p_section uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.section_certificate_settings%rowtype;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select * into c from public.section_certificate_settings where section_id = p_section;
  return jsonb_build_object(
    'certificate_title', c.certificate_title,
    'author',            c.author,
    'presenter_name',    c.presenter_name,
    'presentation_form', coalesce(c.presentation_form, 'بشرح'),
    'custom_text',       c.custom_text);
end;
$$;
revoke all on function public.get_section_certificate_details(uuid) from public, anon;
grant execute on function public.get_section_certificate_details(uuid) to authenticated;

create or replace function public.set_section_certificate_details(
  p_section uuid,
  p_certificate_title text,
  p_author text,
  p_presenter_name text,
  p_presentation_form text,
  p_custom_text text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_title text := nullif(btrim(coalesce(p_certificate_title, '')), '');
  v_author text := nullif(btrim(coalesce(p_author, '')), '');
  v_presenter text := nullif(btrim(coalesce(p_presenter_name, '')), '');
  v_form text := coalesce(nullif(btrim(coalesce(p_presentation_form, '')), ''), 'بشرح');
  v_custom text := nullif(btrim(coalesce(p_custom_text, '')), '');
  v_enabled boolean;
begin
  if not public.is_content_manager() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select enabled into v_enabled from public.section_certificate_settings where section_id = p_section;
  if not found then
    raise exception 'احفظ إعدادات الشهادة أولًا';
  end if;
  if v_enabled and v_presenter is null then
    raise exception 'اكتب اسم مقدم المادة كما يظهر على الشهادة';
  end if;
  if char_length(coalesce(v_title, '')) > 150 or char_length(coalesce(v_author, '')) > 120
     or char_length(coalesce(v_presenter, '')) > 120 or char_length(v_form) > 30
     or char_length(coalesce(v_custom, '')) > 300 then
    raise exception 'النص أطول من المسموح به في الشهادة';
  end if;
  update public.section_certificate_settings
     set certificate_title = v_title, author = v_author, presenter_name = v_presenter,
         presentation_form = v_form, custom_text = v_custom,
         updated_at = now(), updated_by = auth.uid()
   where section_id = p_section;
end;
$$;
revoke all on function public.set_section_certificate_details(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.set_section_certificate_details(uuid, text, text, text, text, text) to authenticated;

-- 6. Issuing -----------------------------------------------------------------------
-- 60 random bits, Crockford base32 (no I L O U). 256 is a multiple of 32: no modulo bias.
create or replace function public.new_certificate_id()
returns text
language plpgsql volatile set search_path = public as $$
declare
  v_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_s text := '';
begin
  for i in 0..11 loop
    v_s := v_s || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return 'MAH-' || substr(v_s, 1, 4) || '-' || substr(v_s, 5, 4) || '-' || substr(v_s, 9, 4);
end;
$$;
revoke all on function public.new_certificate_id() from public, anon, authenticated;

-- «الإمام …» → «للإمام …», «ابن تيمية» → «لابن تيمية»; already prefixed stays.
create or replace function public.certificate_author_line(p_author text)
returns text
language sql immutable set search_path = public as $$
  select case
    when p_author is null then null
    when p_author ~ '^لل' then p_author
    when p_author ~ '^ال' then 'لل' || substr(p_author, 3)
    else 'ل' || p_author
  end;
$$;
revoke all on function public.certificate_author_line(text) from public, anon, authenticated;

-- Returns the certificate id, or null when the student is not (yet) entitled.
create or replace function public.issue_certificate_if_eligible(p_section uuid, p_user uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id       text;
  v_template integer;
  v_name     text;
  v_gender   text;
  v_title    text;
  v_section  text;
  c          public.section_certificate_settings%rowtype;
  e          jsonb;
  v_base     text;
  v_pref     boolean;
  v_author   text;
  v_form     text;
  v_presenter text;
begin
  select id into v_id from public.certificates where section_id = p_section and user_id = p_user;
  if found then return v_id; end if;

  if coalesce((select u.is_anonymous from auth.users u where u.id = p_user), true) then
    return null;
  end if;
  select * into c from public.section_certificate_settings where section_id = p_section and enabled;
  if not found then return null; end if;

  e := public.certificate_eligibility_core(p_section, p_user);
  if not coalesce((e ->> 'eligible')::boolean, false) then return null; end if;

  select version into v_template from public.certificate_templates where is_active;
  if v_template is null then return null; end if;
  select nullif(btrim(display_name), ''), gender into v_name, v_gender from public.profiles where id = p_user;
  if v_name is null then return null; end if;   -- the certificate needs a name
  select title into v_section from public.sections where id = p_section;

  v_title := coalesce(c.certificate_title, v_section);
  v_author := nullif(btrim(coalesce(c.author, '')), '');
  v_form := coalesce(c.presentation_form, 'بشرح');
  v_presenter := nullif(btrim(coalesce(c.presenter_name, '')), '');
  v_base := coalesce((select value from public.app_config where key = 'certificate_verify_base'),
                     'https://almahajja.app/c/');
  v_id := public.new_certificate_id();

  insert into public.certificates as x (id, user_id, section_id, template_version, snapshot)
  values (v_id, p_user, p_section, v_template, jsonb_build_object(
    'student_name',      v_name,
    'gender',            v_gender,
    'title',             v_title,
    'section_title',     v_section,
    'author',            v_author,
    'author_line',       public.certificate_author_line(v_author),
    'presentation_form', v_form,
    'presenter_name',    v_presenter,
    'presenter_line',    case when v_presenter is null then null else v_form || ' ' || v_presenter end,
    'custom_text',       c.custom_text,
    'verification_url',  v_base || v_id,
    'requirements',      jsonb_build_object(
                           'scope', e -> 'lectures' -> 'scope',
                           'lectures_required', e -> 'lectures' -> 'required',
                           'quizzes_required', e -> 'quizzes' -> 'required_count')
  ))
  on conflict on constraint certificates_one_per_student do nothing
  returning id into v_id;

  if v_id is null then  -- a concurrent run issued it first; it also sent the notice
    select id into v_id from public.certificates where section_id = p_section and user_id = p_user;
    return v_id;
  end if;

  -- Only the run that really inserted reaches here: one notice, ever. The push goes
  -- through the existing notifications trigger.
  begin
    select enabled into v_pref from public.notification_prefs
     where user_id = p_user and type = 'certificate_issued';
    if coalesce(v_pref, true) then
      insert into public.notifications (user_id, type, title, body, data)
      values (p_user, 'certificate_issued', 'مبارك لك 🎉 تم إصدار شهادة إتمامك',
              'صدرت شهادة إتمام «' || v_title || '»، نفع الله بك.',
              jsonb_build_object('route', '/certificate/' || v_id, 'certificateId', v_id));
    end if;
  exception when others then
    null;   -- a notification problem never undoes the certificate
  end;
  return v_id;
end;
$$;
revoke all on function public.issue_certificate_if_eligible(uuid, uuid) from public, anon, authenticated;

-- 7. Triggers: only the transition into "done" does any work, and a failure here
--    must never undo the student's progress or a grading.
create or replace function public.certificates_on_lecture_completed()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_section uuid;
  r record;
begin
  if not new.completed or (tg_op = 'UPDATE' and old.completed) then return new; end if;
  begin
    select section_id into v_section from public.lectures where id = new.lecture_id;
    for r in
      with recursive anc as (
        select v_section as id, 0 as depth
        union all
        select s.parent_id, a.depth + 1 from anc a join public.sections s on s.id = a.id
         where s.parent_id is not null
      )
      select c.section_id
        from public.section_certificate_settings c
        join anc on anc.id = c.section_id
       where c.enabled and (c.content_scope = 'subtree' or anc.depth = 0)
    loop
      perform public.issue_certificate_if_eligible(r.section_id, new.user_id);
    end loop;
  exception when others then
    raise warning 'certificate issue failed (lecture %, user %): %', new.lecture_id, new.user_id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.certificates_on_lecture_completed() from public, anon, authenticated;
drop trigger if exists certificates_on_lecture_completed on public.user_lecture_progress;
create trigger certificates_on_lecture_completed
  after insert or update of completed on public.user_lecture_progress
  for each row execute function public.certificates_on_lecture_completed();

create or replace function public.certificates_on_quiz_passed()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  -- The same "passed" as certificate_eligibility (0168).
  if not (new.passed is true and new.submitted_at is not null and coalesce(new.grading_status, '') <> 'pending') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.passed is true and old.submitted_at is not null
     and coalesce(old.grading_status, '') <> 'pending' then
    return new;
  end if;
  begin
    for r in
      select q.section_id
        from public.section_certificate_quizzes q
        join public.section_certificate_settings c on c.section_id = q.section_id
       where q.quiz_id = new.quiz_id and c.enabled
    loop
      perform public.issue_certificate_if_eligible(r.section_id, new.user_id);
    end loop;
  exception when others then
    raise warning 'certificate issue failed (attempt %): %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public.certificates_on_quiz_passed() from public, anon, authenticated;
drop trigger if exists certificates_on_quiz_passed on public.quiz_attempts;
create trigger certificates_on_quiz_passed
  after insert or update on public.quiz_attempts
  for each row execute function public.certificates_on_quiz_passed();

-- The issued-certificate shape the app reads. No file keys here.
create or replace function public.certificate_issued_json(x public.certificates)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id',              x.id,
    'status',          x.status,
    'section_id',      x.section_id,
    'title',           x.snapshot ->> 'title',
    'author_line',     x.snapshot ->> 'author_line',
    'presenter_line',  x.snapshot ->> 'presenter_line',
    'student_name',    x.snapshot ->> 'student_name',
    'issued_at',       x.issued_at,
    'issue_date_text', x.issue_date_text,
    'ready',           x.pdf_key is not null);
$$;
revoke all on function public.certificate_issued_json(public.certificates) from public, anon, authenticated;

-- 8. The student --------------------------------------------------------------------
-- Volatile from 0170: an eligible student with no certificate yet is issued one here.
-- Rows also include certificates already issued, even if the section has since been
-- disabled, hidden, changed or deleted: an issued certificate stays the student's.
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
    if coalesce((e -> 'lectures' ->> 'total')::int, 0) > 0 then
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

create or replace function public.get_my_certificate(p_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  x public.certificates%rowtype;
begin
  if auth.uid() is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select * into x from public.certificates where id = upper(btrim(p_id)) and user_id = auth.uid();
  if not found then return null; end if;
  return public.certificate_issued_json(x);
end;
$$;
revoke all on function public.get_my_certificate(text) from public, anon;
grant execute on function public.get_my_certificate(text) to authenticated;

-- 9. Service side (worker + Edge Function only) --------------------------------------
create or replace function public.verify_certificate(p_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  x public.certificates%rowtype;
begin
  select * into x from public.certificates where id = upper(btrim(p_id));
  if not found or x.status = 'void' then return null; end if;
  if x.status <> 'valid' then
    return jsonb_build_object('status', x.status);   -- nothing else about a revoked one
  end if;
  return jsonb_build_object(
    'status',          x.status,
    'id',              x.id,
    'student_name',    x.snapshot ->> 'student_name',
    'gender',          x.snapshot ->> 'gender',
    'title',           x.snapshot ->> 'title',
    'author',          x.snapshot ->> 'author',
    'presenter_line',  x.snapshot ->> 'presenter_line',
    'issued_at',       x.issued_at,
    'issue_date_text', x.issue_date_text);
end;
$$;
revoke all on function public.verify_certificate(text) from public, anon, authenticated;
grant execute on function public.verify_certificate(text) to service_role;

create or replace function public.claim_certificate_renders(p_limit int default 3)
returns table (id text, template_version int, snapshot jsonb, issued_at timestamptz)
language sql volatile security definer set search_path = public as $$
  update public.certificates c
     set render_claimed_at = now(), render_attempts = c.render_attempts + 1
   where c.id in (
     select x.id from public.certificates x
      where x.pdf_key is null and x.status = 'valid' and x.render_attempts < 5
        and (x.render_claimed_at is null or x.render_claimed_at < now() - interval '3 minutes')
      order by x.issued_at
      limit greatest(p_limit, 1)
      for update skip locked)
  returning c.id, c.template_version, c.snapshot, c.issued_at;
$$;
revoke all on function public.claim_certificate_renders(int) from public, anon, authenticated;
grant execute on function public.claim_certificate_renders(int) to service_role;

create or replace function public.complete_certificate_render(p_id text, p_pdf_key text, p_preview_key text, p_issue_date_text text)
returns void
language sql volatile security definer set search_path = public as $$
  update public.certificates
     set pdf_key = p_pdf_key, preview_key = p_preview_key, rendered_at = now(), render_error = null,
         issue_date_text = coalesce(issue_date_text, p_issue_date_text)
   where id = p_id;
$$;
revoke all on function public.complete_certificate_render(text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_certificate_render(text, text, text, text) to service_role;

create or replace function public.fail_certificate_render(p_id text, p_error text)
returns void
language sql volatile security definer set search_path = public as $$
  update public.certificates set render_error = left(p_error, 500) where id = p_id;
$$;
revoke all on function public.fail_certificate_render(text, text) from public, anon, authenticated;
grant execute on function public.fail_certificate_render(text, text) to service_role;

create or replace function public.get_certificate_template(p_version int)
returns text
language sql stable security definer set search_path = public as $$
  select html from public.certificate_templates where version = p_version;
$$;
revoke all on function public.get_certificate_template(int) from public, anon, authenticated;
grant execute on function public.get_certificate_template(int) to service_role;

-- Files of voided certificates (deleted accounts), for the worker to remove.
create or replace function public.take_void_certificate_files(p_limit int default 20)
returns table (pdf_key text, preview_key text)
language sql volatile security definer set search_path = public as $$
  with v as (
    select x.id, x.pdf_key, x.preview_key from public.certificates x
     where x.status = 'void' and x.pdf_key is not null limit greatest(p_limit, 1) for update skip locked
  ), u as (
    update public.certificates c set pdf_key = null, preview_key = null from v where c.id = v.id
  )
  select v.pdf_key, v.preview_key from v;
$$;
revoke all on function public.take_void_certificate_files(int) from public, anon, authenticated;
grant execute on function public.take_void_certificate_files(int) to service_role;

-- The owner, or content staff. Keys never reach a client: only the Edge Function asks.
create or replace function public.certificate_files_for(p_id text, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when x.status = 'valid' and x.pdf_key is not null
                and (x.user_id = p_user
                     or exists (select 1 from public.profiles p where p.id = p_user and p.role in ('admin', 'publisher')))
              then jsonb_build_object('pdf_key', x.pdf_key, 'preview_key', x.preview_key)
         end
    from public.certificates x where x.id = upper(btrim(p_id));
$$;
revoke all on function public.certificate_files_for(text, uuid) from public, anon, authenticated;
grant execute on function public.certificate_files_for(text, uuid) to service_role;
