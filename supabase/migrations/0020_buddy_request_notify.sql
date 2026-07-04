-- =============================================================================
-- 0020_buddy_request_notify.sql
-- المَحجّة البَيْضَاء — V4 fix (Issue 4): deliver a buddy invitation.
--
-- Re-defines two 0015 DEFINER functions so they also INSERT a
-- `public.notifications` row — which rides the existing pipeline (0009 webhook →
-- notify-on-publish Edge Function → Expo Push → FCM) to reach the recipient even
-- with the app closed, and shows up in the in-app الإشعارات inbox:
--
--   * send_buddy_request     → notifies the INVITEE  ("دعاك فلان …")
--   * respond_buddy_request  → on ACCEPT, notifies the original SENDER
--                              ("قبِل فلان دعوتك …")
--
-- Both notifications are type 'buddy_request' (enum value added in 0019), honour
-- the recipient's per-type pref (missing row = ON, same model as 0016), and
-- carry `data → { route: '/(student)' }` so a tap lands on Home, where the
-- BuddyCard surfaces the incoming invitation (قبول/اعتذار) or the now-active
-- buddy. The insert is wrapped so a notification hiccup can NEVER fail the
-- invite / accept itself.
--
-- Everything else in the two functions is unchanged from 0015.
-- Append-only migration — 0001–0019 are never edited. Idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- send_buddy_request — unchanged invariants, plus a notification for the invitee
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
        'دعاك ' || v_my_name || ' ليكون رفيقك في طلب العلم',
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
-- respond_buddy_request — unchanged accept/decline, plus a notification back to
-- the original sender when the invitation is ACCEPTED.
-- ---------------------------------------------------------------------------
create or replace function public.respond_buddy_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me      uuid := auth.uid();
  r         public.buddy_requests%rowtype;
  v_my_name text;
  v_pref    boolean;
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
        select coalesce(display_name, 'طالب علم') into v_my_name
          from public.profiles where id = v_me;
        insert into public.notifications (user_id, type, title, body, data)
        values (
          r.from_user_id,
          'buddy_request',
          'قبِل ' || v_my_name || ' دعوتك، وصار رفيقك في طلب العلم',
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
