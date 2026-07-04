-- =============================================================================
-- 0036_gendered_buddy_wording.sql
-- المَحجّة البَيْضَاء — رفيقك → رفيقتك for female buddies (user request).
--
-- Buddy matching is same-gender (0015), so when the ACTOR (the completing /
-- inviting / accepting student) is female, the recipient is female too and the
-- possessive must be «رفيقتك» with feminine verb agreement. Re-creates the
-- three server-side notification texts + the get_buddy_status display-name
-- fallback; everything else in each function is unchanged from 0015/0016/0020.
--
-- Append-only — 0001–0035 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0016 notify_buddy_on_completion — «رفيقتك أتمت درساً اليوم…» when the
-- completer is female.
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

  v_buddy := public.buddy_of(new.user_id);
  if v_buddy is null then return new; end if;

  select enabled into v_pref from public.notification_prefs
   where user_id = v_buddy and type = 'buddy_activity';
  if not coalesce(v_pref, true) then return new; end if;

  v_local_hour := extract(hour from now() + interval '3 hours')::int;
  if v_local_hour >= 23 or v_local_hour < 5 then return new; end if;

  if exists (
    select 1 from public.notifications
     where user_id = v_buddy and type = 'buddy_activity'
       and created_at >= date_trunc('day', now() + interval '3 hours') - interval '3 hours'
  ) then
    return new;
  end if;

  select gender into v_gender from public.profiles where id = new.user_id;
  v_title := case when v_gender = 'female'
    then 'رفيقتك أتمت درساً اليوم، فلعلك تدركين نصيبك من الأجر'
    else 'رفيقك أتم درساً اليوم، فلعلك تدرك نصيبك من الأجر' end;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_buddy,
    'buddy_activity',
    v_title,
    '',
    jsonb_build_object('route', '/(student)/journey')
  );
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

-- ---------------------------------------------------------------------------
-- 0020 send_buddy_request — «دعتك فلانة لتكون رفيقتك…» when the inviter is
-- female (invitee shares the gender — enforced above the insert).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 0020 respond_buddy_request — «قبِلت فلانة دعوتك، وصارت رفيقتك…» when the
-- accepter is female.
-- ---------------------------------------------------------------------------
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
    if public.buddy_of(v_me) is not null or public.buddy_of(r.from_user_id) is not null then
      raise exception 'يوجد رفيق دراسة بالفعل';
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

-- ---------------------------------------------------------------------------
-- 0015 get_buddy_status — feminine display-name fallback for female buddies.
-- ---------------------------------------------------------------------------
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
    coalesce(p.display_name, case when p.gender = 'female' then 'رفيقتك' else 'رفيقك' end),
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
