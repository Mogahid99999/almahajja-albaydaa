-- =============================================================================
-- 0177_phone_one_account.sql
-- المَحجّة البَيْضَاء — رقم واحد لحساب واحد بين الصيغتين القديمة والدولية.
--
-- New numbers are stored with their calling code. Older accounts may hold the
-- national digits only (a number over nine digits was stored as typed), so the
-- unique index cannot see that "8012345678" and "2348012345678" are one number.
--
-- phone_conflicts compares the two forms; a trigger on auth.users refuses a new
-- or changed phone that collides, and phone_registration_conflict lets the app
-- show a clear message first. Existing rows are never rewritten, and the trigger
-- only runs on a changed phone, so accounts that already overlap keep working.
--
-- Existing numbers cannot be converted blindly: a ten-digit number with no
-- calling code does not say which country it belongs to. Only the Egyptian
-- mobile shape identifies its country, so it matches +20 alone.
--
-- Storage (db-storage-engineering): no new rows or columns; forward checks use
-- the existing unique index on phone, the reverse check scans auth.users only
-- when a ten or eleven digit number is set.
-- Rollback: drop the trigger, then the three functions.
-- Append-only. Idempotent. After applying: node scripts/security-check.mjs
-- =============================================================================

create or replace function public.phone_conflicts(p_phone text, p_self uuid)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  d    text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  n    int  := length(d);
  c    text;
  i    int;
begin
  if n = 0 then
    return false;
  end if;
  if exists (select 1 from auth.users u where u.phone = d and u.id is distinct from p_self) then
    return true;
  end if;

  -- This number with its calling code; an older row may hold only the rest.
  for i in 1..3 loop
    c := substr(d, i + 1);
    if length(c) in (10, 11)
       and (c !~ '^1[0125][0-9]{8}$' or d like '20%')
       and exists (select 1 from auth.users u where u.phone = c and u.id is distinct from p_self) then
      return true;
    end if;
  end loop;

  -- An older build sending the national digits of a number already stored in full.
  if n in (10, 11) then
    if d ~ '^1[0125][0-9]{8}$' then
      return exists (select 1 from auth.users u where u.phone = '20' || d and u.id is distinct from p_self);
    end if;
    return exists (
      select 1 from auth.users u
       where length(u.phone) between n + 1 and n + 3
         and right(u.phone, n) = d
         and u.id is distinct from p_self
    );
  end if;
  return false;
end;
$$;
revoke all on function public.phone_conflicts(text, uuid) from public, anon, authenticated;

create or replace function public.phone_registration_conflict(p_phone text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.phone_conflicts(p_phone, auth.uid());
$$;
revoke all on function public.phone_registration_conflict(text) from public, anon;
grant execute on function public.phone_registration_conflict(text) to authenticated;

create or replace function public.auth_users_phone_guard()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.phone, '') = '' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.phone is not distinct from old.phone then
    return new;
  end if;
  if public.phone_conflicts(new.phone, new.id) then
    raise exception 'phone already registered' using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function public.auth_users_phone_guard() from public, anon, authenticated;

drop trigger if exists auth_users_phone_guard on auth.users;
create trigger auth_users_phone_guard
  before insert or update of phone on auth.users
  for each row execute function public.auth_users_phone_guard();
