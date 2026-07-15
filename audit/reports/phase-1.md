# Phase 1 report — Root shell & cross-cutting runtime

**Date:** 2026-07-15 · **Branch:** `audit/phase-1-shell` (from `audit/phase-0-baseline`) · **Executor:** Claude (Fable 5)
**Scope (PLAN_AUDIT §Phase 1):** `app/_layout.tsx` (SessionGate, AuthGate, NotificationsBootstrap,
query-cache persistence, RTL bootstrap, UpdateGate, deep links), `app/+html.tsx`,
`src/lib/{queryClient,connectivity,env,supabase,version}.ts`, BootLoader, font loading,
`app/(student)/_layout.tsx`, BottomNavBar, error-boundary coverage.

## Outcome

| Exit criterion | Result |
|---|---|
| Role-routing matrix — every cell verified | ✅ 60/60 cells resolved by code reading with file:line evidence (§2); no incorrect redirect found. Two UX-grade cells logged (F-111 web-student loop; staff/sheikh locked out of the native student surfaces is **by design**). |
| Shell checklist complete | ✅ §5 — every row ticked or N/A'd with reason. |
| Findings fixed or logged | ✅ 4 fixed in-phase (F-101 P1, F-102 P1, F-103 P2, F-104 P3), 8 logged with target phases (F-105…F-112), F-010 decided (fix; patch in §3, application blocked by worktree isolation — native dirs are untracked). |

Fix commit: `759baec`. Typecheck clean after all edits.

Line numbers below refer to post-fix `app/_layout.tsx` (commit `759baec`) unless the file
is named explicitly.

---

## 1. Task 1 — Anonymous-session boot races

**Boot sequence read end-to-end:** module scope forces RTL + wires connectivity
(`_layout.tsx:161-183`) → `RootLayout` mounts `PersistQueryClientProvider` unconditionally
(fonts + anon sign-in run in parallel, `:640-655`) → `SessionGate` (`:214`) holds children on
`BootLoader` until `fontsLoaded && sessionReady`.

- **Cold start offline on fresh install — CONFIRMED P1 (F-101, fixed).** The documented
  fall-through (`sessionReady = !!user || ensure.isError`, `:259`) could never fire offline:
  `useEnsureSession` used TanStack's default `networkMode: 'online'`, and `initConnectivity`
  (module scope) seeds `onlineManager` offline before the effect mutates — the mutation is
  **paused**, never run, `isError` stays false, and the app sits on the boot loader until the
  network returns. In the alternate interleaving (seed lands late, mutation runs and fails),
  the fall-through worked but **nothing ever retried**: the session-less app cached RLS-empty
  reads as successes and Home stayed blank for the whole session, and those empty successes
  were eligible for persistence to disk. Fixed both halves: `networkMode: 'always'`
  (`useAuth.ts:59` — local `getSession` checks work offline; the anon sign-in fails fast) and
  a SessionGate `onReconnect` retry that re-runs the silent sign-in and invalidates all
  queries once the late session lands (`_layout.tsx:236-254`).
- **Anon sign-in failure + retry (online).** A non-network failure (Supabase 5xx) falls
  through as designed; the reconnect retry doesn't cover it (no offline→online edge) —
  acceptable: next cold start recovers, and `ensureSession`'s two sidecar restores
  (`LAST_SESSION_KEY`, `DEVICE_GUEST_KEY`, `api/auth.ts:266-298`) make loss of identity
  non-permanent. Not coded (no confirmed scenario beyond the offline one).
- **SessionGate double-mount.** Single mount at the root; `bootedRef` guards duplicate
  `ensure.mutate()` within a mount (`:222-233`); `ensure` object identity changes per render
  but the effect body is condition-guarded — no duplicate anon users possible. `ensureSession`
  itself is also idempotent (checks `getCurrentUser` first). RN production has no StrictMode
  double-effects. Pass.
- **Session restore hardening** (context, verified sound): `supabase.ts` drives GoTrue
  auto-refresh off AppState (`:41-46`) and keeps the `LAST_SESSION_KEY` sidecar on every
  session event (`:67-73`); `restoreGuestSession` refuses to restore a session that became
  registered (`api/auth.ts:184-188`). No action.

