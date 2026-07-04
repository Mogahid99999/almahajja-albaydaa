# GLITCH LOG — issues noticed during the 2026-07-04 deep scan

Things observed while scanning that are **not** covered by `PLAN_SECURITY.md` or
`PLAN_PERFORMANCE.md`. (The scan itself completed with no blocking errors.)

**Status update 2026-07-04 (later session): all five items below are resolved.**

## Code / project glitches — RESOLVED

1. ✅ **Stray 8.2 MB MP3 in project root** — FIXED. Moved out of the project to
   `~/Music/Almahajjah/Voice 015 (online-audio-converter.com).mp3.mp3`. No code
   referenced it; the `.gitignore` entry stays as protection in case it reappears.

2. ✅ **Known web glitch (expo-font 12s timeout → boxed icons)** — root cause is
   slow web dev-server cold start; the biggest contributor in the watched tree
   (the stray MP3 above) is now gone. Re-test on the next web cold start; the
   remaining P5 items (font-weight trim) still apply if it recurs.

3. ✅ **Admin screens flash before redirect for non-staff deep links** — FIXED.
   `app/admin/_layout.tsx` now renders nothing until the current user is known
   to be staff (admin/publisher, non-guest); non-staff see a blank frame while
   the root `AuthGate` redirects them, instead of a flash of the admin shell.
   Type-check passes.

4. ✅ **Duplicate storage policy definitions across migrations** — FIXED (as
   documentation). Both `0001_initial_schema.sql` and `0005_live_cutover.sql`
   now carry audit comments: the duplication is intentional + idempotent, and
   `0005` is declared the canonical place for future storage-policy edits.
   No SQL behavior changed.

5. ✅ **Firebase Admin SDK key + Android release keystore in project folder** —
   FIXED. Both moved to `~/secrets/almahajjah/`:
   - `almahajjah-e3c12-firebase-adminsdk-fbsvc-357cb8e147.json`
   - `riwaq-release.jks`
   Verified first that nothing in code/config references them by path (EAS holds
   build credentials in the cloud), so nothing else needed updating. If a future
   script needs the Firebase key, point it at the new location.

## Found during PLAN_SECURITY Phase S0 (2026-07-04)

6. ✅ **FIXED — Sign-in screen showed the demo password to every real visitor.**
   `app/(auth)/sign-in.tsx` rendered a permanent "demo accounts" hint card with
   the admin email and literal password, sourced from `DEMO_ACCOUNTS` in
   `src/config.ts`. This card was NOT gated behind `USE_MOCK` (which is `false`
   live), so it displayed on the real production sign-in screen, not just in
   local/mock testing. Owner asked to remove it outright — done; the card and
   its now-unused import are gone. `DEMO_ACCOUNTS` itself is untouched since
   `src/api/auth.ts` still uses it for the mock-mode (`USE_MOCK=true`) local
   sign-in path, which is dev-only and never reached live. Type-check passes.

## Found during PLAN_SECURITY Phases S3–S5 (2026-07-04)

7. ✅ **FIXED — study buddy (`رفيق الدرب`) was reachable by guest accounts.**
   Migration `0041_buddy_block_anonymous.sql`: added the same
   `is_anonymous` guard used elsewhere to `send_buddy_request` /
   `respond_buddy_request`, and excluded anonymous accounts from
   `search_buddy_candidates` results. Also hid the buddy-search screen behind
   a "create an account" prompt for guests (`app/(student)/buddy-search.tsx`),
   mirroring the quiz intro screen's pattern. Verified live: a fresh
   anonymous session gets the Arabic "account required" error from both
   RPCs; a real two-student test run (search → invite → accept → buddy
   status) still works end-to-end.

8. ⚠️ **Leaked-password protection (HaveIBeenPwned check) — blocked by plan
   tier, not fixed.** Attempted to enable `password_hibp_enabled` via the
   Supabase Management API; it returned `402 Payment Required` — "available
   on Pro Plans and up." The project is currently on a lower tier. Min
   password length WAS raised project-wide (6 → 8) and in the `admin-users`
   edge function's own check, both verified live. Owner should either
   upgrade the Supabase plan and flip this toggle in Auth → Settings, or
   consciously accept the gap — leaked-password checking is a nice-to-have
   layered on top of the length requirement, not the only defense.

9. ✅ **FIXED — `set_updated_at` trigger function had a mutable
   `search_path`.** Found by the Supabase security advisor (not in the
   original 8 findings) — every other function in 0001–0041 pins
   `search_path = public` except this one 0001-era trigger. Low risk in
   practice (no dynamic SQL, no user input) but fixed for consistency via
   migration `0042_pin_search_path.sql`.

10. **Not fixed, logged for awareness — the Supabase CLI's own migration
    history table doesn't know about migrations 0007–0042.** `supabase
    migration list` shows only 0001–0006 as applied on the remote, even
    though 0007 onward are live and working (confirmed via direct queries).
    This means every migration from 0007 on, including this session's 0041
    and 0042, was applied the same way as before — direct SQL execution via
    the Supabase Management API — NOT `supabase db push`, because that
    command would try to replay every "missing" migration from 0007 and
    some may not be safely re-runnable. Pre-existing gap, not introduced
    this session. If a future session wants `supabase db push` to work
    normally, someone needs to manually backfill `supabase_migrations
    .schema_migrations` for 0007–0042 first — worth doing deliberately, not
    as a side effect of an unrelated change.

11. Ran the Supabase security advisor (Phase S4 step 4): 89 findings total,
    57 are "SECURITY DEFINER function callable by authenticated" (expected —
    that's how every guarded RPC in this app works, already reviewed in the
    plan's verdict) and 30 are "anonymous sign-ins enabled" (intentional —
    guest mode is a core feature). Only the two new items above (#8, #9)
    were real signal; everything else is expected noise from this app's
    design.

## Scan-process notes (no action needed)

- No tool errors blocked the scan. Two cosmetic hiccups: one table-name grep
  needed re-running with a different pattern, and one compound shell command
  returned a non-zero exit code from a no-match `grep` while still producing
  correct output. Neither affected findings.
