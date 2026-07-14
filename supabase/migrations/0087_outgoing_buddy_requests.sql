-- =============================================================================
-- 0087_outgoing_buddy_requests.sql
-- المَحجّة البَيْضَاء — رفيق الدراسة: list + withdraw MY outgoing invitations.
--
-- The Home buddy card showed only a boolean "طلبك قيد الانتظار" with no way to
-- withdraw a specific invite. This adds:
--   * get_outgoing_buddy_requests() — my pending outgoing invites WITH the
--     invitee's display name (profiles is own+admin-only RLS, so the name must
--     come through a DEFINER read — mirror of get_incoming_buddy_requests 0015).
--   * cancel_buddy_request(p_request_id) — withdraw ONE of my pending outgoing
--     invites (only my own, only while still pending).
--
-- Append-only, idempotent. 0001–0086 never edited.
-- =============================================================================

create or replace function public.get_outgoing_buddy_requests()
returns table (id uuid, to_display_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, coalesce(p.display_name, 'طالب علم'), r.created_at
    from public.buddy_requests r
    join public.profiles p on p.id = r.to_user_id
   where r.from_user_id = auth.uid() and r.status = 'pending'
   order by r.created_at desc;
$$;
revoke all on function public.get_outgoing_buddy_requests() from public, anon;
grant execute on function public.get_outgoing_buddy_requests() to authenticated;

-- Withdraw ONE pending outgoing invite (mine only). RLS already lets a sender
-- update their own pending row (0015), but a DEFINER RPC keeps the client thin
-- and the semantics explicit.
create or replace function public.cancel_buddy_request(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.buddy_requests
     set status = 'cancelled', responded_at = now()
   where id = p_request_id
     and from_user_id = auth.uid()
     and status = 'pending';
end;
$$;
grant execute on function public.cancel_buddy_request(uuid) to authenticated;