## 2. Task 2 — AuthGate role-routing truth table

Gate under audit: `AuthGate` (`_layout.tsx:270-322`). Mechanics verified first:
- Redirects wait for the root navigator (`navState?.key`, `:276`) — no early-navigation warnings.
- `user` comes from the `currentUser` cache; `isGuest` from `is_anonymous`; role from JWT
  `user_metadata` (`api/auth.ts:247`).
- Effect deps `[user, segments, router, navState?.key]` — every redirect changes `segments`,
  re-running the effect until a fixed point; each branch's target satisfies its own guard, so
  **no redirect cycle exists in any cell** (checked per-branch below).
- Second layer: `app/admin/_layout.tsx:21-24` renders `null` unless a non-guest
  admin/publisher/sheikh — kills the admin-UI flash during the one-render redirect gap.
  `(auth)`, `(student)`, `sheikh`, `player`, `attachment` have **no** local gate (rely on
  AuthGate + RLS).

Roles below are **non-guest** for student/publisher/sheikh/admin; "guest" = anonymous session
(`isGuest: true`, role `student`). On web a guest session is never created (`SessionGate`
`:229`; `signOut()` returns null on web, `api/auth.ts:575`), but the guest column is still
resolved for completeness (a hypothetical guest session in web storage hits the same
non-staff branch). `staffHome` = `/admin` for admin, `/admin/lectures` for publisher (`:290`).

### Native (Android/iOS)

| Role ↓ · At route → | `(auth)` | `(student)` | `player/[id]` | `attachment/[id]` | `sheikh` | `admin` |
|---|---|---|---|---|---|---|
| **guest** | ✅ stays (`:312` no-role branch only redirects `inAdmin\|\|inSheikh`, `:317-318`) | ✅ stays (same) | ✅ stays | ✅ stays | ✅ → `/` (`:317-318`) | ✅ → `/` (`:317-318`); admin shell renders null meanwhile (`admin/_layout.tsx:24`) |
| **student** | ✅ stays (re-sign-in reachable) | ✅ stays | ✅ stays | ✅ stays | ✅ → `/` | ✅ → `/` + null shell |
| **publisher** | ✅ → `/admin/lectures` (`:315-316`) | ✅ → `/admin/lectures` | ✅ → `/admin/lectures` (by design: staff live in the panel; no student playback surface) | ✅ → `/admin/lectures` | ✅ → `/admin/lectures` | ✅ stays; per-screen `useAdminOnly` guards + 0081 RLS cover admin-only screens (Phase 10 verifies each) |
| **sheikh** | ✅ → `/sheikh` (`:313-314`) | ✅ → `/sheikh` | ✅ → `/sheikh` (design: "never in the student tabs") | ✅ → `/sheikh` | ✅ stays | ✅ stays (shared staff screens allowed, `:314` `!inAdmin` condition) |
| **admin** | ✅ → `/admin` (`:315-316`) | ✅ → `/admin` | ✅ → `/admin` | ✅ → `/admin` | ✅ → `/admin` | ✅ stays |
| **no session** (offline fresh-install fall-through) | ✅ `:312` early-returns — no routing; app renders, reads are RLS-empty until F-101's reconnect recovery lands a session | same | same | same | same | same (admin shell null) |

### Web (admin dashboard)

