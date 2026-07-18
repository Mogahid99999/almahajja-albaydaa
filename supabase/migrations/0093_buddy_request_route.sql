-- =============================================================================
-- 0093_buddy_request_route.sql
-- المَحجّة البَيْضَاء — item 1: route buddy INVITATION notifications to the new
-- dedicated requests page instead of Home.
--
-- send_buddy_request (invitee) and respond_buddy_request (sender, on ACCEPT)
-- both INSERT a 'buddy_request' notification whose `data.route` was '/'. Home
-- surfaces the invitation on the BuddyCard, but the owner wants a tap to land
-- directly on the new management page app/(student)/buddy-requests.tsx, which
-- lists incoming + outgoing requests with قبول/اعتذار/سحب الدعوة. The deep-link
-- handler in app/_layout.tsx already forwards `data.route` verbatim.
--
-- ONLY the `data.route` string changes ('/' → '/(student)/buddy-requests') in
-- the two notification INSERTs. Every other line is copied verbatim from the
-- live 0088-era definitions (buddy_count cap of 3, gendered wording, best-effort
-- notify, anonymity/gender guards) so this migration is a pure re-point.
--
-- NOTE: the buddy_activity (رفيقك أتم درساً) completion nudge in 0016 is left on
-- '/(student)/journey' — that is about activity, not a pending request.
--
-- Append-only migration — 0001–0092 are never edited. Idempotent.
-- After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- send_buddy_request — notify the invitee; route the tap to the requests page.
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
        jsonb_build_object('route', '/(student)/buddy-requests')
      );
    end if;
  exception when others then
    null;  -- a nudge must never break the invitation
  end;
end;
$$;
grant execute on function public.send_buddy_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- respond_buddy_request — on ACCEPT notify the sender; route to the requests page.
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
          jsonb_build_object('route', '/(student)/buddy-requests')
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
