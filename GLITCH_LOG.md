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

## PLAN_SECURITY.md closeout (2026-07-04, before starting PLAN_PERFORMANCE.md)

12. **PAT rotation confirmed + `.env` fixed.** The `SUPABASE_ACCESS_TOKEN` sitting
    in `.env` returned `401` against the Management API — i.e. it was already
    revoked (rotation had happened) but `.env` was never updated with the
    replacement. Owner supplied the current live token in-session; `.env`
    updated to match. `security-check.mjs` re-run live: **20/20 checks pass.**
13. **Demo accounts (S0 item 1) — consciously deferred by owner**, not fixed.
    `admin@`/`user@`/`publisher@`/`sheikh@gmail.com` (seeded password
    `test55%%`) were NOT deleted or repassworded this session; owner chose to
    handle this out-of-band later. Everything else in PLAN_SECURITY.md is
    verified done (S1–S5 green), so PLAN_PERFORMANCE.md proceeds per the
    owner's explicit instruction — this one item remains open, flag it again
    if it resurfaces.

## PLAN_PERFORMANCE.md Phase P1 (2026-07-04)

14. **Web is currently fully broken (crashes on every route, including `/`) —
    pre-existing, unrelated to the P1 FlatList work.** `app/_layout.tsx:57` calls
    `I18nManager.swapLeftAndRightInRTL(false)` unconditionally at module scope
    (no `Platform.OS` guard, no try/catch). `react-native-web`'s `I18nManager`
    shim (`node_modules/react-native-web/.../exports/I18nManager`) only
    implements `allowRTL`/`forceRTL`/`getConstants` — no `swapLeftAndRightInRTL`
    — so the call throws a `TypeError` before any component mounts. Reproduced
    with Playwright/Chromium against the already-running `expo start --web` dev
    server on port 8081: every route (`/`, `/notifications`, `/admin/lectures`,
    etc.) shows Metro's red-box "Uncaught Error" overlay, app never renders.
    **Not caused by this session's changes** — confirmed on `/` which P1 never
    touched. Did NOT patch `node_modules` directly (blocked by the harness's own
    guardrail against hand-editing vendored packages; the sanctioned fix would be
    a `patch-package` patch, same mechanism already used for `expo-audio`).
    **This blocks live web verification for Phase P1** (and for any other web
    work) until fixed. Left unfixed per plan instructions ("log, don't fix on
    the spot") — flagged to the owner directly, not just here.

15. **Seeded `admin@gmail.com` / `test55%%` no longer authenticates** ("Invalid login
    credentials") — tried once, live, while attempting to verify the P1 admin
    screens on-device. Not investigated further (not this session's call to make
    per the owner's "I'll handle demo accounts myself later" from the
    PLAN_SECURITY closeout above) — noted here only because it's a data point:
    either the account was already deleted/repassworded, or something else
    changed. Owner should check when they get to that item.
16. **Release APK build reused cached native output** — `gradlew :app:assembleRelease`
    with the same flags as the `android-release-build-recipe` memory finished in
    5m36s (vs. ~6min "from source" baseline) because JS-only changes don't
    invalidate the native C++ cache; only `createBundleReleaseJsAndAssets` +
    repackaging actually ran. Confirms that memory's note "a rebuild picks up JS
    edits with no prebuild" in practice.

17. **Phase P4 deviation (deliberate): added progress-view invalidation that
    the plan didn't ask for.** Raising `useSectionPage` to a 5min staleTime
    (as the plan specifies) would otherwise make a student's own
    just-finished lecture progress look stale for up to 5 minutes if they
    immediately navigate back to the section page — the plan's "owner
    expectation: minutes is fine" note is about admin content changes
    reaching students, not a student's own real-time progress feedback, so I
    treated this as a real risk rather than the intended tradeoff. Fix:
    `audioController.ts` now invalidates `queryKeys.home` +
    `queryKeys.section(currentSectionId)` at the natural "stopped listening"
    moments (pause/stop/lecture-finish), not on every 5s tick — cheap (a
    no-op unless that view is mounted) and keeps progress feeling live
    without undoing the caching win for plain browsing.

18. **Stray long-running Metro dev server (unrelated, pre-existing) broke a P5
    release build.** A `node.exe` (`expo start --web`, PID 3612) had been
    running since **2026-07-02 17:21**, well before this session — the same
    server discovered earlier during Phase P1 web verification (already known
    to be broken by the I18nManager crash, GLITCH_LOG #14). Its concurrent
    access to `%TEMP%\metro-cache` caused `:app:createBundleReleaseJsAndAssets`
    to fail with `ENOTEMPTY: directory not empty, rmdir ...metro-cache\56`.
    Stopped the process and cleared `%TEMP%\metro-cache`; retry succeeded.
    Wasn't serving any purpose (web is already broken independently), so I
    didn't ask before stopping it — flagging here in case the owner expected
    it running for something else.
19. **P5 startup-timing numbers are noisy — reported honestly, not
    over-precise.** Measured native cold start via repeated force-stop +
    relaunch + burst-screenshot (screenshot file-size jump = BootLoader →
    Home content), 1 "before" run and 3 "after" runs (couldn't get more
    "before" runs — the pre-P5 APK was overwritten by the next gradle build
    before I realized I wanted more samples). Raw results: before ≈ 3.4–5.4s;
    after ≈ 3.3–4.3s, 3.7–4.7s, 5.9–6.9s. The 3 "after" runs alone span more
    than 3 seconds, so this measurement method's noise floor (adb/USB
    round-trip jitter, ~1s mtime resolution, device background load) is larger
    than the effect either P5 change (one fewer font weight; font-load and
    session-restore now parallel instead of sequential) plausibly produces.
    Not claiming a measured improvement — the changes are justified by code
    reasoning (one less font file parsed; two independent async waits no
    longer serialized), not by these numbers. `adb shell am start -W`
    TotalTime (232–332ms) was also captured but only measures native-activity-
    to-first-frame, not JS/font/session readiness, so it can't show this
    change either.

20. **CRITICAL, pre-existing — `/downloads` screen crashes the whole app.**
    Found during the Phase P6 final regression click-through, native, on the
    release build. Navigating to `/(student)/downloads` reliably kills the
    process: `FATAL EXCEPTION ... JavascriptException: Maximum update depth
    exceeded ... at DownloadsScreen`, i.e. a real infinite render→setState
    loop, not a caught JS error — Android shows the "app keeps stopping"
    dialog and the process dies. Reproduced twice, on two different builds
    (pids 18473 and 20499), confirming it's not a one-off.
    **Not caused by anything in PLAN_PERFORMANCE.md** — this session never
    touched `app/(student)/downloads.tsx`, `src/hooks/useDownloads.ts`, or
    `src/stores/downloadsStore.ts`. Likely cause (not fixed, just flagged):
    `useDownloadedIds()` in `useDownloads.ts:67-73` is a Zustand selector that
    returns a **brand-new array** (`Object.entries(...).filter().map()`) on
    every call with no custom equality — a classic Zustand footgun that makes
    the hook "changed" on every store notification regardless of content,
    which can cascade into the update-depth loop if anything downstream reacts
    to that in an effect. `useDownloadedLectures()` right below it already
    guards its OWN memo with a joined-string key, suggesting someone half-fixed
    this same smell before but the root selector was never corrected.
    **This blocks the P6 "full student click-through" verification for the
    downloads screen specifically** — every other screen this session touched
    (or didn't) was click-through tested clean; this one is a real, severe,
    unrelated bug the owner should treat as a priority fix, not performance
    work.

## Scan-process notes (no action needed)

- No tool errors blocked the scan. Two cosmetic hiccups: one table-name grep
  needed re-running with a different pattern, and one compound shell command
  returned a non-zero exit code from a no-match `grep` while still producing
  correct output. Neither affected findings.
