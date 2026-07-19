-- =============================================================================
-- 0115 · Notify the goal creator when the buddy accepts/declines (V20 · §10/§13)
--
-- respond_buddy_goal (0112) flipped the goal to active/declined but told the
-- CREATOR nothing. This replaces it to notify the creator (→ push via the
-- notifications webhook) so an accepted/declined shared-goal reaches them outside
-- the app, matching every other buddy event. Route → journey (where the active
-- goal now shows).
--
-- Append-only, idempotent. Only the notification insert is new.
-- =============================================================================

create or replace function public.respond_buddy_goal(p_goal_id uuid, p_accept boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  g public.buddy_goals%rowtype;
  v_my_name text;
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

  -- Tell the creator (g.a_user_id) the outcome (→ push).
  select display_name into v_my_name from public.profiles where id = v_me;
  insert into public.notifications (user_id, type, title, body, data)
    values (
      g.a_user_id, 'buddy_activity',
      case when p_accept
        then coalesce(v_my_name, 'رفيقك') || ' قبِل هدفكما المشترك'
        else coalesce(v_my_name, 'رفيقك') || ' اعتذر عن الهدف المشترك' end,
      '',
      jsonb_build_object('route', '/(student)/journey')
    );
end;
$$;
revoke all on function public.respond_buddy_goal(uuid, boolean) from public, anon;
grant execute on function public.respond_buddy_goal(uuid, boolean) to authenticated;
