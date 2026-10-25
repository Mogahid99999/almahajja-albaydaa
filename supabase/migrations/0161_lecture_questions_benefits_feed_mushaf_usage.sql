-- =============================================================================
-- 0161_lecture_questions_benefits_feed_mushaf_usage.sql
-- المَحجّة البَيْضَاء — «الأبواب الثلاثة»: الأسئلة / الفوائد / المصحف.
--
-- 1. أسئلة المحاضرات — one cross-lecture feed of answered PUBLIC lecture
--    questions, each carrying its source lecture (+ section crumb) so the
--    client can link back to the lesson. Display-only: asking still happens
--    inside the lesson (ask_question, unchanged). Anonymity is the same as
--    get_public_questions (0084): an anonymous asker is never named.
--    Gender/visibility scoping mirrors search_content (0068/0089).
--    + get_my_lecture_questions: the caller's own lecture questions with
--    their lecture/section titles («أسئلتي» in that tab).
--
-- 2. فوائد الدارسين — one unified feed, newest first, lecture-linked AND
--    general («فائدة عامة», lecture_id NULL). Additive only:
--      * lecture_benefits.lecture_id DROP NOT NULL (no row changes),
--      * add_general_benefit (same gates as add_lecture_benefit 0053:
--        registered account, 3–1000 chars, blocked-word check),
--      * get_benefits_feed (never selects user_id; is_mine only),
--      * admin_list_benefits: JOIN → LEFT JOIN so general benefits reach
--        moderation (0081 body otherwise verbatim),
--      * index (status, created_at desc) for the feed.
--    Report / delete-own / admin hide+delete+ban paths are unchanged: they
--    key on lecture_benefits.id and never required a lecture.
--
-- 3. استخدام المصحف — aggregate unique users only. One row per user
--    (guests = anonymous auth users, counted the same way). The client
--    touches at most once per local day; the server also writes at most
--    once per UTC+3 day. No pages, suras or durations are stored.
--    Retention: one row per account for its lifetime; cascades on account
--    deletion. Size: ~70 B/row → ~1 MB per 10k users.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lecture questions feed
-- ---------------------------------------------------------------------------
create index if not exists questions_public_answered_idx
  on public.questions (scope, answered_at desc)
  where status = 'answered' and audience = 'public';

create or replace function public.get_lecture_questions_feed()
returns table (
  id                uuid,
  body              text,
  answer_body       text,
  answer_audio_path text,
  asker_display     text,
  is_mine           boolean,
  category          text,
  created_at        timestamptz,
  answered_at       timestamptz,
  lecture_id        uuid,
  lecture_title     text,
  section_id        uuid,
  section_title     text,
  parent_title      text
)
language sql stable security definer set search_path = public as $$
  with my_gender as (
    select gender from public.profiles where id = auth.uid()
  )
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
    q.answered_at,
    l.id,
    l.title,
    s.id,
    s.title,
    ps.title
  from public.questions q
  join public.lectures l on l.id = q.lecture_id
  left join public.sections s on s.id = l.section_id
  left join public.sections ps on ps.id = s.parent_id
  left join public.profiles p on p.id = q.asker_id
  where q.scope = 'lecture'
    and q.status = 'answered'
    and q.audience = 'public'
    and l.status = 'published'
    and public.section_visible_to_viewer(l.section_id, (select gender from my_gender))
  order by q.answered_at desc
  limit 200;
$$;
revoke all on function public.get_lecture_questions_feed() from public, anon;
grant execute on function public.get_lecture_questions_feed() to authenticated;

create or replace function public.get_my_lecture_questions()
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
  answered_at       timestamptz,
  lecture_id        uuid,
  lecture_title     text,
  section_id        uuid,
  section_title     text,
  parent_title      text
)
language sql stable security definer set search_path = public as $$
  select
    q.id, q.body, q.answer_body, q.answer_audio_path,
    q.is_anonymous, q.audience, q.status, q.category,
    q.created_at, q.answered_at,
    l.id, l.title, s.id, s.title, ps.title
  from public.questions q
  left join public.lectures l on l.id = q.lecture_id
  left join public.sections s on s.id = l.section_id
  left join public.sections ps on ps.id = s.parent_id
  where q.asker_id = auth.uid()
    and q.scope = 'lecture'
  order by q.created_at desc
  limit 200;
$$;
revoke all on function public.get_my_lecture_questions() from public, anon;
grant execute on function public.get_my_lecture_questions() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Unified benefits
-- ---------------------------------------------------------------------------
alter table public.lecture_benefits alter column lecture_id drop not null;

create index if not exists lecture_benefits_feed_idx
  on public.lecture_benefits (status, created_at desc);

