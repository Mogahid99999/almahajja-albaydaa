-- =============================================================================
-- 0119_admin_end_buddy_pair.sql
-- المَحجّة البَيْضَاء — let an admin end an active رفيق الدراسة pairing from the
-- /admin/buddies screen.
--
-- Two changes, both admin-gated DEFINER (profiles/buddy_requests RLS is own-only):
--
--   1. admin_buddy_overview() — now also returns a_id / b_id per pair so the
--      client can identify which accepted pairing to end. Counts and ordering
--      are unchanged from 0079.
--
--   2. admin_end_buddy_pair(p_a, p_b) — cancels the accepted buddy_requests row
--      between the two users (either direction), mirroring cancel_buddy's
--      status='cancelled' + responded_at=now() semantics (0082). Idempotent:
--      ending an already-ended pair simply updates nothing. Admins only.
--
-- Append-only migration — 0001–0118 are never edited. Idempotent.
-- =============================================================================

-- 1. Overview now carries the pair member ids ------------------------------------
create or replace function public.admin_buddy_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;

  with pairs as (
    select least(r.from_user_id, r.to_user_id)    as a,
           greatest(r.from_user_id, r.to_user_id) as b,
           max(r.responded_at)                    as since
      from public.buddy_requests r
     where r.status = 'accepted'
     group by 1, 2
  )
  select jsonb_build_object(
    'enabled_count', (select count(*) from public.profiles p
                       where p.role = 'student' and p.gender is not null),
    'active_pairs_count', (select count(*) from pairs),
    'pending_count', (select count(*) from public.buddy_requests r
                       where r.status = 'pending'),
    'pairs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'a_id',   pr.a,
               'b_id',   pr.b,
               'a_name', coalesce(pa.display_name, 'طالب علم'),
               'b_name', coalesce(pb.display_name, 'طالب علم'),
               'since',  pr.since
             ) order by pr.since desc nulls last)
        from pairs pr
        join public.profiles pa on pa.id = pr.a
        join public.profiles pb on pb.id = pr.b
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
revoke execute on function public.admin_buddy_overview() from public, anon;
grant execute on function public.admin_buddy_overview() to authenticated;

-- 2. Admin ends an accepted pairing ----------------------------------------------
create or replace function public.admin_end_buddy_pair(p_a uuid, p_b uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;

  update public.buddy_requests
     set status = 'cancelled', responded_at = now()
   where status = 'accepted'
     and ((from_user_id = p_a and to_user_id = p_b)
       or (from_user_id = p_b and to_user_id = p_a));
end;
$$;
revoke execute on function public.admin_end_buddy_pair(uuid, uuid) from public, anon;
grant execute on function public.admin_end_buddy_pair(uuid, uuid) to authenticated;
