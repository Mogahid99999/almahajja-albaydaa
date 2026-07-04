-- =============================================================================
-- 0030_lecture_benefits.sql
-- المَحجّة البَيْضَاء — V6 Feature C: فوائد الدارسين (anonymous shared benefits).
--
-- Every فائدة is shown to everyone WITHOUT any author name. The author identity
-- lives only in `user_id` and crosses the wire exclusively through is_admin()
-- RPCs (moderation + ban). The public read is a DEFINER RPC that never selects
-- user_id — anonymity enforced in SQL, not in the client.
--
--   * author may delete their OWN benefit (RLS delete + delete_own_benefit)
--   * admin may hide/delete ANY + resolve the author (admin_list_benefits)
--
-- Append-only — 0001–0029 are never edited. Idempotent.
-- =============================================================================

create table if not exists public.lecture_benefits (
  id         uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  body       text not null,
  status     text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);

create index if not exists lecture_benefits_lecture_idx
  on public.lecture_benefits (lecture_id, status, created_at desc);
create index if not exists lecture_benefits_user_idx
  on public.lecture_benefits (user_id);

-- RLS: the shared list never comes from a raw select (that would expose
-- user_id) — it comes from get_lecture_benefits below. Direct access is only
-- own rows (+ admin for moderation).
alter table public.lecture_benefits enable row level security;

drop policy if exists lecture_benefits_insert_own on public.lecture_benefits;
create policy lecture_benefits_insert_own on public.lecture_benefits
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists lecture_benefits_select_own_or_admin on public.lecture_benefits;
create policy lecture_benefits_select_own_or_admin on public.lecture_benefits
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists lecture_benefits_delete_own_or_admin on public.lecture_benefits;
create policy lecture_benefits_delete_own_or_admin on public.lecture_benefits
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select, insert, delete on public.lecture_benefits to authenticated;

-- ---------------------------------------------------------------------------
-- Public read — id/body/created_at/is_mine ONLY. No author identity, ever.
-- ---------------------------------------------------------------------------
create or replace function public.get_lecture_benefits(p_lecture_id uuid)
returns table (
  id         uuid,
  body       text,
  is_mine    boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select b.id, b.body, b.user_id = auth.uid(), b.created_at
  from public.lecture_benefits b
  where b.lecture_id = p_lecture_id
    and b.status = 'visible'
  order by b.created_at desc
  limit 200;
$$;
grant execute on function public.get_lecture_benefits(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- add_lecture_benefit — registered accounts only (server-side gate).
-- ---------------------------------------------------------------------------
create or replace function public.add_lecture_benefit(p_lecture_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  if v_me is null then
    raise exception 'يلزم تسجيل الدخول';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'يلزم إنشاء حساب لمشاركة فائدة';
  end if;
  if not exists (
    select 1 from public.lectures l
     where l.id = p_lecture_id and l.status = 'published'
  ) then
    raise exception 'الدرس غير متاح';
  end if;
  if length(v_body) < 3 or length(v_body) > 1000 then
    raise exception 'نص الفائدة يجب أن يكون بين ٣ و ١٠٠٠ حرف';
  end if;

  insert into public.lecture_benefits (lecture_id, user_id, body)
  values (p_lecture_id, v_me, v_body)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.add_lecture_benefit(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_own_benefit — the author removes their own فائدة.
-- ---------------------------------------------------------------------------
create or replace function public.delete_own_benefit(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.lecture_benefits
   where id = p_id and user_id = auth.uid();
end;
$$;
grant execute on function public.delete_own_benefit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin moderation — the ONLY place the author identity is resolved.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_benefits(p_lecture_id uuid default null)
returns table (
  id            uuid,
  lecture_id    uuid,
  lecture_title text,
  body          text,
  status        text,
  author_id     uuid,
  author_name   text,
  author_email  text,
  created_at    timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  return query
  select
    b.id, b.lecture_id, l.title, b.body, b.status,
    b.user_id,
    coalesce(p.display_name, 'طالب علم'),
    u.email::text,
    b.created_at
  from public.lecture_benefits b
  join public.lectures l on l.id = b.lecture_id
  left join public.profiles p on p.id = b.user_id
  left join auth.users u on u.id = b.user_id
  where (p_lecture_id is null or b.lecture_id = p_lecture_id)
  order by b.created_at desc
  limit 500;
end;
$$;
grant execute on function public.admin_list_benefits(uuid) to authenticated;

create or replace function public.admin_set_benefit_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'غير مصرح';
  end if;
  if p_status not in ('visible', 'hidden') then
    raise exception 'حالة غير صالحة';
  end if;
  update public.lecture_benefits set status = p_status where id = p_id;
end;
$$;
grant execute on function public.admin_set_benefit_status(uuid, text) to authenticated;