| Role ↓ · At route → | `(auth)` | `(student)` | `player/[id]` | `attachment/[id]` | `sheikh` | `admin` |
|---|---|---|---|---|---|---|
| **unauthenticated** | ✅ stays (`:303` `!inAuth` guard) | ✅ → `/sign-in` (`:303-304`) | ✅ → `/sign-in` | ✅ → `/sign-in` | ✅ → `/sign-in` | ✅ → `/sign-in` + null shell |
| **guest** (hypothetical on web) | ✅ stays — guest fails both `!user.isGuest` staff checks (`:296,:301`) → non-staff branch | ✅ → `/sign-in` | ✅ → `/sign-in` | ✅ → `/sign-in` | ✅ → `/sign-in` | ✅ → `/sign-in` + null shell |
| **student** | ⚠️ stays — signs in, `sign-in.tsx:50` replaces to `/`, AuthGate bounces back to `/sign-in`: stable but unexplained (web is staff-only by design) → **F-111 (P3, Phase 10)** | ✅ → `/sign-in` | ✅ → `/sign-in` | ✅ → `/sign-in` | ✅ → `/sign-in` | ✅ → `/sign-in` + null shell |
| **publisher** | ✅ → `/admin/lectures` (`:301-302`) | ✅ → `/admin/lectures` | ✅ → `/admin/lectures` | ✅ → `/admin/lectures` | ✅ → `/admin/lectures` (`:301` — sheikh-only routes are staff-redirected) | ✅ stays |
| **sheikh** | ✅ → `/sheikh` (`:296-300`) | ✅ → `/sheikh` | ✅ → `/sheikh` | ✅ → `/sheikh` | ✅ stays (landing) | ✅ stays (shared staff screens, `:300`) |
| **admin** | ✅ → `/admin` | ✅ → `/admin` | ✅ → `/admin` | ✅ → `/admin` | ✅ → `/admin` | ✅ stays |

Null-safety note: the `user!.isGuest` assertions (`:296,:301`) are reached only when
`isSheikh`/`isStaff` is true, which requires `user?.role` to have matched — safe.

### Dynamic transitions

- **Role changed server-side mid-session:** NOT reflected until restart — `currentUser` has
  `staleTime: Infinity` (`useAuth.ts:50`) and reads the *stored* JWT (`getSession()`, no
  network, `api/auth.ts:244`). RLS still enforces reality server-side, so exposure is
  UI-cosmetic (demoted admin sees an admin shell whose reads fail). Logged **F-106 (P3,
  Phase 3)** with a cheap fix path: the foreground `getUser()` in `checkBannedAndSignOut`
  already fetches the fresh user and discards it.
- **Banned-account flow:** verified end-to-end. Every foreground runs `checkBannedAndSignOut`
  (`_layout.tsx:439-441`) → `getUser()` server validation, bounded by `withAuthTimeout` so it
  can't wedge the GoTrue lock (`api/auth.ts:591-616`); ban/`user_not_found`/403 → full
  `signOut()` → device-guest restore → `setQueryData(currentUser, guest)` → AuthGate reroutes
  on the cache flip. Network failure / timeout **fails open** (never signs out offline) —
  correct posture. Guest restore refuses a now-registered uid (`api/auth.ts:184-188`). Pass.
- **Sign-out / register / delete:** cache reset lives in `mutationFn` (survives unmount), and
  the guest session is established **before** `qc.clear()` so a clear-triggered refetch can't
  resurrect the stale user (`useAuth.ts:176-192`) — sound. But sign-out/delete are unusable
  **offline** (paused mutation + unguarded `unregisterPushToken` await) → **F-105 (P2,
  Phase 3)**.

## 3. Task 3 — RTL bootstrap (F-010 decision)

Verified behavior (`_layout.tsx:141-183` + native sources in the main checkout):

- **iOS:** `AppDelegate.swift:30-33` forces RTL natively before the first frame — the JS
  restart never fires in a real build. Pass.
- **Web:** `+html.tsx:11` sets `<html lang="ar" dir="rtl">` for exports; `_layout.tsx:171-174`
  sets it at module scope too, covering the Metro dev shell. Pass.
- **Expo Go:** restart correctly skipped (`isExpoGo`, `:180-183`) — RNRestart's native module
  doesn't exist there; LTR rendering in Expo Go on an LTR locale is accepted (dev-only).
