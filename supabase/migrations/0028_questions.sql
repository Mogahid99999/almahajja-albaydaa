-- =============================================================================
-- 0028_questions.sql
-- المَحجّة البَيْضَاء — V6 Feature A: أسئلة وأجوبة (general + per-lesson Q&A).
--
-- Design (PLAN_QNA_NOTES_V6 locked decisions):
--   * Anonymity is enforced IN SQL: the public/sheikh-facing RPCs never return
--     the author of an anonymous question — only is_admin() resolves it.
--   * audience 'public' → appears in the public list once answered;
--     audience 'sheikh' → only asker + sheikh + admin ever see it.
--   * All cross-user reads and all moderation are SECURITY DEFINER RPCs; the
--     table itself only allows own-row select/insert (moderators may select).
--   * Notifications ride the existing pipeline (INSERT public.notifications →
--     0009 webhook → notify-on-publish → Expo Push), best-effort, pref-gated
--     (missing pref row = ON, the 0020 model).
--
-- Uses the enum values added in 0027 ('sheikh', 'question_received',
-- 'question_answered') — 0027 must be applied first, in its own transaction.
--
-- Append-only — 0001–0027 are never edited. Idempotent.
-- =============================================================================

-- Optional link from a metadata sheikh (0001 `sheikhs` = display names only) to
-- a real sheikh LOGIN. Display refinement only — routing sends every question
-- to every sheikh-role user for now.
alter table public.sheikhs
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Role helpers (0001 is_admin pattern)
-- ---------------------------------------------------------------------------
create or replace function public.is_sheikh()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'sheikh'
  );
$$;
grant execute on function public.is_sheikh() to authenticated;

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('sheikh', 'admin')
  );
$$;
grant execute on function public.is_moderator() to authenticated;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.questions (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('general', 'lecture')),
  lecture_id   uuid references public.lectures (id) on delete cascade,
  asker_id     uuid not null references auth.users (id) on delete cascade,
  is_anonymous boolean not null default false,
  audience     text not null default 'public' check (audience in ('public', 'sheikh')),
  body         text not null,
  status       text not null default 'pending'
                 check (status in ('pending', 'answered', 'hidden')),
  answer_body  text,
  answered_by  uuid references auth.users (id) on delete set null,
  answered_at  timestamptz,
  created_at   timestamptz not null default now(),
  check ((scope = 'lecture') = (lecture_id is not null))
);

create index if not exists questions_scope_status_idx
  on public.questions (scope, status, created_at desc);
create index if not exists questions_lecture_idx
  on public.questions (lecture_id, status);
create index if not exists questions_asker_idx
  on public.questions (asker_id);

-- RLS: own rows + moderators. The PUBLIC answered list goes through
-- get_public_questions (which strips anonymous authors) — never a raw select.
-- No update/delete policies: answering/deleting happens only via the RPCs.
alter table public.questions enable row level security;

drop policy if exists questions_insert_own on public.questions;
create policy questions_insert_own on public.questions
  for insert to authenticated
  with check (asker_id = auth.uid());

drop policy if exists questions_select_own_or_moderator on public.questions;
create policy questions_select_own_or_moderator on public.questions
  for select to authenticated
  using (asker_id = auth.uid() or public.is_moderator());

grant select, insert on public.questions to authenticated;

-- ---------------------------------------------------------------------------
-- ask_question — registered users only (guests get the client register nudge,
-- and this server gate makes it authoritative). Fans a 'question_received'
-- notification out to every sheikh-role user, best-effort.
-- ---------------------------------------------------------------------------
create or replace function public.ask_question(
  p_scope        text,
  p_lecture_id   uuid,
  p_is_anonymous boolean,
  p_audience     text,
  p_body         text
)
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
    raise exception 'يلزم إنشاء حساب لطرح سؤال';
  end if;
  if p_scope not in ('general', 'lecture') then
    raise exception 'نطاق غير صالح';
  end if;
  if p_audience not in ('public', 'sheikh') then
    raise exception 'وجهة غير صالحة';
  end if;
  if p_scope = 'lecture' then
    if p_lecture_id is null or not exists (
      select 1 from public.lectures l
       where l.id = p_lecture_id and l.status = 'published'
    ) then
      raise exception 'الدرس غير متاح';
    end if;
  elsif p_lecture_id is not null then
    raise exception 'نطاق غير صالح';
  end if;
  if length(v_body) < 3 or length(v_body) > 2000 then
    raise exception 'نص السؤال يجب أن يكون بين ٣ و ٢٠٠٠ حرف';
  end if;

  insert into public.questions (scope, lecture_id, asker_id, is_anonymous, audience, body)
  values (p_scope, p_lecture_id, v_me, coalesce(p_is_anonymous, false), p_audience, v_body)
  returning id into v_id;

  -- Notify every sheikh (best-effort — a notif hiccup never fails the ask).
  begin
    insert into public.notifications (user_id, type, title, body, data)
    select p.id,
           'question_received',
           'سؤال جديد بانتظار الجواب',
           left(v_body, 120),
           jsonb_build_object('route', '/sheikh')
      from public.profiles p
     where p.role = 'sheikh'
       and coalesce((select np.enabled from public.notification_prefs np
                      where np.user_id = p.id and np.type = 'question_received'), true);
  exception when others then
    null;
  end;

  return v_id;
