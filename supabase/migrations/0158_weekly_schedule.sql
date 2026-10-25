-- =============================================================================
-- 0158_weekly_schedule.sql
-- المَحجّة البَيْضَاء — «الجدول الأسبوعي للدروس» (owner-approved design 2026-10-05,
-- canvas https://claude.ai/artifact/1ePiwswwUDXk5DnNGf5gKs).
--
-- 1. schedule_items — the recurring lessons: title, short description, subject,
--    sheikh (a sheikhs row or a free name), linked section, audience, weekdays
--    (Postgres dow 0=Sunday … 6=Saturday), start time IN MECCA TIME, duration,
--    a note, shown/paused, sort order.
-- 2. schedule_exceptions — ONE date of one lesson: cancelled, or moved to
--    another date and/or time (postpone / change it for that day only), with
--    an optional note; the regular schedule is untouched.
-- 3. Who edits: every moderator — admin, publisher, sheikh (owner 2026-10-05:
--    «أعطِ الصلاحية لجميع المشرفين») — can_edit_schedule().
-- 4. NO load: the app reads everything in ONE call (get_schedule, a few KB),
--    keeps it on the device, and refetches only when the version changes —
--    app_config.schedule_version, stamped by triggers on every edit and carried
--    by app_open (the one call an app open already makes). No polling.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- 0. Who may edit ----------------------------------------------------------------------
create or replace function public.can_edit_schedule()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_content_manager() or public.is_sheikh();
$$;
revoke all on function public.can_edit_schedule() from public, anon;
grant execute on function public.can_edit_schedule() to authenticated;

-- 1. Lessons --------------------------------------------------------------------------
create table if not exists public.schedule_items (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 2 and 150),
  subtitle     text check (subtitle is null or char_length(subtitle) <= 200),
  subject      text check (subject is null or char_length(subject) <= 60),
  sheikh_id    uuid references public.sheikhs(id) on delete set null,
  sheikh_name  text check (sheikh_name is null or char_length(sheikh_name) <= 120),
  section_id   uuid references public.sections(id) on delete set null,
  audience     text not null default 'all' check (audience in ('all', 'male', 'female')),
  days         smallint[] not null
               check (cardinality(days) between 1 and 7
                      and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  start_time   time not null,
  duration_min smallint check (duration_min is null or duration_min between 5 and 600),
  note         text check (note is null or char_length(note) <= 300),
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.schedule_items is
  '0158: «الجدول الأسبوعي» recurring lessons; days = Postgres dow (0 Sunday … 6 Saturday); start_time in Mecca time (UTC+3).';
create index if not exists schedule_items_sheikh_idx on public.schedule_items (sheikh_id);
create index if not exists schedule_items_section_idx on public.schedule_items (section_id);
create index if not exists schedule_items_created_by_idx on public.schedule_items (created_by);

drop trigger if exists schedule_items_updated_at on public.schedule_items;
create trigger schedule_items_updated_at
  before update on public.schedule_items
  for each row execute function public.set_updated_at();

-- 2. One date of one lesson ----------------------------------------------------------
create table if not exists public.schedule_exceptions (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.schedule_items(id) on delete cascade,
  occurs_on  date not null,
  kind       text not null check (kind in ('cancelled', 'moved')),
  new_date   date,
  new_time   time,
  note       text check (note is null or char_length(note) <= 300),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint schedule_exceptions_one_per_date unique (item_id, occurs_on),
  constraint schedule_exceptions_moved_target
    check (kind <> 'moved' or new_date is not null or new_time is not null)
);
comment on table public.schedule_exceptions is
  '0158: one date of one lesson — cancelled, or moved (new_date and/or new_time, Mecca time). occurs_on is the ORIGINAL date.';
create index if not exists schedule_exceptions_occurs_idx on public.schedule_exceptions (occurs_on);
create index if not exists schedule_exceptions_created_by_idx on public.schedule_exceptions (created_by);

-- The date must be a day the lesson is actually held.
create or replace function public.schedule_exception_check()
returns trigger
language plpgsql set search_path = public as $$
declare v_days smallint[];
begin
  select days into v_days from public.schedule_items where id = new.item_id;
  if v_days is null then
    raise exception 'الدرس غير موجود';
  end if;
  if not (extract(dow from new.occurs_on)::smallint = any (v_days)) then
    raise exception 'هذا الدرس لا يُعقد في ذلك اليوم';
  end if;
  if new.kind = 'cancelled' then
    new.new_date := null;
    new.new_time := null;
  end if;
  return new;
end;
$$;
drop trigger if exists schedule_exceptions_check on public.schedule_exceptions;
create trigger schedule_exceptions_check
  before insert or update on public.schedule_exceptions
  for each row execute function public.schedule_exception_check();

-- 3. Version stamp: any edit → app_config.schedule_version (app_open carries it) -------
create or replace function public.schedule_bump_version()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_config (key, value)
  values ('schedule_version', (extract(epoch from clock_timestamp()) * 1000)::bigint::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return null;
end;
$$;
revoke all on function public.schedule_bump_version() from public, anon, authenticated;
drop trigger if exists schedule_items_version on public.schedule_items;
create trigger schedule_items_version
  after insert or update or delete on public.schedule_items
  for each statement execute function public.schedule_bump_version();
drop trigger if exists schedule_exceptions_version on public.schedule_exceptions;
create trigger schedule_exceptions_version
  after insert or update or delete on public.schedule_exceptions
  for each statement execute function public.schedule_bump_version();

-- 4. RLS: read the shown lessons, every moderator writes --------------------------------
alter table public.schedule_items enable row level security;
alter table public.schedule_exceptions enable row level security;
revoke all on table public.schedule_items from public, anon;
revoke all on table public.schedule_exceptions from public, anon;
grant select, insert, update, delete on table public.schedule_items to authenticated;
grant select, insert, update, delete on table public.schedule_exceptions to authenticated;

drop policy if exists schedule_items_read on public.schedule_items;
create policy schedule_items_read on public.schedule_items
  for select to authenticated
  using (is_active or (select public.can_edit_schedule()));
drop policy if exists schedule_items_insert on public.schedule_items;
create policy schedule_items_insert on public.schedule_items
  for insert to authenticated with check ((select public.can_edit_schedule()));
drop policy if exists schedule_items_update on public.schedule_items;
create policy schedule_items_update on public.schedule_items
  for update to authenticated
  using ((select public.can_edit_schedule())) with check ((select public.can_edit_schedule()));
drop policy if exists schedule_items_delete on public.schedule_items;
create policy schedule_items_delete on public.schedule_items
  for delete to authenticated using ((select public.can_edit_schedule()));

drop policy if exists schedule_exceptions_read on public.schedule_exceptions;
create policy schedule_exceptions_read on public.schedule_exceptions
  for select to authenticated
  using (exists (select 1 from public.schedule_items i
                  where i.id = item_id and (i.is_active or (select public.can_edit_schedule()))));
drop policy if exists schedule_exceptions_insert on public.schedule_exceptions;
create policy schedule_exceptions_insert on public.schedule_exceptions
  for insert to authenticated with check ((select public.can_edit_schedule()));
drop policy if exists schedule_exceptions_update on public.schedule_exceptions;
create policy schedule_exceptions_update on public.schedule_exceptions
  for update to authenticated
  using ((select public.can_edit_schedule())) with check ((select public.can_edit_schedule()));
drop policy if exists schedule_exceptions_delete on public.schedule_exceptions;
create policy schedule_exceptions_delete on public.schedule_exceptions
  for delete to authenticated using ((select public.can_edit_schedule()));

-- 5. ONE read for the app (students: shown lessons for their side; moderators: all) ----
create or replace function public.get_schedule()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_staff  boolean;
  v_gender text;
  v_today  date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if v_uid is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  v_staff := public.can_edit_schedule();
  select p.gender into v_gender from public.profiles p where p.id = v_uid;

  return (
    with visible as (
      select i.*
        from public.schedule_items i
       where v_staff
          or (i.is_active
              and (i.audience = 'all' or i.audience = v_gender)
              and (i.section_id is null or public.section_visible_to_viewer(i.section_id, v_gender)))
    )
    select jsonb_build_object(
      'version', (select c.value from public.app_config c where c.key = 'schedule_version'),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', v.id, 'title', v.title, 'subtitle', v.subtitle, 'subject', v.subject,
                 'sheikh_id', v.sheikh_id,
                 'sheikh_name', coalesce(nullif(btrim(v.sheikh_name), ''), sh.name),
                 'section_id', v.section_id, 'section_title', sec.title,
                 'audience', v.audience, 'days', to_jsonb(v.days),
                 'start_time', to_char(v.start_time, 'HH24:MI'),
                 'duration_min', v.duration_min, 'note', v.note,
                 'is_active', v.is_active, 'sort_order', v.sort_order)
               order by v.start_time, v.sort_order, v.title)
          from visible v
          left join public.sheikhs sh on sh.id = v.sheikh_id
          left join public.sections sec on sec.id = v.section_id), '[]'::jsonb),
      'exceptions', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', e.id, 'item_id', e.item_id, 'occurs_on', e.occurs_on, 'kind', e.kind,
                 'new_date', e.new_date, 'new_time', to_char(e.new_time, 'HH24:MI'), 'note', e.note)
               order by e.occurs_on)
          from public.schedule_exceptions e
          join visible v on v.id = e.item_id
         where e.occurs_on between v_today - 7 and v_today + 90
            or e.new_date between v_today - 7 and v_today + 90), '[]'::jsonb),
      'can_edit', v_staff
    )
  );
