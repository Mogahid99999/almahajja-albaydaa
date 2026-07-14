-- =============================================================================
-- 0082_multi_buddy.sql
-- المَحجّة البَيْضَاء — رفيق الدراسة: raise the buddy cap from ONE to ≤ 3.
--
-- Same mutual invite→accept system, same gender segregation, same buddy
-- progress card, same completion notification — only the "one buddy" invariant
-- becomes "at most three accepted buddies". Each student may keep sending and
-- accepting invitations until they hold 3 accepted pairs, and sees a card for
-- EACH accepted buddy.
--
-- What changes vs 0015/0016/0020/0036:
--   * buddies_of(uuid) — ALL accepted partners (setof). buddy_of stays as the
--     first partner (limit 1) so 0079/anything else that wants "a" buddy keeps
--     working.
--   * send_buddy_request / respond_buddy_request — the one-buddy guard becomes a
--     COUNT(*) >= 3 check on BOTH sides. Gender + duplicate-pending checks and
--     the gendered notification texts (0036) are preserved verbatim.
--   * search_buddy_candidates — no longer excludes anyone who "has a buddy";
--     instead excludes people I already have an accepted pair with, people with
--     a pending pair with me, and anyone already at 3 accepted pairs.
--   * get_buddies_status() — one card row PER accepted buddy (get_buddy_status
--     kept, returning the first for backward-compat).
--   * cancel_buddy(p_buddy_id uuid default null) — null ends ALL + withdraws my
--     pendings (legacy no-arg behaviour); non-null ends ONLY that one pairing.
--   * notify_buddy_on_completion — loops over ALL accepted buddies, each guarded
--     independently (pref, quiet hours, one-per-recipient-per-local-day).
--
-- Append-only migration — 0001–0081 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- ALL accepted partners of p_user_id (setof). SECURITY DEFINER so the rollups
-- below can resolve pairs regardless of who asks; safe — returns ids only for
-- pairs the subject is part of. Newest-accepted first.
create or replace function public.buddies_of(p_user_id uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select case when from_user_id = p_user_id then to_user_id else from_user_id end
    from public.buddy_requests
   where status = 'accepted'
     and (from_user_id = p_user_id or to_user_id = p_user_id)
   order by responded_at desc nulls last;
$$;
revoke all on function public.buddies_of(uuid) from public, anon;
grant execute on function public.buddies_of(uuid) to authenticated;

-- The first accepted buddy of p_user_id, or null — now a thin limit-1 over
-- buddies_of so 0079 (and any other single-buddy caller) keeps working.
create or replace function public.buddy_of(p_user_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select public.buddies_of(p_user_id) limit 1;
$$;
revoke all on function public.buddy_of(uuid) from public, anon;
grant execute on function public.buddy_of(uuid) to authenticated;

-- Count of a user's accepted pairs — the ≤ 3 cap gate, shared by send/respond.
create or replace function public.buddy_count(p_user_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.buddy_requests
   where status = 'accepted'
     and (from_user_id = p_user_id or to_user_id = p_user_id);
$$;
revoke all on function public.buddy_count(uuid) from public, anon;
grant execute on function public.buddy_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client-facing RPCs
-- ---------------------------------------------------------------------------

-- Each accepted buddy's card data — display name, streak, today state, week
-- progress. One row PER accepted buddy (up to 3); zero rows when there are none.
-- Feminine display-name fallback for female buddies (buddy matching is
-- same-gender, so my buddy shares my gender).
create or replace function public.get_buddies_status()
returns table (
  buddy_id          uuid,
  display_name      text,
  current_streak    integer,
  today_counted     boolean,
  week_progress_pct integer,
  weekly_goal_met   boolean
)
language sql stable security definer set search_path = public as $$
  select
    b.id,
    coalesce(p.display_name, case when p.gender = 'female' then 'رفيقتك' else 'رفيقك' end),
    public.streak_for_user(b.id),
    exists (select 1 from public.daily_listening dl
             where dl.user_id = b.id and dl.day = current_date and dl.meaningful),
    least(100, (wk.current * 100 / greatest(wk.target, 1)))::int,
    wk.current >= wk.target
  from public.buddies_of(auth.uid()) as b(id)
  join public.profiles p on p.id = b.id
  cross join lateral public.week_progress_for_user(b.id) wk;
$$;
grant execute on function public.get_buddies_status() to authenticated;

-- Backward-compat: the first accepted buddy's card, or zero rows. Kept so any
-- caller still on get_buddy_status keeps working; new UI uses get_buddies_status.
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
  select * from public.get_buddies_status() limit 1;
$$;
grant execute on function public.get_buddy_status() to authenticated;

-- Same-gender candidate search. The gender filter is enforced HERE, server-side
-- — the client never receives opposite-gender rows. Excludes admins, guests (no
-- display_name), anyone I ALREADY have an accepted pair with, anyone with a
-- pending request in either direction with me, and anyone already at 3 accepted
-- pairs (their slots are full).
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
     and public.buddy_count(p.id) < 3
     and not exists (
       select 1 from public.buddy_requests r
        where r.status = 'accepted'
          and ((r.from_user_id = me.id and r.to_user_id = p.id)
            or (r.from_user_id = p.id and r.to_user_id = me.id))
     )
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

-- Send an invitation. All invariants server-side: same gender, neither side at
-- the 3-buddy cap, no duplicate pending. Re-inviting after a decline or cancel
-- resets the same (from,to) row back to pending. Notifies the invitee (0020).
create or replace function public.send_buddy_request(p_to_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me        uuid := auth.uid();
  v_my_gender text;
  v_to_gender text;
  v_my_name   text;
  v_pref      boolean;
begin
  if v_me is null or p_to_user_id is null or p_to_user_id = v_me then
    raise exception 'طلب غير صالح';
  end if;

  select gender into v_my_gender from public.profiles where id = v_me;
  select gender into v_to_gender from public.profiles where id = p_to_user_id;
  if v_my_gender is null or v_to_gender is null or v_my_gender <> v_to_gender then
    raise exception 'لا يمكن إرسال هذه الدعوة';
  end if;

  if public.buddy_count(v_me) >= 3 then
    raise exception 'لديك ٣ رفقاء بالفعل';
  end if;
  if public.buddy_count(p_to_user_id) >= 3 then
    raise exception 'لدى هذا الطالب ٣ رفقاء بالفعل';
  end if;

  if exists (
    select 1 from public.buddy_requests
     where status = 'accepted'
       and ((from_user_id = v_me and to_user_id = p_to_user_id)
         or (from_user_id = p_to_user_id and to_user_id = v_me))
  ) then
    raise exception 'هذا الطالب رفيقك بالفعل';
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

  -- Notify the invitee (best-effort — never fail the invite on a notif hiccup).
  begin
    select enabled into v_pref from public.notification_prefs
     where user_id = p_to_user_id and type = 'buddy_request';
    if coalesce(v_pref, true) then
      select coalesce(display_name, 'طالب علم') into v_my_name
        from public.profiles where id = v_me;
      insert into public.notifications (user_id, type, title, body, data)
      values (
        p_to_user_id,
        'buddy_request',
        case when v_my_gender = 'female'
          then 'دعتك ' || v_my_name || ' لتكون رفيقتك في طلب العلم'
          else 'دعاك ' || v_my_name || ' ليكون رفيقك في طلب العلم' end,
        '',
        jsonb_build_object('route', '/')
      );
    end if;
  exception when others then
    null;  -- a nudge must never break the invitation
  end;
end;
$$;
grant execute on function public.send_buddy_request(uuid) to authenticated;

-- Accept / decline an incoming invitation. Accept re-checks the 3-buddy cap
-- atomically (both sides) before flipping to accepted. Notifies sender (0020).
create or replace function public.respond_buddy_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me        uuid := auth.uid();
  r           public.buddy_requests%rowtype;
  v_my_name   text;
  v_my_gender text;
  v_pref      boolean;
begin
  select * into r from public.buddy_requests
   where id = p_request_id and to_user_id = v_me and status = 'pending'
   for update;
  if not found then
    raise exception 'الدعوة لم تعد متاحة';
  end if;

  if p_accept then
    if public.buddy_count(v_me) >= 3 then
      raise exception 'لديك ٣ رفقاء بالفعل';
    end if;
    if public.buddy_count(r.from_user_id) >= 3 then
      raise exception 'لدى الطرف الآخر ٣ رفقاء بالفعل';
    end if;
    update public.buddy_requests
       set status = 'accepted', responded_at = now()
     where id = p_request_id;

    -- Tell the sender their invitation was accepted (best-effort).
    begin
      select enabled into v_pref from public.notification_prefs
       where user_id = r.from_user_id and type = 'buddy_request';
      if coalesce(v_pref, true) then
        select coalesce(display_name, 'طالب علم'), gender
          into v_my_name, v_my_gender
          from public.profiles where id = v_me;
        insert into public.notifications (user_id, type, title, body, data)
        values (
          r.from_user_id,
          'buddy_request',
          case when v_my_gender = 'female'
            then 'قبِلت ' || v_my_name || ' دعوتك، وصارت رفيقتك في طلب العلم'
            else 'قبِل ' || v_my_name || ' دعوتك، وصار رفيقك في طلب العلم' end,
          '',
          jsonb_build_object('route', '/')
        );
      end if;
    exception when others then
      null;
    end;
  else
    update public.buddy_requests
       set status = 'declined', responded_at = now()
     where id = p_request_id;
  end if;
end;
$$;
grant execute on function public.respond_buddy_request(uuid, boolean) to authenticated;

-- End buddy relationships (either side may end an accepted pair; RLS alone
-- would only let the receiver update it). p_buddy_id null (legacy no-arg call)
-- ends ALL my accepted pairs AND withdraws my outgoing pendings; a specific
-- p_buddy_id ends ONLY that one pairing.
create or replace function public.cancel_buddy(p_buddy_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if p_buddy_id is null then
    update public.buddy_requests
       set status = 'cancelled', responded_at = now()
     where status = 'accepted'
       and (from_user_id = v_me or to_user_id = v_me);

    update public.buddy_requests
       set status = 'cancelled', responded_at = now()
     where status = 'pending' and from_user_id = v_me;
  else
    update public.buddy_requests
       set status = 'cancelled', responded_at = now()
     where status = 'accepted'
       and ((from_user_id = v_me and to_user_id = p_buddy_id)
         or (from_user_id = p_buddy_id and to_user_id = v_me));
  end if;
end;
$$;
grant execute on function public.cancel_buddy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 0016/0036 notify_buddy_on_completion — nudge EVERY accepted buddy on a
-- completion crossing. Each recipient keeps all existing guards independently:
-- their 'buddy_activity' pref, quiet hours 23:00–05:00 (UTC+3), and at most one
-- buddy_activity per recipient per local day. Gendered text preserved (0036).
-- ---------------------------------------------------------------------------
create or replace function public.notify_buddy_on_completion()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_buddy      uuid;
  v_pref       boolean;
  v_local_hour integer;
  v_gender     text;
  v_title      text;
begin
  if tg_op = 'UPDATE' and old.completed then
    return new;  -- already completed before this write
  end if;
  if not new.completed then
    return new;
  end if;

  v_local_hour := extract(hour from now() + interval '3 hours')::int;
  if v_local_hour >= 23 or v_local_hour < 5 then return new; end if;

  select gender into v_gender from public.profiles where id = new.user_id;
  v_title := case when v_gender = 'female'
    then 'رفيقتك أتمت درساً اليوم، فلعلك تدركين نصيبك من الأجر'
    else 'رفيقك أتم درساً اليوم، فلعلك تدرك نصيبك من الأجر' end;

  for v_buddy in select public.buddies_of(new.user_id) loop
    -- recipient's per-type pref (missing row = ON)
    select enabled into v_pref from public.notification_prefs
     where user_id = v_buddy and type = 'buddy_activity';
    if not coalesce(v_pref, true) then continue; end if;

    -- at most one buddy_activity per recipient per local day
    if exists (
      select 1 from public.notifications
       where user_id = v_buddy and type = 'buddy_activity'
         and created_at >= date_trunc('day', now() + interval '3 hours') - interval '3 hours'
    ) then
      continue;
    end if;

    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_buddy,
      'buddy_activity',
      v_title,
      '',
      jsonb_build_object('route', '/(student)/journey')
    );
  end loop;
  return new;
exception when others then
  return new;  -- a nudge must never break a playback save
end;
$$;

drop trigger if exists buddy_activity_on_completion on public.user_lecture_progress;
create trigger buddy_activity_on_completion
  after insert or update on public.user_lecture_progress
  for each row
  when (new.completed)
  execute function public.notify_buddy_on_completion();
