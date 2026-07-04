-- =============================================================================
-- 0015_study_buddy.sql
-- المَحجّة البَيْضَاء — Feature 26.2: رفيق الدراسة (study buddy)
--
-- Gender-segregated, optional, ONE buddy per user, no chat in v1.
--   * profiles.gender — set by the student via set_own_profile() (SECURITY
--     DEFINER, same pattern as touch_last_opened in 0013: profiles is
--     admin-write-only, a blanket own-update policy would let a student
--     escalate role). The same setter also syncs display_name into profiles —
--     names live in auth user_metadata and were only copied at user creation,
--     so anon-born accounts have NULL there and buddy search needs them.
--   * buddy_requests — pending/accepted/declined/cancelled between two users.
--     unique(from,to); re-inviting after a decline/cancel resets the same row.
--   * All cross-user reads/writes go through SECURITY DEFINER functions with
--     the gender filter enforced server-side — profiles RLS (own+admin only)
--     stays untouched, and clients can never see opposite-gender rows.
--   * Streak math reuses streak_for_user (0014). Week progress for an arbitrary
--     user mirrors get_week_progress (0004) / the 0013 dispatcher inline logic.
--   * The 'buddy_activity' notification enum value is added HERE (a new enum
--     value cannot be used in the transaction that adds it — 0012/0013 split);
--     the completion trigger that uses it lives in 0016.
--
-- Append-only migration — 0001–0014 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles.gender + the students' own-profile setter
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists gender text check (gender in ('male', 'female'));

