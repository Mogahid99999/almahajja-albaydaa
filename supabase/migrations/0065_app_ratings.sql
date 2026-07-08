-- =============================================================================
-- 0065_app_ratings.sql
-- المَحجّة البَيْضَاء — star rating for the app itself (not lecture ratings).
-- One rating per user (upsert on re-submit), optional free-text message.
-- Design mirrors feedback (0061): own-row insert/select via RLS, no direct
-- update/delete — writes only through submit_rating (DEFINER RPC). Admin-only
-- aggregate via admin_ratings_summary.
--
-- Append-only — 0001–0064 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.app_ratings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  stars      int not null check (stars between 1 and 5),
  message    text,
  created_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists app_ratings_user_idx on public.app_ratings (user_id);

alter table public.app_ratings enable row level security;

drop policy if exists app_ratings_select_own_or_admin on public.app_ratings;
create policy app_ratings_select_own_or_admin on public.app_ratings
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select on public.app_ratings to authenticated;

-- ---------------------------------------------------------------------------
-- submit_rating — anyone with a session (guest or registered) may rate.
-- Upserts so a re-submit (e.g. after a bug fix) simply updates the same row
-- instead of erroring; the client stops prompting after the first success.
-- ---------------------------------------------------------------------------
create or replace function public.submit_rating(
  p_stars   int,
  p_message text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'يلزم وجود جلسة';
  end if;
  if p_stars < 1 or p_stars > 5 then
    raise exception 'تقييم غير صالح';
  end if;

  insert into public.app_ratings (user_id, stars, message)
  values (v_me, p_stars, nullif(btrim(coalesce(p_message, '')), ''))
  on conflict (user_id) do update
    set stars = excluded.stars,
        message = excluded.message,
        created_at = now();
end;
$$;
grant execute on function public.submit_rating(int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_ratings_summary — average + count, admin-only (raises for non-admins,
-- consistent with every other admin_* RPC rather than silently returning
-- empty rows).
-- ---------------------------------------------------------------------------
create or replace function public.admin_ratings_summary()
returns table (avg_stars numeric, total_ratings bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  return query
  select coalesce(avg(stars), 0)::numeric(3, 2), count(*)
  from public.app_ratings;
end;
$$;
grant execute on function public.admin_ratings_summary() to authenticated;
