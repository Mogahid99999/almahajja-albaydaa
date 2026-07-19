-- =============================================================================
-- 0112 · «أهداف الرفقة» buddy shared goals (V20 · §10)
--
-- An independent shared goal per buddy pairing. Each side has its OWN share
-- measured over the goal window; neither can complete for the other. The goal
-- completes only when BOTH reach their share (§10). Up to one ACTIVE goal per
-- buddy, and (enforced app-side + here) ≤ 3 active goals total.
--
-- Progress is computed live from existing data over [starts_on, ends_on]:
--   metric 'lectures'    → lessons each completed in the window (completed_at)
--   metric 'minutes'     → whole minutes each listened in the window (daily_listening)
--   metric 'active_days' → active days each had in the window (daily_listening>0)
-- so there's no per-tick bookkeeping — get_buddy_goals derives both sides on read.
--
-- All cross-user work is SECURITY DEFINER (like the rest of the buddy system),
-- validating the caller is one of the pair. Append-only, idempotent.
-- =============================================================================

create table if not exists public.buddy_goals (
  id          uuid primary key default gen_random_uuid(),
  a_user_id   uuid not null references auth.users (id) on delete cascade,
  b_user_id   uuid not null references auth.users (id) on delete cascade,
  created_by  uuid not null references auth.users (id) on delete cascade,
  metric      text not null check (metric in ('lectures', 'minutes', 'active_days')),
  target      integer not null check (target > 0),
  starts_on   date not null default current_date,
  ends_on     date not null,
  status      text not null default 'pending'
                check (status in ('pending', 'active', 'completed', 'expired', 'declined', 'cancelled')),
  created_at  timestamptz not null default now(),
  responded_at timestamptz,
  check (a_user_id <> b_user_id),
  check (ends_on >= starts_on)
);
create index if not exists buddy_goals_pair_idx
  on public.buddy_goals (a_user_id, b_user_id, status);
create index if not exists buddy_goals_b_idx
  on public.buddy_goals (b_user_id, status);

alter table public.buddy_goals enable row level security;

-- A member of the pair can read their goals. Writes go through the RPCs only.
drop policy if exists buddy_goals_member_read on public.buddy_goals;
create policy buddy_goals_member_read on public.buddy_goals
  for select to authenticated
  using (a_user_id = auth.uid() or b_user_id = auth.uid());

grant select on public.buddy_goals to authenticated;

-- --- helpers -----------------------------------------------------------------
-- One side's progress toward `metric` over [from_day, to_day] (inclusive today).
create or replace function public.buddy_goal_share(
  p_user_id uuid, p_metric text, p_from date, p_to date
)
returns integer
language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'lectures' then (
      select count(*)::int from public.user_lecture_progress p
       where p.user_id = p_user_id and p.completed and p.completed_at is not null
         and (p.completed_at)::date >= p_from and (p.completed_at)::date <= p_to
    )
    when 'minutes' then (
      select coalesce(floor(sum(d.seconds_listened) / 60.0), 0)::int
        from public.daily_listening d
       where d.user_id = p_user_id and d.day >= p_from and d.day <= p_to
    )
    when 'active_days' then (
      select count(*)::int from public.daily_listening d
       where d.user_id = p_user_id and d.seconds_listened > 0
         and d.day >= p_from and d.day <= p_to
    )
    else 0
  end;
$$;
revoke all on function public.buddy_goal_share(uuid, text, date, date) from public, anon;
grant execute on function public.buddy_goal_share(uuid, text, date, date) to authenticated;