create or replace function public.set_own_profile(
  p_gender       text default null,
  p_display_name text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_gender is not null and p_gender not in ('male', 'female') then
    raise exception 'قيمة غير صالحة';
  end if;
  update public.profiles
     set gender       = coalesce(p_gender, gender),
         display_name = coalesce(nullif(trim(p_display_name), ''), display_name)
   where id = auth.uid();
end;
$$;
grant execute on function public.set_own_profile(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- buddy_requests
-- ---------------------------------------------------------------------------
create table if not exists public.buddy_requests (
  id            uuid primary key default gen_random_uuid(),
  from_user_id  uuid not null references auth.users (id) on delete cascade,
  to_user_id    uuid not null references auth.users (id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  unique (from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);
create index if not exists buddy_requests_to_idx
  on public.buddy_requests (to_user_id, status);
create index if not exists buddy_requests_from_idx
  on public.buddy_requests (from_user_id, status);

alter table public.buddy_requests enable row level security;

drop policy if exists buddy_requests_select on public.buddy_requests;
create policy buddy_requests_select on public.buddy_requests
  for select to authenticated
  using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists buddy_requests_insert on public.buddy_requests;
create policy buddy_requests_insert on public.buddy_requests
  for insert to authenticated
  with check (from_user_id = auth.uid());

-- Receiver accepts/declines; sender may cancel while still pending. (Accepting
-- and cancelling an ACTIVE pair go through the DEFINER functions below, which
-- also enforce the one-buddy invariant atomically.)
drop policy if exists buddy_requests_update on public.buddy_requests;
create policy buddy_requests_update on public.buddy_requests
  for update to authenticated
  using (
    to_user_id = auth.uid()
    or (from_user_id = auth.uid() and status = 'pending')
  )
  with check (from_user_id = auth.uid() or to_user_id = auth.uid());

grant select, insert, update on public.buddy_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The accepted buddy of p_user_id, or null. SECURITY DEFINER so the buddy
-- rollups below can resolve pairs regardless of who asks; safe — returns ids
-- only for pairs the subject is part of.
create or replace function public.buddy_of(p_user_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select case when from_user_id = p_user_id then to_user_id else from_user_id end
    from public.buddy_requests
   where status = 'accepted'
     and (from_user_id = p_user_id or to_user_id = p_user_id)
   order by responded_at desc nulls last
   limit 1;
$$;
revoke all on function public.buddy_of(uuid) from public, anon;
grant execute on function public.buddy_of(uuid) to authenticated;

-- Week progress (Sat→Fri, same bounds as get_week_progress in 0004) for an
-- arbitrary user. INVOKER: direct client calls are RLS-gated to own rows;
-- inside the DEFINER rollups below it sees the buddy's rows.
create or replace function public.week_progress_for_user(p_user_id uuid)
returns table (metric public.goal_metric, target integer, current integer)
language sql stable security invoker set search_path = public as $$
  with g as (
    select coalesce(wg.metric, 'lectures'::public.goal_metric) as metric,
           coalesce(wg.target, 3)                              as target
      from (select 1) one
      left join public.weekly_goals wg on wg.user_id = p_user_id
  ),
  bounds as (
    select (current_date
            - ((extract(dow from current_date)::int + 1) % 7))::date as wk_start
  ),
  wk as (
    select dl.seconds_listened, dl.lecture_ids
      from public.daily_listening dl, bounds b
     where dl.user_id = p_user_id
       and dl.day between b.wk_start and b.wk_start + 6
  )
  select
    g.metric,
    g.target,
    case g.metric
      when 'minutes'  then (coalesce((select sum(seconds_listened) from wk), 0) / 60)::int
      when 'lectures' then coalesce(
        (select count(distinct lid)::int
           from wk w, lateral unnest(w.lecture_ids) as lid),
        0)
    end as current
  from g;
$$;
grant execute on function public.week_progress_for_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client-facing RPCs
-- ---------------------------------------------------------------------------

create or replace function public.get_my_buddy_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select public.buddy_of(auth.uid());
$$;
grant execute on function public.get_my_buddy_id() to authenticated;

-- The accepted buddy's card data — display name, streak, today state, week
-- progress. Returns zero rows when there is no buddy.
create or replace function public.get_buddy_status()
returns table (
  buddy_id          uuid,
  display_name      text,
  current_streak    integer,
  today_counted     boolean,
  week_progress_pct integer,
  weekly_goal_met   boolean
)
language sql stable security definer set search_path = public as $$
  with b as (select public.buddy_of(auth.uid()) as id),
  wk as (
    select w.* from b, lateral public.week_progress_for_user(b.id) w
     where b.id is not null
  )
  select
    b.id,
    coalesce(p.display_name, 'رفيقك'),
    public.streak_for_user(b.id),
    exists (select 1 from public.daily_listening dl
             where dl.user_id = b.id and dl.day = current_date and dl.meaningful),
    least(100, (wk.current * 100 / greatest(wk.target, 1)))::int,
    wk.current >= wk.target
  from b
  join public.profiles p on p.id = b.id
  cross join wk
  where b.id is not null;
$$;
grant execute on function public.get_buddy_status() to authenticated;

-- Incoming pending invitations (with sender names — profiles RLS is own-only,
-- so the names must come through this DEFINER read).
create or replace function public.get_incoming_buddy_requests()
returns table (id uuid, from_display_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, coalesce(p.display_name, 'طالب علم'), r.created_at
    from public.buddy_requests r
    join public.profiles p on p.id = r.from_user_id
   where r.to_user_id = auth.uid() and r.status = 'pending'
   order by r.created_at desc;
$$;
grant execute on function public.get_incoming_buddy_requests() to authenticated;

-- Same-gender candidate search. The gender filter is enforced HERE, server-side
-- — the client never receives opposite-gender rows. Excludes admins, guests
-- (no display_name), anyone already paired, and anyone with a pending request
-- in either direction with me.
create or replace function public.search_buddy_candidates(p_search text)
returns table (id uuid, display_name text, current_streak integer)
language sql stable security definer set search_path = public as $$
  with me as (
    select id, gender from public.profiles where id = auth.uid()
  )
  select p.id, p.display_name, public.streak_for_user(p.id)
    from public.profiles p, me
   where p.id <> me.id
     and p.role = 'student'
     and p.gender is not null
     and me.gender is not null
     and p.gender = me.gender
     and p.display_name is not null
     and (coalesce(trim(p_search), '') = '' or p.display_name ilike '%' || trim(p_search) || '%')
     and public.buddy_of(p.id) is null
     and not exists (
       select 1 from public.buddy_requests r
        where r.status = 'pending'
          and ((r.from_user_id = me.id and r.to_user_id = p.id)
            or (r.from_user_id = p.id and r.to_user_id = me.id))
     )
   order by p.display_name
   limit 20;
$$;
grant execute on function public.search_buddy_candidates(text) to authenticated;

-- Send an invitation. All invariants server-side: same gender, no existing
-- pair on either side, no duplicate pending. Re-inviting after a decline or
-- cancel resets the same (from,to) row back to pending.
create or replace function public.send_buddy_request(p_to_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me        uuid := auth.uid();
  v_my_gender text;
  v_to_gender text;
begin
  if v_me is null or p_to_user_id is null or p_to_user_id = v_me then
    raise exception 'طلب غير صالح';
  end if;

  select gender into v_my_gender from public.profiles where id = v_me;
  select gender into v_to_gender from public.profiles where id = p_to_user_id;
  if v_my_gender is null or v_to_gender is null or v_my_gender <> v_to_gender then
    raise exception 'لا يمكن إرسال هذه الدعوة';
  end if;

  if public.buddy_of(v_me) is not null or public.buddy_of(p_to_user_id) is not null then
    raise exception 'يوجد رفيق دراسة بالفعل';
  end if;

  if exists (
    select 1 from public.buddy_requests
     where status = 'pending'
       and ((from_user_id = v_me and to_user_id = p_to_user_id)
         or (from_user_id = p_to_user_id and to_user_id = v_me))
  ) then
    raise exception 'توجد دعوة قيد الانتظار بالفعل';
  end if;

  insert into public.buddy_requests (from_user_id, to_user_id)
  values (v_me, p_to_user_id)
  on conflict (from_user_id, to_user_id) do update set
    status       = 'pending',
    created_at   = now(),
    responded_at = null;
end;
$$;
grant execute on function public.send_buddy_request(uuid) to authenticated;

-- Accept / decline an incoming invitation. Accept re-checks the one-buddy
-- invariant atomically (both sides) before flipping to accepted.
create or replace function public.respond_buddy_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  r    public.buddy_requests%rowtype;
begin
  select * into r from public.buddy_requests
   where id = p_request_id and to_user_id = v_me and status = 'pending'
   for update;
  if not found then
    raise exception 'الدعوة لم تعد متاحة';
  end if;

  if p_accept then
    if public.buddy_of(v_me) is not null or public.buddy_of(r.from_user_id) is not null then
      raise exception 'يوجد رفيق دراسة بالفعل';
    end if;
    update public.buddy_requests
       set status = 'accepted', responded_at = now()
     where id = p_request_id;
  else
    update public.buddy_requests
       set status = 'declined', responded_at = now()
     where id = p_request_id;
  end if;
end;
$$;
grant execute on function public.respond_buddy_request(uuid, boolean) to authenticated;

-- End the buddy relationship (either side may end it; RLS alone would only let
-- the receiver update an accepted row). Also withdraws my outgoing pendings.
create or replace function public.cancel_buddy()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  update public.buddy_requests
     set status = 'cancelled', responded_at = now()
   where status = 'accepted'
     and (from_user_id = v_me or to_user_id = v_me);

  update public.buddy_requests
     set status = 'cancelled', responded_at = now()
   where status = 'pending' and from_user_id = v_me;
end;
$$;
grant execute on function public.cancel_buddy() to authenticated;

-- ---------------------------------------------------------------------------
-- Notification enum value for 0016 (added here, used there — a new enum value
-- cannot be referenced in the same transaction that adds it).
-- ---------------------------------------------------------------------------
alter type public.notification_type add value if not exists 'buddy_activity';
