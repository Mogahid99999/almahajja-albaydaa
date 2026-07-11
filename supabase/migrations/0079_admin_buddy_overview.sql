-- =============================================================================
-- 0079_admin_buddy_overview.sql
-- المَحجّة البَيْضَاء — V14 item 5: admin visibility into رفيق الدراسة.
--
-- One admin-gated DEFINER read returning a single jsonb:
--   enabled_count      — students who enabled the feature = non-null
--                        profiles.gender (the prerequisite to appear in buddy
--                        search, see 0015).
--   active_pairs_count — accepted pairs, de-duplicated on the unordered pair
--                        (least/greatest) so each pair counts exactly once.
--   pending_count      — invitations still awaiting a response.
--   pairs              — [{ a_name, b_name, since }] newest first. Names are
--                        resolved inside the DEFINER (profiles RLS is own-only).
--
-- Plain counts + a pair list — no ranking, per the platform's non-competitive
-- tone. 0039 EXECUTE hygiene re-asserted below.
--
-- Append-only — 0001–0078 are never edited. Idempotent.
-- =============================================================================

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
