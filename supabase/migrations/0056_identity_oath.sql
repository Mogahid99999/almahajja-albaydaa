-- =============================================================================
-- 0056_identity_oath.sql
-- المَحجّة البَيْضَاء — Item 10: registration identity-oath + locked name/gender.
--
-- Registration now shows a one-time oath modal (client-side, app/(auth)/register.tsx)
-- before an account is created: the student affirms the name + gender they
-- entered are correct, because both become PERMANENTLY read-only right after
-- (app/(student)/edit-profile.tsx no longer offers them for editing, for any
-- account, going forward). This migration only adds server-side proof that
-- the oath was accepted — `identity_oath_accepted_at`, set once on first
-- acceptance and never overwritten afterward (an ordinary profile edit never
-- re-triggers it).
--
-- set_own_profile() gains a third parameter (p_oath_accepted). `create or
-- replace function` cannot change a parameter list in place, so the old
-- two-arg signature is dropped first so exactly one set_own_profile(...)
-- exists afterward — 0015's body is reproduced in full (unchanged), plus the
-- new column plumbing.
--
-- Append-only migration — 0001–0055 are never edited. Idempotent.
-- =============================================================================

alter table public.profiles
  add column if not exists identity_oath_accepted_at timestamptz null;

drop function if exists public.set_own_profile(text, text);

create or replace function public.set_own_profile(
  p_gender        text default null,
  p_display_name  text default null,
  p_oath_accepted boolean default false
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_gender is not null and p_gender not in ('male', 'female') then
    raise exception 'قيمة غير صالحة';
  end if;
  update public.profiles
     set gender       = coalesce(p_gender, gender),
         display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
         identity_oath_accepted_at =
           coalesce(identity_oath_accepted_at, case when p_oath_accepted then now() else null end)
   where id = auth.uid();
end;
$$;

revoke execute on function public.set_own_profile(text, text, boolean) from public, anon;
grant execute on function public.set_own_profile(text, text, boolean) to authenticated;
