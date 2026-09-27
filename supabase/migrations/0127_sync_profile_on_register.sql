-- =============================================================================
-- 0127_sync_profile_on_register.sql
-- المَحجّة البَيْضَاء — BUGFIX: registered students with no name/gender in profiles.
--
-- register() (src/api/auth.ts) links a guest in place with updateUser()
-- (phone + password + user_metadata {display_name, gender}) and only THEN, as a
-- separate last step, calls set_own_profile to copy name/gender/oath into
-- public.profiles. On a weak mobile connection that last request was lost:
-- 5 accounts (2026-09-23 → 27) have a phone + password + metadata gender but an
-- empty profile — no name in the admin panel, no gender for رفيق الدراسة /
-- قسم النساء, no oath timestamp.
--
-- Fix: do the copy server-side, in the same transaction as the auth update, so
-- it no longer depends on the client surviving one more round trip.
--   * name/gender: filled from user_metadata only where the profile field is
--     still NULL (never overwrites; set_own_profile/edit-profile stay the
--     authority), on the guest→registered flip or any metadata change of a
--     registered user.
--   * oath: stamped ONLY on the guest→registered flip — the client shows the
--     oath modal before register() can run. Legacy pre-oath accounts editing
--     their profile are NOT silently oath-locked.
--   * Never blocks auth: any error is swallowed with a WARNING, because a
--     failing trigger here would fail GoTrue's updateUser = broken sign-up.
-- Plus a one-time backfill of the stuck accounts.
--
-- Append-only. Idempotent. After applying: run `node scripts/security-check.mjs`.
-- =============================================================================

create or replace function public.sync_profile_from_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name   text := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  v_gender text := new.raw_user_meta_data ->> 'gender';
  v_became_registered boolean := coalesce(old.is_anonymous, false) and not coalesce(new.is_anonymous, false);
begin
  if v_gender is not null and v_gender not in ('male', 'female') then
    v_gender := null;
  end if;

  begin
    update public.profiles p
       set display_name = coalesce(p.display_name, v_name),
           gender       = coalesce(p.gender, v_gender),
           identity_oath_accepted_at = case
             when v_became_registered then coalesce(p.identity_oath_accepted_at, now())
             else p.identity_oath_accepted_at
           end
     where p.id = new.id
       and (
         (p.display_name is null and v_name is not null)
         or (p.gender is null and v_gender is not null)
         or (v_became_registered and p.identity_oath_accepted_at is null)
       );
  exception when others then
    raise warning 'sync_profile_from_auth_user(%) skipped: %', new.id, sqlerrm;
  end;
  return new;
end; $$;

revoke all on function public.sync_profile_from_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_registered_sync_profile on auth.users;
create trigger on_auth_user_registered_sync_profile
  after update on auth.users
  for each row
  when (
    not coalesce(new.is_anonymous, false)
    and (
      old.is_anonymous is distinct from new.is_anonymous
      or old.raw_user_meta_data is distinct from new.raw_user_meta_data
    )
  )
  execute function public.sync_profile_from_auth_user();

-- One-time backfill: registered accounts that lost the client's final sync
-- since the 2026-09-23 release. Fills only NULL fields; stamps the oath with
-- the registration time (they passed the oath modal to get this far).
update public.profiles p
   set display_name = coalesce(p.display_name, nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '')),
       gender       = coalesce(p.gender, case when u.raw_user_meta_data ->> 'gender' in ('male', 'female')
                                              then u.raw_user_meta_data ->> 'gender' end),
       identity_oath_accepted_at = coalesce(p.identity_oath_accepted_at, u.updated_at)
  from auth.users u
 where u.id = p.id
   and not u.is_anonymous
   and u.updated_at >= '2026-09-23'
   and p.identity_oath_accepted_at is null
   and p.display_name is null
   and nullif(btrim(u.raw_user_meta_data ->> 'display_name'), '') is not null;