end;
$$;
grant execute on function public.ask_question(text, uuid, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- answer_question — sheikh or admin. Notifies the ASKER on the first answer,
-- deep-linking back to the relevant Q&A screen.
-- ---------------------------------------------------------------------------
create or replace function public.answer_question(p_question_id uuid, p_answer_body text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  q       public.questions%rowtype;
  v_body  text := btrim(coalesce(p_answer_body, ''));
  v_route text;
  v_pref  boolean;
begin
  if not public.is_moderator() then
    raise exception 'غير مصرح';
  end if;
  if length(v_body) < 1 or length(v_body) > 4000 then
    raise exception 'نص الجواب يجب ألا يتجاوز ٤٠٠٠ حرف';
  end if;

  select * into q from public.questions where id = p_question_id for update;
  if not found then
    raise exception 'السؤال غير موجود';
  end if;

  update public.questions
     set answer_body = v_body,
         status      = 'answered',
         answered_by = auth.uid(),
         answered_at = now()
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
grant execute on function public.answer_question(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_question — sheikh or admin, hard delete.
-- ---------------------------------------------------------------------------
create or replace function public.delete_question(p_question_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator() then
    raise exception 'غير مصرح';
  end if;
  delete from public.questions where id = p_question_id;
end;
$$;
grant execute on function public.delete_question(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reads. asker_display resolution is THE anonymity boundary:
--   * public list  → null when anonymous (client renders «سائل»)
--   * inbox        → real name for admins; «سائل» for sheikhs when anonymous
-- ---------------------------------------------------------------------------

-- Answered PUBLIC questions of one scope (Q + A). Open to guests (reads are
-- open; anon sessions hold the `authenticated` role).
create or replace function public.get_public_questions(
  p_scope      text,
  p_lecture_id uuid default null
)
returns table (
  id            uuid,
  body          text,
  answer_body   text,
  asker_display text,
  is_mine       boolean,
  created_at    timestamptz,
  answered_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    q.id,
    q.body,
    q.answer_body,
    case when q.is_anonymous then null
         else coalesce(p.display_name, 'طالب علم') end,
    q.asker_id = auth.uid(),
    q.created_at,
    q.answered_at
  from public.questions q
  left join public.profiles p on p.id = q.asker_id
  where q.scope = p_scope
    and (p_lecture_id is null or q.lecture_id = p_lecture_id)
    and q.status = 'answered'
    and q.audience = 'public'
  order by q.answered_at desc
  limit 200;
$$;
grant execute on function public.get_public_questions(text, uuid) to authenticated;

-- The caller's own questions (any status — «سؤالك قيد المراجعة»).
create or replace function public.get_my_questions(
  p_scope      text,
  p_lecture_id uuid default null
)
returns table (
  id           uuid,
  body         text,
  answer_body  text,
  is_anonymous boolean,
  audience     text,
  status       text,
  created_at   timestamptz,
  answered_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    q.id, q.body, q.answer_body, q.is_anonymous, q.audience, q.status,
    q.created_at, q.answered_at
  from public.questions q
  where q.asker_id = auth.uid()
    and q.scope = p_scope
    and (p_lecture_id is null or q.lecture_id = p_lecture_id)
  order by q.created_at desc
  limit 200;
$$;
grant execute on function public.get_my_questions(text, uuid) to authenticated;

-- Moderator inbox (sheikh + admin): all questions, filterable by scope/status.
-- asker_id ships ONLY to admins (needed for حظر الكاتب) — never to sheikhs.
create or replace function public.get_question_inbox(
  p_scope  text default null,
  p_status text default null
)
returns table (
  id            uuid,
  scope         text,
  lecture_id    uuid,
  lecture_title text,
  body          text,
  answer_body   text,
  is_anonymous  boolean,
  audience      text,
  status        text,
  asker_display text,
  asker_id      uuid,
  created_at    timestamptz,
  answered_at   timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_moderator() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    q.id, q.scope, q.lecture_id, l.title,
    q.body, q.answer_body, q.is_anonymous, q.audience, q.status,
    case
      when not q.is_anonymous then coalesce(p.display_name, 'طالب علم')
      when public.is_admin()  then coalesce(p.display_name, 'طالب علم')
      else 'سائل'
    end,
    case when public.is_admin() then q.asker_id else null end,
    q.created_at, q.answered_at
  from public.questions q
  left join public.lectures l on l.id = q.lecture_id
  left join public.profiles p on p.id = q.asker_id
  where (p_scope is null or q.scope = p_scope)
    and (p_status is null or q.status = p_status)
  order by q.created_at desc
  limit 500;
end;
$$;
grant execute on function public.get_question_inbox(text, text) to authenticated;