end;
$$;
revoke all on function public.get_schedule() from public, anon;
grant execute on function public.get_schedule() to authenticated;

-- 6. app_open (0156) carries the schedule version — the app refetches only on change ---
create or replace function public.app_open()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_banned timestamptz;
  v_exists boolean;
  v_goals  bigint := 0;
begin
  if v_uid is null then
    return jsonb_build_object('user_exists', false);
  end if;

  select true, u.banned_until into v_exists, v_banned from auth.users u where u.id = v_uid;
  if not coalesce(v_exists, false) then
    return jsonb_build_object('user_exists', false);
  end if;

  update public.profiles
     set last_opened_at = now()
   where id = v_uid
     and (last_opened_at is null
          or last_opened_at < now() - interval '1 hour'
          or (last_opened_at + interval '3 hours')::date <> (now() + interval '3 hours')::date);

  if to_regclass('public.buddy_goals') is not null then
    execute 'select count(*) from public.buddy_goals where b_user_id = $1 and status = ''pending'''
      into v_goals using v_uid;
  end if;

  return jsonb_build_object(
    'user_exists', true,
    'banned', coalesce(v_banned > now(), false),
    'unread', (select count(*) from public.notifications n
                where n.user_id = v_uid and n.read_at is null),
    'latest_notification_at', (select max(n.created_at) from public.notifications n
                                where n.user_id = v_uid),
    'buddy', jsonb_build_object(
      'incoming', (select count(*) from public.buddy_requests r
                    where r.to_user_id = v_uid and r.status = 'pending'),
      'outgoing', (select count(*) from public.buddy_requests r
                    where r.from_user_id = v_uid and r.status = 'pending'),
      'goal_invites', v_goals),
    'daily_reminder', coalesce((select p.enabled from public.notification_prefs p
                                 where p.user_id = v_uid and p.type = 'daily_reminder'), false),
    'has_resumable', exists (select 1 from public.user_lecture_progress lp
                              where lp.user_id = v_uid and lp.completed = false and lp.position_sec > 0),
    'live', public.get_live_now(),
    'version', (select jsonb_object_agg(c.key, c.value) from public.app_config c
                 where c.key in ('min_app_version', 'app_download_url',
                                 'latest_app_version', 'latest_released_at')),
    -- 0158: «الجدول الأسبوعي» — the app refetches get_schedule only when this changes.
    'schedule_version', (select c.value from public.app_config c where c.key = 'schedule_version')
  );
end;
$$;
revoke all on function public.app_open() from public, anon;
grant execute on function public.app_open() to authenticated;

-- Seed the version so the first app_open already carries one.
insert into public.app_config (key, value)
values ('schedule_version', (extract(epoch from now()) * 1000)::bigint::text)
on conflict (key) do nothing;