create or replace function public.add_general_benefit(p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'يلزم إنشاء حساب لمشاركة فائدة';
  end if;
  if length(v_body) < 3 or length(v_body) > 1000 then
    raise exception 'نص الفائدة يجب أن يكون بين ٣ و ١٠٠٠ حرف';
  end if;
  if public.contains_blocked_word(v_body) then
    raise exception 'blocked_word' using errcode = 'BLOCK';
  end if;

  insert into public.lecture_benefits (lecture_id, user_id, body)
  values (null, v_me, v_body)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_general_benefit(text) from public, anon;
grant execute on function public.add_general_benefit(text) to authenticated;

-- p_kind: 'all' | 'lecture' | 'general' | 'mine'. Keyset paging on created_at.
create or replace function public.get_benefits_feed(
  p_kind   text default 'all',
  p_before timestamptz default null,
  p_limit  int default 50
)
returns table (
  id            uuid,
  body          text,
  is_mine       boolean,
  created_at    timestamptz,
  lecture_id    uuid,
  lecture_title text,
  section_title text,
  parent_title  text
)
language sql stable security definer set search_path = public as $$
  with my_gender as (
    select gender from public.profiles where id = auth.uid()
  )
  select
    b.id, b.body, b.user_id = auth.uid(), b.created_at,
    l.id, l.title, s.title, ps.title
  from public.lecture_benefits b
  left join public.lectures l on l.id = b.lecture_id
  left join public.sections s on s.id = l.section_id
  left join public.sections ps on ps.id = s.parent_id
  where b.status = 'visible'
    and (p_before is null or b.created_at < p_before)
    and (
      b.lecture_id is null
      or (l.status = 'published'
          and public.section_visible_to_viewer(l.section_id, (select gender from my_gender)))
    )
    and case coalesce(p_kind, 'all')
          when 'lecture' then b.lecture_id is not null
          when 'general' then b.lecture_id is null
          when 'mine'    then b.user_id = auth.uid()
          else true
        end
  order by b.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
revoke all on function public.get_benefits_feed(text, timestamptz, int) from public, anon;
grant execute on function public.get_benefits_feed(text, timestamptz, int) to authenticated;

-- admin_list_benefits — 0081 body verbatim except JOIN lectures → LEFT JOIN.
create or replace function public.admin_list_benefits(p_lecture_id uuid default null)
returns table (
  id            uuid,
  lecture_id    uuid,
  lecture_title text,
  section_title text,
  body          text,
  status        text,
  author_id     uuid,
  author_name   text,
  author_email  text,
  created_at    timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff_viewer() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    b.id, b.lecture_id, l.title, s.title, b.body, b.status,
    b.user_id,
    coalesce(p.display_name, 'طالب علم'),
    -- Identity (email) is an admin-only surface — a sheikh sees the name only.
    case when public.is_admin() then u.email::text else null end,
    b.created_at
  from public.lecture_benefits b
  left join public.lectures l on l.id = b.lecture_id
  left join public.sections s on s.id = l.section_id
  left join public.profiles p on p.id = b.user_id
  left join auth.users u on u.id = b.user_id
  where (p_lecture_id is null or b.lecture_id = p_lecture_id)
  order by b.created_at desc
  limit 500;
end;
$$;
revoke execute on function public.admin_list_benefits(uuid) from public, anon;
grant execute on function public.admin_list_benefits(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mushaf usage (aggregate unique users)
-- ---------------------------------------------------------------------------
create table if not exists public.mushaf_usage (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  first_opened_at timestamptz not null default now(),
  last_opened_at  timestamptz not null default now()
);
create index if not exists mushaf_usage_last_opened_idx
  on public.mushaf_usage (last_opened_at);

-- No direct access at all: rows are written/read only by the DEFINER RPCs below.
alter table public.mushaf_usage enable row level security;
revoke all on public.mushaf_usage from public, anon, authenticated;

create or replace function public.touch_mushaf_open()
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;
  insert into public.mushaf_usage as m (user_id)
  values (v_uid)
  on conflict (user_id) do update
     set last_opened_at = now()
   where (m.last_opened_at at time zone 'Asia/Riyadh')::date
         <> (now() at time zone 'Asia/Riyadh')::date;
end;
$$;
revoke all on function public.touch_mushaf_open() from public, anon;
grant execute on function public.touch_mushaf_open() to authenticated;

-- Unique users whose LAST open falls in the window = unique users who opened
-- in the window (a later open only moves last_opened_at forward). Days are
-- UTC+3 calendar days, like the rest of the dashboard.
create or replace function public.admin_mushaf_usage_stats()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today_start timestamptz :=
    date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
begin
  if not public.is_staff_viewer() then
    raise exception 'غير مصرح';
  end if;
  return (
    select jsonb_build_object(
      'today', count(*) filter (where m.last_opened_at >= v_today_start),
      'd7',    count(*) filter (where m.last_opened_at >= v_today_start - interval '6 days'),
      'd30',   count(*) filter (where m.last_opened_at >= v_today_start - interval '29 days'),
      'total', count(*)
    )
    from public.mushaf_usage m
  );
end;
$$;
revoke all on function public.admin_mushaf_usage_stats() from public, anon;
grant execute on function public.admin_mushaf_usage_stats() to authenticated;
