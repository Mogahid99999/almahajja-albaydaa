-- =============================================================================
-- 0041_buddy_block_anonymous.sql
-- المَحجّة البَيْضَاء — Security S3: guest accounts cannot use رفيق الدرب
-- (study buddy).
--
-- A guest (anonymous) session is `authenticated` for RLS purposes and could
-- set gender + display name via set_own_profile (0015), then appear in buddy
-- search and send/accept requests — creating ghost pairs with real students.
-- This migration adds the same guard already used in start_quiz_attempt
-- (0017), ask_question (0028), and add_lecture_benefit (0030):
--   `if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise ...`
--
-- Re-creates the 0020 bodies of send_buddy_request / respond_buddy_request
-- with the guard added, and the 0015 body of search_buddy_candidates with an
-- exclusion for anonymous accounts appearing as candidates. Everything else
-- in each function is unchanged.
--
-- Append-only migration — 0001–0040 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- send_buddy_request — block anonymous senders (0020 body + guard)
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
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'يلزم إنشاء حساب لاستخدام رفيق الدرب';
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
-- respond_buddy_request — block anonymous responders (0020 body + guard)
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
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'يلزم إنشاء حساب لاستخدام رفيق الدرب';
  end if;

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
-- search_buddy_candidates — exclude anonymous accounts from results (0015 body)
-- ---------------------------------------------------------------------------
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
     and not coalesce((select u.is_anonymous from auth.users u where u.id = p.id), false)
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
