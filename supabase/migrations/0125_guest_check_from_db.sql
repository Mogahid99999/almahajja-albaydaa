-- =============================================================================
-- 0125_guest_check_from_db.sql
-- المَحجّة البَيْضَاء — a student who has JUST registered is still treated as a
-- guest for up to an hour: «تعذّر إرسال السؤال».
--
-- THE BUG
-- Registration links the guest's anonymous account in place with
-- `supabase.auth.updateUser(...)` (src/api/auth.ts → register). auth.users
-- flips to is_anonymous = false at once, and the client's user object says
-- "registered", so the app shows the question composer. But updateUser does
-- NOT mint a new access token: the session keeps the JWT issued while the
-- user was a guest, whose `is_anonymous` claim stays TRUE until the next
-- auto-refresh (up to the 1 h token lifetime). ask_question gated on that
-- claim — `auth.jwt() ->> 'is_anonymous'` — so it raised
-- «يلزم إنشاء حساب لطرح سؤال» at a student who had, in fact, just made one.
--
-- Seen on prod, last 24 h: 26 ask_question calls failed, 3 succeeded. All 26
-- were that exact error, from 4 students — every one a registered account
-- now, each rejected 1.5–12 minutes after registering, retrying up to 13
-- times, none of whom has ever managed to post a question. The app showed
-- only the generic «تعذّر إرسال السؤال», so nobody could tell why.
--
-- The same stale-claim check sat in four more places, so a new student also
-- could not start a quiz, share a فائدة, or save a private lesson note during
-- that first hour:
--   start_quiz_attempt, add_lecture_benefit        (functions)
--   lecture_notes_write, lecture_notes_update       (RLS policies)
--
-- THE FIX
-- Ask the database, not the token. auth.users.is_anonymous is updated the
-- moment the account is linked, so `public.is_guest()` reads it for the
-- caller. Server-side only — every installed app is fixed without a release.
-- A real guest is still a guest in auth.users, so every guest gate holds
-- (scripts/security-check.mjs pins ask_question / start_quiz_attempt /
-- add_lecture_benefit as guest-rejected).
--
-- The three functions are rewritten IN PLACE from their live definitions,
-- swapping only that one expression. Prod, staging and the repo are known to
-- have drifted (see prod-migration-drift), so reproducing a body from the
-- repo here could silently roll back a live change; this touches nothing else.
--
-- Append-only, idempotent. Never edit 0001–0124.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The single source of truth for "is the caller a guest?". No row (no session,
-- deleted user) counts as a guest, so the default is the safe one: deny.
-- ---------------------------------------------------------------------------
create or replace function public.is_guest()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_anonymous from auth.users u where u.id = auth.uid()),
    true
  );
$$;

comment on function public.is_guest() is
  'True when the caller is an anonymous (guest) account, read from auth.users — NOT from the JWT claim, which stays true until the token refreshes after a guest registers (0125).';

-- Reachable from RLS for signed-in callers only; anon never had these writes.
revoke all on function public.is_guest() from public;
revoke all on function public.is_guest() from anon;
grant execute on function public.is_guest() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Functions: swap the stale claim check for is_guest(), nothing else.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn      text;
  v_def     text;
  v_new     text;
  c_claim   constant text := 'coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false)';
begin
  foreach v_fn in array array['ask_question', 'start_quiz_attempt', 'add_lecture_benefit'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = v_fn;

    if v_def is null then
      raise exception '0125: public.% does not exist on this project', v_fn;
    end if;

    if position('public.is_guest()' in v_def) > 0 then
      continue;  -- already migrated (idempotent re-run)
    end if;

    v_new := replace(v_def, c_claim, 'public.is_guest()');
    if v_new = v_def then
      -- The expected guard isn't there: refuse rather than guess, so a drifted
      -- body is looked at by a human instead of being left half-fixed.
      raise exception '0125: guest check not found in public.% — inspect it by hand', v_fn;
    end if;

    execute v_new;  -- CREATE OR REPLACE keeps its grants, owner and settings
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- lecture_notes: same predicates as before, guest test moved to is_guest().
-- `(select …)` makes Postgres evaluate it once per statement, not per row.
-- ---------------------------------------------------------------------------
drop policy if exists lecture_notes_write on public.lecture_notes;
create policy lecture_notes_write on public.lecture_notes
  for insert to authenticated
  with check (user_id = auth.uid() and not (select public.is_guest()));

drop policy if exists lecture_notes_update on public.lecture_notes;
create policy lecture_notes_update on public.lecture_notes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and not (select public.is_guest()));

-- ---------------------------------------------------------------------------
-- Nothing may still trust the claim.
-- ---------------------------------------------------------------------------
do $$
declare v_left text;
begin
  select string_agg(name, ', ') into v_left from (
    select p.proname as name
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and pg_get_functiondef(p.oid) ilike '%jwt()%is_anonymous%'
    union all
    select tablename || '.' || policyname
      from pg_policies
     where coalesce(qual, '') || coalesce(with_check, '') ilike '%jwt()%is_anonymous%'
  ) s;
  if v_left is not null then
    raise exception '0125: still reading the is_anonymous JWT claim: %', v_left;
  end if;
end $$;
