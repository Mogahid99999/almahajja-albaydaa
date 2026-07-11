-- =============================================================================
-- 0074_admin_user_list_fixes.sql
-- المَحجّة البَيْضَاء — fix admin_user_list pagination + الفلاتر in إدارة المستخدمين.
--
-- Two bugs reported against /admin/users:
--
--   1. Duplicate React key on the FlatList ("Encountered two children with the
--      same key"). Root cause: `order by p.created_at desc` alone is not a
--      unique sort. Postgres does not guarantee stable ordering across two
--      separate LIMIT/OFFSET calls when several rows tie on created_at (bulk
--      inserts, seed scripts, admin-created accounts in the same request all
--      land on the same timestamp) — a row can be repeated across pages or
--      skipped. Fix: tie-break on `id` so the order is strictly unique and
--      OFFSET pagination is stable.
--
--   2. All four status filters ("المسجلين" / نشط / غير نشط / محظور) showed
--      wrong counts (e.g. "المسجلين" showed 6 when far more registered
--      accounts exist). Root cause is client-side (app/admin/users.tsx
--      filtered the already-paginated in-memory list, only ever seeing
--      whatever pages had been scrolled into view — see the fix in that
--      file), but the RPC had no way to filter server-side or report a true
--      total, which this migration adds:
--        - p_registered_only: pushes the "has email" filter into the WHERE
--          clause so pagination walks the full matching set, not a client
--          slice of "all users".
--        - p_status: pushes the derived active/inactive/banned filter down
--          the same way (via a wrapping query, since `status` itself is a
--          computed column, not a real one).
--        - total_count: total matching rows (window count over the same
--          filters, pre-LIMIT) so the UI can show an honest "X من Y" even
--          before every page has been fetched.
--
-- Signature changes (5 args instead of 3) — old 3-arg overload is dropped so
-- callers can't silently keep hitting the unfixed ordering.
-- Append-only — 0001–0073 are never edited. Idempotent.
-- =============================================================================

drop function if exists public.admin_user_list(text, int, int);

create or replace function public.admin_user_list(
  p_search          text default null,
  p_limit           int  default 100,
  p_offset          int  default 0,
  p_registered_only boolean default false,
  p_status          text default null  -- 'active' | 'inactive' | 'banned' | null (=all)
)
returns table (
  id                  uuid,
  display_name        text,
  email               text,
  phone               text,
  gender              text,
  role                text,
  created_at          timestamptz,
  last_opened_at      timestamptz,
  last_sign_in_at     timestamptz,
  banned_until        timestamptz,
  status              text,
  completed_lectures  bigint,
  passed_quizzes      bigint,
  current_streak      int,
  weekly_goal_target  int,
  weekly_goal_metric  text,
  total_count         bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select
      p.id,
      coalesce(nullif(p.display_name, ''), nullif(u.raw_user_meta_data->>'display_name','')) as display_name,
      u.email,
      u.phone,
      p.gender,
      p.role::text,
      p.created_at,
      p.last_opened_at,
      u.last_sign_in_at,
      u.banned_until,
      case
        when u.banned_until is not null and u.banned_until > now() then 'banned'
        when p.last_opened_at is null or p.last_opened_at < now() - interval '30 days' then 'inactive'
        else 'active'
      end as status,
      coalesce((select count(*) from public.user_lecture_progress pr
                  join public.lectures l on l.id = pr.lecture_id and l.status = 'published'
                 where pr.user_id = p.id and pr.completed), 0) as completed_lectures,
      coalesce((select count(distinct a.quiz_id) from public.quiz_attempts a
                 where a.user_id = p.id and a.passed), 0) as passed_quizzes,
      public.streak_for_user(p.id) as current_streak,
      g.target as weekly_goal_target,
      g.metric::text as weekly_goal_metric
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.weekly_goals g on g.user_id = p.id
    where public.is_admin()
      and (
        p_search is null or btrim(p_search) = ''
        or coalesce(p.display_name,'') ilike '%' || p_search || '%'
        or coalesce(u.email,'')        ilike '%' || p_search || '%'
        or coalesce(u.phone,'')        ilike '%' || p_search || '%'
      )
      and (not p_registered_only or u.email is not null)
  )
  select b.*, count(*) over () as total_count
    from base b
   where p_status is null or b.status = p_status
   order by b.created_at desc, b.id desc
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

-- `drop function` + `create` resets the grant to Postgres's default (EXECUTE
-- to PUBLIC), silently undoing 0039's execute hygiene for this function —
-- revoke that default before re-granting, same as 0039 does for every
-- client-facing RPC.
revoke execute on function public.admin_user_list(text, int, int, boolean, text) from public, anon;
grant execute on function public.admin_user_list(text, int, int, boolean, text) to authenticated;