-- --- create (invite) ---------------------------------------------------------
-- The creator invites a buddy to a shared goal. Validates the two are accepted
-- buddies, that there's no other ACTIVE/PENDING goal with THIS buddy, and that
-- the creator isn't already at 3 active goals. Starts 'pending' until accepted.
create or replace function public.create_buddy_goal(
  p_buddy_id uuid, p_metric text, p_target integer, p_days integer
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_active_total int;
  v_with_buddy int;
begin
  if not exists (select 1 from public.buddies_of(v_me) b where b = p_buddy_id) then
    raise exception 'ليس رفيقاً مقبولاً';
  end if;
  if p_metric not in ('lectures', 'minutes', 'active_days') then
    raise exception 'نوع هدف غير معروف';
  end if;
  if coalesce(p_target, 0) <= 0 or coalesce(p_days, 0) <= 0 then
    raise exception 'قيمة أو مدة غير صالحة';
  end if;

  select count(*) into v_active_total from public.buddy_goals
   where (a_user_id = v_me or b_user_id = v_me) and status in ('pending', 'active');
  if v_active_total >= 3 then
    raise exception 'بلغت الحد الأقصى لأهداف الرفقة النشطة';
  end if;

  select count(*) into v_with_buddy from public.buddy_goals
   where status in ('pending', 'active')
     and ((a_user_id = v_me and b_user_id = p_buddy_id)
       or (a_user_id = p_buddy_id and b_user_id = v_me));
  if v_with_buddy > 0 then
    raise exception 'يوجد هدف نشط مع هذا الرفيق بالفعل';
  end if;

  insert into public.buddy_goals (a_user_id, b_user_id, created_by, metric, target, starts_on, ends_on, status)
    values (v_me, p_buddy_id, v_me, p_metric, p_target, current_date, current_date + (p_days - 1), 'pending')
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_buddy_goal(uuid, text, integer, integer) from public, anon;
grant execute on function public.create_buddy_goal(uuid, text, integer, integer) to authenticated;

-- --- respond (accept / decline) ----------------------------------------------
-- Only the INVITEE (b_user_id) may respond. Accepting re-bases the window to
-- start today (so both sides' shares are measured from the accept moment).
create or replace function public.respond_buddy_goal(p_goal_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  g public.buddy_goals%rowtype;
begin
  select * into g from public.buddy_goals
   where id = p_goal_id and b_user_id = v_me and status = 'pending' for update;
  if not found then
    raise exception 'الدعوة لم تعد متاحة';
  end if;
  if p_accept then
    update public.buddy_goals
       set status = 'active', responded_at = now(),
           starts_on = current_date, ends_on = current_date + (ends_on - starts_on)
     where id = p_goal_id;
  else
    update public.buddy_goals
       set status = 'declined', responded_at = now()
     where id = p_goal_id;
  end if;
end;
$$;
revoke all on function public.respond_buddy_goal(uuid, boolean) from public, anon;
grant execute on function public.respond_buddy_goal(uuid, boolean) to authenticated;

-- --- cancel ------------------------------------------------------------------
create or replace function public.cancel_buddy_goal(p_goal_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid();
begin
  update public.buddy_goals
     set status = 'cancelled', responded_at = now()
   where id = p_goal_id
     and (a_user_id = v_me or b_user_id = v_me)
     and status in ('pending', 'active');
end;
$$;
revoke all on function public.cancel_buddy_goal(uuid) from public, anon;
grant execute on function public.cancel_buddy_goal(uuid) to authenticated;

-- --- list my goals (with live progress + buddy names) ------------------------
-- One row per goal involving me, both sides' live progress, my/their names, and
-- a derived flag for whether the window has expired. Active goals whose window
-- passed are reported with status 'expired' (a lazy transition — no cron needed
-- for display; the nudge cron may also flip them).
create or replace function public.get_buddy_goals()
returns table (
  id            uuid,
  buddy_id      uuid,
  buddy_name    text,
  metric        text,
  target        integer,
  my_progress   integer,
  buddy_progress integer,
  starts_on     date,
  ends_on       date,
  days_left     integer,
  status        text,
  i_created     boolean
)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid)
  select
    g.id,
    case when g.a_user_id = (select uid from me) then g.b_user_id else g.a_user_id end as buddy_id,
    coalesce(pr.display_name, 'رفيقك') as buddy_name,
    g.metric,
    g.target,
    public.buddy_goal_share(
      (select uid from me), g.metric, g.starts_on, least(current_date, g.ends_on)
    ) as my_progress,
    public.buddy_goal_share(
      case when g.a_user_id = (select uid from me) then g.b_user_id else g.a_user_id end,
      g.metric, g.starts_on, least(current_date, g.ends_on)
    ) as buddy_progress,
    g.starts_on,
    g.ends_on,
    greatest(0, (g.ends_on - current_date) + 1) as days_left,
    case
      when g.status = 'active' and current_date > g.ends_on then 'expired'
      else g.status
    end as status,
    (g.created_by = (select uid from me)) as i_created
  from public.buddy_goals g
  left join public.profiles pr
    on pr.id = case when g.a_user_id = (select uid from me) then g.b_user_id else g.a_user_id end
  where (g.a_user_id = (select uid from me) or g.b_user_id = (select uid from me))
    and g.status in ('pending', 'active', 'completed', 'expired')
  order by g.created_at desc;
$$;
revoke all on function public.get_buddy_goals() from public, anon;
grant execute on function public.get_buddy_goals() to authenticated;

-- --- incoming goal invitations (for the invitations page) --------------------
create or replace function public.get_incoming_buddy_goals()
returns table (
  id uuid, from_name text, metric text, target integer, days integer, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select g.id, coalesce(pr.display_name, 'طالب علم'), g.metric, g.target,
         (g.ends_on - g.starts_on) + 1, g.created_at
    from public.buddy_goals g
    left join public.profiles pr on pr.id = g.a_user_id
   where g.b_user_id = auth.uid() and g.status = 'pending'
   order by g.created_at desc;
$$;
revoke all on function public.get_incoming_buddy_goals() from public, anon;
grant execute on function public.get_incoming_buddy_goals() to authenticated;

-- --- settle completed goals (called by the nudge cron / on read) -------------
-- Flip an active goal to 'completed' once BOTH sides reached target within the
-- window. Idempotent; safe to call often. Returns the number newly completed.
create or replace function public.settle_buddy_goals()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with done as (
    select g.id from public.buddy_goals g
     where g.status = 'active'
       and current_date <= g.ends_on
       and public.buddy_goal_share(g.a_user_id, g.metric, g.starts_on, least(current_date, g.ends_on)) >= g.target
       and public.buddy_goal_share(g.b_user_id, g.metric, g.starts_on, least(current_date, g.ends_on)) >= g.target
  ), upd as (
    update public.buddy_goals set status = 'completed', responded_at = now()
     where id in (select id from done) returning 1
  )
  select count(*) into v_n from upd;
  return v_n;
end;
$$;
revoke all on function public.settle_buddy_goals() from public, anon;
grant execute on function public.settle_buddy_goals() to authenticated;
