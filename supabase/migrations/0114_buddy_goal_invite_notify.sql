-- =============================================================================
-- 0114 · Notify the invited buddy of a shared-goal invitation (V20 · §10/§13)
--
-- create_buddy_goal (0112) created the pending goal but sent NO notification, so
-- the invited buddy learned about it only if they happened to open the app. This
-- replaces the function to ALSO insert a `buddy_activity` notification for the
-- invitee — which the existing notifications→push webhook (notify-on-publish)
-- turns into a real push, so the invitation arrives outside the app like every
-- other buddy event. Route points at the visible invitations page.
--
-- Append-only, idempotent. Only the notification insert + route are new.
-- =============================================================================

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
  v_my_name text;
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

  -- Notify the invited buddy (→ push via the notifications webhook). Route to the
  -- invitations page where they can accept/decline (§12).
  select display_name into v_my_name from public.profiles where id = v_me;
  insert into public.notifications (user_id, type, title, body, data)
    values (
      p_buddy_id, 'buddy_activity',
      coalesce(v_my_name, 'رفيقك') || ' دعاك إلى هدف مشترك',
      '',
      jsonb_build_object('route', '/(student)/buddy-requests')
    );

  return v_id;
end;
$$;
revoke all on function public.create_buddy_goal(uuid, text, integer, integer) from public, anon;
grant execute on function public.create_buddy_goal(uuid, text, integer, integer) to authenticated;