- **Android (F-010):** no native enforcement; first launch on an LTR locale renders an LTR
  frame, then `RNRestart.restart()` fires at module scope.
  **Restart-loop analysis:** `forceRTL` writes SharedPreferences (`apply()` — immediate
  in-memory, async disk flush); `RNRestart.restart()` recreates the React instance **in the
  same process**, so the next `I18nManager.isRTL` read sees the in-memory value → the restart
  fires **at most once per process**. A force-kill in the ms-wide window before the disk flush
  repeats the dance next launch but cannot loop within one. So: no loop, but every fresh
  LTR-locale install gets a visible LTR flash + double boot, and the guarantee is
  incidental ("happens to work", per the code's own comment).
  **Verdict: fix natively** (mirror iOS). Blocked from landing in this session: `android/` and
  `ios/` are **gitignored + untracked** (`.gitignore:47-48`) — they exist only in the main
  checkout, which the audit worktree is isolation-blocked from editing. Ready-to-apply patch
  (API verified against `node_modules/react-native/.../I18nUtil.kt` — RN 0.85 exposes
  `I18nUtil.instance`):

  ```kotlin
  // android/app/src/main/java/com/riwaqalilm/app/MainApplication.kt
  import com.facebook.react.modules.i18nmanager.I18nUtil   // + add import

  override fun onCreate() {
    super.onCreate()
    // Arabic-first: force RTL natively, before the React instance loads, so the
    // layout direction is already correct on the very first frame — mirrors
    // AppDelegate.swift. Makes the one-time JS RNRestart in app/_layout.tsx a
    // dead fallback on Android too (isRTL is true before JS ever evaluates).
    val i18n = I18nUtil.instance
    i18n.allowRTL(applicationContext, true)
    i18n.forceRTL(applicationContext, true)
    i18n.swapLeftAndRightInRTL(applicationContext, false)
    ...existing body...
  }
  ```

  `AndroidManifest.xml` already has `android:supportsRtl="true"` (verified). After applying,
  keep the JS restart as the documented fallback for older binaries (exactly the iOS posture).
  Also note: `AppDelegate.swift:24-26`'s comment claims Android already does this natively —
  false until the patch lands (flagged in F-010).
- **`swapLeftAndRightInRTL(false)` audit:** deliberate and load-bearing — the entire codebase
  is written in *physical* left/right coordinates (e.g. BottomNavBar's pill translates
  negative-X for increasing RTL tab index, `BottomNavBar.tsx:82-88`; the unread dot's
  `right: -4`). iOS native side sets the same (`swapLeftAndRight(inRTL: false)`), so JS and
  native agree on both platforms. Flipping it now would silently mirror hundreds of styles —
  keep as-is; noted as a standing convention for later phases' RTL checks.

## 4. Task 4 — Query persistence

- **Dehydrate allowlist vs privacy** (`_layout.tsx:92-118`): mechanically correct —
  deny-by-default roots, `status === 'success'` only (errors/pending never persisted),
  `admin` substring rejection as defence-in-depth, quizzes scoped to `myStats` only (answer
  keys / attempts never touch disk), `currentUser` (`['auth','me']`), buddy, questions,
  signed-URL-bearing caches outside the resume path all excluded. What DOES land plaintext in
  AsyncStorage: private notes, the notifications inbox, journey/streak, benefits — deliberate
  offline-first design → recorded as accepted-risk **F-109 (P3 → Phase 13 risk register)**.
  One nuance: the `lecture` root persists a **signed audio URL**; safe because its 45-min
  `staleTime` (`useLecture.ts:16`) is under the 3600s TTL and `onPersistedCacheHydrated`
  force-invalidates the most-recently-active lecture entry after every restore
  (`_layout.tsx:133-139`). The in-file comment claimed "30-min staleTime" — corrected to
  45-min in `759baec`.
- **`buster: APP_VERSION`** (`:557`, `version.ts:8`): version bump discards the whole
  persisted cache — correct upgrade semantics; `maxAge` 30 days consistent with `gcTime`
  7 days (entries older than gcTime are dropped on dehydrate anyway).
- **Hydration race vs first render:** none — `PersistQueryClientProvider` renders children
  inside `IsRestoringProvider`; every `useQuery` is held in `restoring` (no fetch, no cache
  write) until restore completes, so a fresh network fetch can never be overwritten by stale
  disk data. Additionally SessionGate's BootLoader typically outlasts restore on native.
- **`onPersistedCacheHydrated` correctness** (`:133-139` + `queryClient.ts:65-74`):
  `reconcileContentListsAfterHydration` invalidates the four admin-mutable content roots,
  `refetchType: 'active'` (mounted screens refetch now; unmounted ones on mount via
  staleness) and skips entirely when offline — preserving the zero-network offline launch.
  The extra targeted invalidation of the last-active `lecture` entry closes the
  force-kill-with-stale-signed-URL hole. Verified: `invalidateQueries` on inactive queries
  marks stale without fetching → offline-safe as commented. Pass.

## 5. Task 5 — UpdateGate

Read `UpdateGate.tsx` + `api/appVersion.ts` in full. All failure modes resolve fail-open:

| Scenario | Behavior | Verdict |
|---|---|---|
| Server unreachable / RLS denies / table missing | `getAppVersionGate` catches everything → `EMPTY_GATE` (never throws, `appVersion.ts:29-46`); query `data` undefined → children render | ✅ fail-open |
| Malformed `min_app_version` (e.g. `"abc"`) | `compareVersions` parses non-numeric parts as 0 → `"1.0.0" < "abc"` is false → no block (`version.ts:15-26`) | ✅ fail-open |
| Malformed `latest_released_at` | `Date.parse` → NaN → `graceExpired` requires `Number.isFinite` → soft nudge only, never a hard block (`UpdateGate.tsx:55-59`) | ✅ |
| Downgrade (installed > latest/min) | comparisons negative-only → no gate | ✅ |
| Gate-then-allow flicker | impossible: `['appVersionGate']` is **not** in the persistence allowlist, `data` starts undefined → children render first; a hard block can only appear (allow-then-gate), which is the designed fail-open tradeoff | ✅ |
| Missing `downloadUrl` with hard block | block screen renders without the button (`:83-102`) — user is stuck but that's an admin config error; nudge likewise degrades | ✅ acceptable |
| Web | `enabled: false` — exempt (`:38`) | ✅ |

Blocking screen unmounts the whole app (AuthGate/NotificationsBootstrap/Stack) — acceptable;
it appears within seconds of boot before meaningful state exists. One P3 logged: duplicate
`installedVersion` derivation vs `APP_VERSION` (**F-112**).

## 6. Task 6 — Deep links

- **Cold push tap:** `getInitialDeepLink()` consumed once on mount with a `handled` guard
  against the warm listener racing it (`_layout.tsx:409-421`). **Warm tap:**
  `addResponseListener` (`notifications.ts:532-552`), removed on cleanup. Both funnel through
  one `deepLink()` that invalidates buddy + inbox first. Pass — with one lead: Android
  **recents intent redelivery** can make `getLastNotificationResponseAsync` re-return a
  long-consumed response on a later cold start (no consumed-marker is stored) → **F-108
  (P2 lead, Phase 9 physical-device verification)**.
- **Gender guard at notification entries:** push tap checks `isLectureVisibleToViewer`
  (`:396-404`), and the in-app inbox open does the same (`notifications.tsx:138`) — both of
  0072's intended gates covered; RPC fails **open** on network error (`lectures.ts:186`),
  a deliberate availability-over-strictness call consistent with 0072 (the content is
  courtesy-scoped, not confidential).
- **Bypass via other entry points — CONFIRMED possible, logged not coded (F-107, P3 → Phase 2):**
  browse paths are server-filtered (0049 RPCs), resume/bubble/downloads target the user's own
  history, but a hand-crafted `riwaqalilm://player/<uuid>` external scheme link opens any
  published lecture for any viewer — `lectures` selects carry no gender RLS. No in-app
  surface mints lecture links (share = app URL only, `profile.tsx:132-135`), so exposure
  requires hand-building a link. Whether gender scoping should move into RLS is a Phase 2
  (backend) decision; per §0.2 this stays a logged finding.
- **Malformed / unauthorized IDs:** `/player/<garbage>` → `getLecturePlayback` throws →
  `preloadLecture` rejects → calm inline "unavailable" state with retry
  (`player/[id].tsx:143-157`); the screen never crashes. Draft/deleted lectures: RLS returns
  no row → same path. `/attachment/<garbage>` → `!data` → Arabic "المرفق غير موجود"
  (`attachment/[id].tsx:30-44`). Malformed `?t=` → `Number(...)` NaN-guarded
  (`player/[id].tsx:151-153`). Unmatched paths (`riwaqalilm://nonsense`) previously rendered
  expo-router's **English** screen → fixed with `app/+not-found.tsx` (**F-104**).
- **`data.route` push payloads** are `router.push`ed verbatim — server-authored (admin
  broadcasts) only; an invalid value now lands on the Arabic not-found screen. Acceptable.

## 7. Task 7 — Global error handling

Confirmed: **zero** error boundaries existed (repo-wide grep for
`ErrorBoundary|componentDidCatch|getDerivedStateFromError` — only a comment hit). Consequence
by platform: native release → RN fatal, app closes to launcher; web → blank page; dev → red
box. Any single render throw in any of the 49 screens was a full app crash. **Fixed (F-102,
P1):** root `ErrorBoundary` export in `app/_layout.tsx` — expo-router wraps the exported
component in its `Try` boundary (wiring verified in `expo-router/build/useScreens.js:146-155`),
covering the entire route tree. The fallback is a calm Arabic screen (logo, «حدث خللٌ غير
متوقع», إعادة المحاولة → `retry()`), deliberately self-contained: plain `View`/`Text`, theme
constants, **no** custom fonts / providers / router (all may be dead at crash time);
`error.message` shown in `__DEV__` only. Note the boundary does not catch async/handler
throws (React semantics) — those surface via each screen's own error states, audited
per-screen in Phases 3–10.

## 8. Task 8 — Listener/memory audit (`_layout.tsx` and shell modules)

| Registration | Site | Cleanup | Verdict |
|---|---|---|---|
| `AppState` → GoTrue auto-refresh | `supabase.ts:42` | none — module scope, once per JS run | ✅ intentional |
| `onlineManager.subscribe` + `Network.addNetworkStateListener` (debounced) | `connectivity.ts:44,71` | `started` idempotence flag; expo-network sub removed by onlineManager's own lifecycle; debounce timer cleared | ✅ |
| Notification response listener | `_layout.tsx:422-425` | `sub.remove()` returned from effect | ✅ |
| `AppState` (onActive: outbox/ban/badge/daily-reminder) | `:461-465` | `sub.remove()`; re-registers when `user` identity changes (teardown first) | ✅ |
| `AppState` (rating foreground-time) | `:489-501` | `flushElapsed()` + `sub.remove()` in cleanup; `sessionStart` reset on remount → no double-count | ✅ |
| Bubble native listeners + `AppState` (background) | `:538-560` | `removeNative()` + `bgSub.remove()`; `addBubbleListeners` returns a real remover or a no-op (`bubble.ts:124-137`) | ✅ |
| `startOutbox()` on every user change | `:432` | idempotent (`outbox.ts:146-156` `started` flag) | ✅ |
| `configureNotificationHandler` | `:341-343` | idempotent (`handlerConfigured`, `notifications.ts:138-149`) | ✅ |

No leak-on-remount or double-registration found. Two non-leak notes: the boot effect's
`ensure` dep changes identity every render (re-runs are condition-guarded — harmless);
NotificationsBootstrap remount re-consumes `getLastNotificationResponseAsync` (folded into
F-108).

## 9. F-003 input (gesture-handler v3) — shell surface

Phase 1's exposure is `GestureHandlerRootView` (`_layout.tsx:602`) only — API unchanged in
v3, typecheck clean, Phase 0 booted all three targets with v3 installed. The behavioral
surfaces (player pan-dismiss, sheets, scrubber) are Phase 5's checklist; F-003 stays open
routed there. No Phase-1 action.

## 10. Fixes landed (commit `759baec`)

| Finding | Sev | Fix |
|---|---|---|
| F-101 | P1 | `useEnsureSession` `networkMode: 'always'`; SessionGate reconnect retry + invalidate-all on late session |
| F-102 | P1 | Root `ErrorBoundary` export — calm Arabic crash screen with retry |
| F-103 | P2 | `fontError` counts as loaded — no eternal BootLoader on a failed font fetch |
| F-104 | P3 | `app/+not-found.tsx` — Arabic unmatched-route screen |
| (doc) | — | `'lecture'` allowlist comment: 30-min → actual 45-min staleTime |

Logged, not coded (per §0.2): F-105 (offline sign-out, Phase 3), F-106 (role-change staleness,
Phase 3), F-107 (gender-guard entry points, Phase 2), F-108 (recents intent redelivery,
Phase 9), F-109 (persisted-cache privacy posture, Phase 13 register), F-110 (BottomNavBar
fallback highlight, Phase 4), F-111 (web student sign-in loop, Phase 10), F-112 (UpdateGate
version duplication, Phase 11). F-010: verdict fix-natively, patch in §3, application is an
owner/main-checkout action (untracked native dirs).

## 11. Shell checklist (PLAN_AUDIT §2, adapted to non-screen shell components)

| Dimension | Result |
|---|---|
| Functional correctness | ✅ gates/persistence/deep links traced end-to-end (§1–§7) |
| Runtime errors & crash paths | ✅ F-102 fixed; per-callback try/catch audited (notifications lib swallows everything non-fatally) |
| Edge cases (malformed data) | ✅ UpdateGate payloads (§5), deep-link IDs/`?t=` (§6), version strings (§5) |
| Loading / empty / error / offline states | ✅ BootLoader; offline boot F-101 fixed; fail-open gates |
| Guest vs registered vs role-gated | ✅ truth table §2 (60 cells) |
| Input validation | N/A (no user input in shell) — auth forms are Phase 3 |
| State management | ✅ persistence allowlist, buster, hydration, reconcile (§4) |
| Navigation (deep link, re-entry) | ✅ §6; +not-found added; Android hardware back on shell screens N/A (no back target above root) |
| API interaction (retries, races) | ✅ boot race fixed (F-101); `withAuthTimeout` bounds GoTrue-lock hangs; ban check fail-open |
| Security (RLS assumptions, role/gender leakage) | ✅ §2, §6; F-107 logged to Phase 2 |
| Performance | ✅ fonts ∥ session boot preserved; module-scope work is O(1); no re-render storms added (fix effects are condition-guarded) |
| Memory leaks | ✅ §8 table — all listeners cleaned/idempotent |
| Accessibility | ✅ crash/not-found screens: `accessibilityRole="button"`, ≥44pt targets; BottomNavBar has labels+selected state (pre-existing) |
| Small phones / tablets | ✅ shell screens are centered flex layouts (no fixed widths); tablet specifics land in Phase 11's matrix |
| iOS / Android specifics | ✅ RTL split (§3), player modal presentation notes read, Android channel creation (notifications lib) |
| Keyboard handling | N/A (no inputs) |
| Backgrounding/kill/restore | ✅ AppState wiring §8; resume-cache reconcile §4; kill-mid-RTL-restart §3 |
| Network interruption | ✅ connectivity debounce + reconnect listeners; F-101; outbox trigger wiring |
| Design-system consistency | ✅ new screens use theme tokens (bgSand/primaryTeal/radius); crash screen deliberately system-font (justified in-code) |
| Animation correctness (RTL transforms) | ✅ BottomNavBar physical-transform convention verified (§3) |
| Localization (Arabic-only copy) | ✅ new copy Arabic; F-104 removed the English unmatched screen; error messages in auth lib already Arabic |

## 12. Deferred (with reason)

- **Runtime verification on devices/simulators** (boot offline, notification taps, RTL first
  launch): this session had no booted simulator/emulator; every finding above is proven from
  code paths (the fix scenarios are deterministic). The `verify` skill run for F-101/F-102 is
  folded into Phase 3's device pass, which exercises the same gates on every auth transition.
  F-019 (physical-device list) already tracks the device-only items.
- **F-010 native patch application** — main-checkout action (untracked `android/`), §3.
- **NotificationsBootstrap deep semantics** (priority dispatcher, dedup, badge math): Phase 9
  by plan (“Phase 1 only skims it”) — only its listener hygiene + deep-link entry was in scope here.
- **Per-screen guards inside `/admin`** (`useAdminOnly`/`useStaffOnly` per screen): Phase 10.
