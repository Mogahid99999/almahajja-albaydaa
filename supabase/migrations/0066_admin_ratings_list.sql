-- =============================================================================
-- 0066_admin_ratings_list.sql
-- Admin-facing list + delete for app_ratings (0065) — the average tile alone
-- doesn't let an admin read individual comments. Mirrors admin_list_feedback /
-- admin_delete_feedback (0061) for structure/gating.
--
-- Append-only — 0001–0065 are never edited. Idempotent.
-- =============================================================================

create or replace function public.admin_list_ratings()
returns table (
  id         uuid,
  stars      int,
  message    text,
  user_id    uuid,
  user_name  text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    r.id, r.stars, r.message, r.user_id,
    case when r.user_id is null then null
         else coalesce(p.display_name, 'طالب علم') end,
    r.created_at
  from public.app_ratings r
  left join public.profiles p on p.id = r.user_id
  order by r.created_at desc
  limit 500;
end;
$$;
grant execute on function public.admin_list_ratings() to authenticated;

create or replace function public.admin_delete_rating(p_rating_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  delete from public.app_ratings where id = p_rating_id;
end;
$$;
grant execute on function public.admin_delete_rating(uuid) to authenticated;
