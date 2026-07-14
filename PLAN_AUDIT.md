# PLAN_AUDIT — Definitive Production-Readiness Audit Roadmap

> **Purpose.** A phase-by-phase roadmap for an exhaustive, first-principles quality audit of the
> entire application (mobile student app + sheikh surface + admin web dashboard + Supabase backend),
> ending in production sign-off. Each phase is designed to be executed in its own session(s).
> **Nothing is assumed to work. Every behavior is verified.**
>
> **How to use this file.** In a new session: read this file, read the phase you're executing, then
> follow its tasks in order. Fixes land on a dedicated branch per phase; every phase ends with
> `/code-review` + `/security-review` over that branch's diff and a written phase report.

---

## 0. Ground rules (apply to every phase)

1. **One feature/screen at a time, fully finished before the next.** Read all relevant code →
   understand intended UX → enumerate failure modes → confirm issues (reproduce or prove from code)
   → fix → verify no regression → report.
2. **Confirmed-only fixes.** An issue is fixed only when its failure scenario is concretely stated
   (inputs/state → wrong outcome). Speculative "might be nice" items go to the findings log as P3,
   not into code.
3. **Branch per phase** (`audit/phase-N-<slug>`). Never commit to `main` directly. After fixes:
   run `npm run typecheck`, the `verify` skill for runtime-visible changes, then `/code-review`
   (medium+) and — whenever the diff touches auth, RLS, storage, input handling, or money/PII paths —
   `/security-review`. After any migration touching RLS/policies/functions: `node scripts/security-check.mjs`
   (CLAUDE.md requirement).
4. **Severity scheme** used everywhere:
   - **P0** — crash, data loss, security hole, store rejection. Fix immediately in-phase.
   - **P1** — broken feature/state corruption for a real user path. Fix in-phase.
   - **P2** — degraded UX, edge-case failure, perf issue with visible impact. Fix in-phase if scoped, else log.
   - **P3** — polish, tech debt, maintainability. Log; batch into Phase 11.
5. **Findings log.** All findings go to `audit/FINDINGS.md` (create in Phase 0) as a running table:
   `ID · phase · file:line · severity · summary · status (open/fixed/wontfix) · commit`. Phase
   reports live at `audit/reports/phase-N.md`.
6. **The per-screen checklist (§2) is mandatory** for every screen audited — tick every row or
   mark N/A with a reason.
7. **No scope creep into redesign.** The calm, non-competitive, RTL, Arabic-first product identity
   (CLAUDE.md) is a fixed constraint, not an audit finding.

---

## 1. Baseline inventory (verified 2026-07-14)

| Area | Facts |
|---|---|
| App | Expo SDK 56, RN 0.85.3, React 19.2, TypeScript strict, Expo Router. Portrait-locked, `userInterfaceStyle: "light"` (light-only by design), forced RTL (JS + iOS AppDelegate.swift; Android relies on one-time `RNRestart` — TODO noted in `app/_layout.tsx`). |
| Screens | 27 student/sheikh routes under `app/(auth)`, `app/(student)`, `app/player`, `app/attachment`, `app/sheikh` + 22 admin web routes under `app/admin/`. |
| State | TanStack Query (+ AsyncStorage persistence, selective dehydrate allowlist), Zustand stores ×6 (`player`, `downloads`, `notifications`, `settings`, `tour`, `publicStorage`). Offline outbox (`src/lib/outbox*.ts`). |
| Backend | Supabase (Postgres + Auth + RLS), **87 migrations**, 6 Edge Functions (`admin-users`, `delete-account`, `notify-on-publish`, `r2-*`). Audio/files on **Cloudflare R2** via signed-URL edge functions. |
| Native | Custom `AppDelegate.swift` (RTL), `MainActivity/MainApplication.kt`, experimental `modules/floating-bubble` (flag-off). Background audio (`UIBackgroundModes: audio`), push entitlements, privacy manifests declared. |
| Patches | `patch-package`: **expo-audio** (media notification prev/next, deep-link, duration; built from source) and react-native-web. Fork risk on every SDK upgrade. |
| Flags | `src/config.ts`: `USE_MOCK=false`, `NOTIF_TEST_MODE=false` (must stay false in release), `BUBBLE_ENABLED=false`, `COMPLETE_THRESHOLD=0.95`, `MAX_LISTEN_TICK_SEC=90`. |
| Testing | **No automated tests exist.** Only `npm run typecheck` + `scripts/security-check.mjs`. All behavioral verification is currently manual. |
| History | 20 `PLAN_*.md` docs + `GLITCH_LOG.md` (236 lines of known glitches) + `IOS_SUBMISSION.md`. Required reading in Phase 0. |
| Known doc rot | CLAUDE.md "out of scope" list contradicts the codebase (quizzes, journey, streaks, buddy, notifications are all fully built). `app/(student)/profile.tsx` header comment describes a page that no longer matches the implementation. |

---

## 2. Per-screen audit checklist (applied in Phases 3–10)

For **every** screen: functional correctness · runtime errors & crash paths · edge cases (empty /
huge / malformed data, Arabic + mixed-direction text, very long titles) · loading / empty / error /
offline / timeout states · guest vs registered vs role-gated behavior · input validation (client +
server) · state management (stale cache, invalidation, optimistic updates, persistence allowlist) ·
navigation (deep link in, back behavior, Android hardware back, re-entry, double-tap) · API
interaction (retries, race conditions, request cancellation on unmount, concurrent mutations) ·
security (RLS assumptions, data leakage between roles/genders, injection into RPC params) ·
performance (re-render storms, list virtualization, image/audio memory) · memory leaks (listeners,
subscriptions, timers, AppState handlers) · accessibility (labels, roles, touch targets ≥44pt,
screen-reader order in RTL, dynamic font sizes) · small phones (SE-class 320pt width) & large
phones · tablet/iPad (declared `supportsTablet: true`!) · iOS-specific & Android-specific behavior ·
keyboard handling (avoidance, dismissal, RTL text input) · backgrounding/kill/restore recovery ·
network interruption mid-action · UI consistency with the design system (`src/constants/theme.ts`) ·
animation correctness (Reanimated worklets, RTL transforms) · localization (all copy Arabic, Arabic
numerals via `arNum`, no English leakage from errors).

---

## 3. Phases

### Phase 0 — Baseline, environment, and audit infrastructure
- **Objectives.** Reproducible build + device matrix + full context absorption; audit scaffolding in place; documentation debt cleared so later phases audit against accurate specs.
- **Scope.** No feature auditing. Environment, docs, tooling, seed data.
- **Tasks.**
  1. `npm install`, `npm run typecheck`, `npx expo-doctor`; record every warning as a finding.
  2. Boot the app (`run` skill): iOS simulator, Android emulator, and web (admin). Verify Supabase env (`src/lib/env.ts`) and seed scripts (`scripts/seed-*.mjs`) against a **staging** project — never production data.
  3. Read `GLITCH_LOG.md`, `PLAN.md`, all `PLAN_*.md`, `IOS_SUBMISSION.md`. Extract every "known issue / deferred / TODO" into `audit/FINDINGS.md` as pre-seeded leads.
  4. `grep -rn "TODO\|FIXME\|HACK\|XXX" src/ app/ supabase/` → seed findings.
  5. Create `audit/FINDINGS.md`, `audit/reports/`, and the device matrix doc (min: iPhone SE-class, iPhone Pro Max-class, iPad, small Android (Go-class), flagship Android, Android 10 and 15, iOS 16 and latest).
  6. Fix documentation rot: update CLAUDE.md scope section to reflect what is actually built; fix stale screen-header comments found in Phase 0 reading (e.g. `profile.tsx`).
  7. Verify the two `patch-package` patches apply cleanly and document exactly what the expo-audio fork changes (input to Phase 6).
- **Skills/agents/tools.** `run`, `Explore` agent (very thorough) for repo census; `Bash`; optionally `fewer-permission-prompts`.
- **Deliverables.** `audit/FINDINGS.md` seeded; device matrix; corrected CLAUDE.md; phase report.
- **Exit criteria.** App boots on all three targets; typecheck clean; all historical docs read; findings log operational.
- **Risks.** Staging Supabase may not exist → creating one (with migrations 0001–0087 applied) becomes a blocking sub-task. Emulator ≠ device for audio/notifications — flag items needing physical devices.
- **Effort.** 1–2 sessions.

### Phase 1 — Root shell & cross-cutting runtime (`app/_layout.tsx` and everything it mounts)
- **Objectives.** The gates every screen lives behind are provably correct: session, roles, RTL, cache hydration, update gate, deep links.
- **Scope.** `app/_layout.tsx` (620 lines: SessionGate, AuthGate, NotificationsBootstrap, persistence, RTL bootstrap), `app/+html.tsx`, `src/lib/{queryClient,connectivity,env,supabase,version}.ts`, `UpdateGate`, `BootLoader`, font loading, `app/(student)/_layout.tsx`, `BottomNavBar`, error-boundary coverage.
- **Tasks (selected — apply full failure-mode analysis to each).**
  1. **Anonymous-session boot races**: cold start offline on fresh install (ensure fall-through works, then what happens when network returns); anon sign-in failure + retry; double-mount of SessionGate.
  2. **AuthGate role routing matrix**: {guest, student, admin, publisher, sheikh} × {native, web} × {every route group} — build the truth table, test each cell, incl. role changed server-side mid-session, and banned-account flow (`checkBannedAndSignOut`).
  3. **RTL bootstrap**: first-launch restart loop risk on Android (LTR locale), Expo Go path, the acknowledged Android TODO (no native enforcement in `MainApplication.kt`) — decide fix vs. accepted risk; `swapLeftAndRightInRTL(false)` implications audit.
  4. **Query persistence**: audit the dehydrate allowlist against privacy (what lands in AsyncStorage plaintext — notes? notifications?), `buster: APP_VERSION` behavior on upgrade, hydration race vs. first render, `onPersistedCacheHydrated` invalidation correctness.
  5. **UpdateGate**: server unreachable, malformed version payload, downgrade, gate-then-allow flicker.
  6. **Deep links**: cold-start vs warm push taps, `riwaqalilm://` scheme links from outside, malformed/unauthorized IDs in links, the gender-visibility guard (`isLectureVisibleToViewer`) — confirm it can't be bypassed via other entry points.
  7. **Global error handling**: there is no visible ErrorBoundary — confirm what a render-time throw does on each platform and add a calm Arabic crash screen if missing (likely P1).
  8. Memory: every `AppState.addEventListener` / notification listener in `_layout.tsx` audited for leak-on-remount and double-registration.
- **Skills/agents/tools.** `run`, `verify`, `Explore`; `/code-review high` on the fix diff; `/security-review` (auth/session surface).
- **Deliverables.** Role-routing truth table (in report); fixes; phase report.
- **Exit criteria.** All matrix cells pass; checklist complete for shell components; findings fixed or logged.
- **Risks.** Highest-blast-radius code in the app — regressions here break everything. Mitigate: small commits, `verify` after each.
- **Effort.** 2 sessions.

### Phase 2 — Backend: schema, RLS, RPCs, Edge Functions, storage
- **Objectives.** Server-side correctness and security proven independently of the client. This is the single most security-critical phase.
- **Scope.** All 87 migrations, every RLS policy, every RPC (incl. SECURITY DEFINER functions), the 6 Edge Functions, R2 signed-URL flows, `scripts/security-check.mjs` itself, `src/api/*` ↔ generated DB types drift.
- **Tasks.**
  1. Build a **policy matrix**: every table × {anon, authenticated-guest, student, publisher, admin, sheikh} × {select, insert, update, delete} — derived from migrations, then spot-verified live with `supabase` CLI / SQL against staging (e.g. can a student read another's notes/progress/quiz attempts? can a guest write?).
  2. Audit every `SECURITY DEFINER` function for privilege escalation, missing `search_path` pinning, unvalidated params, and information leaks (e.g. `search_buddy_candidates` gender enforcement, anonymity guarantees in Q&A RPCs, `submit_rating`/`report_content` abuse limits).
  3. Edge Functions: auth verification on `admin-users`, `delete-account` (full-wipe completeness — verify every user-owned table is covered), `r2-upload-url`/`r2-read-url`/`r2-delete` (who can mint URLs for what? TTLs? path traversal in keys?), `notify-on-publish` (can it be invoked by non-admins?).
  4. Blocked-word filter (migration 0053) bypass attempts; rate/abuse limits on guest-writable endpoints (feedback, reports, ratings, questions) — flooding is a real risk since **guests can write**.
  5. Recursive rollup RPCs (nested-sections skill semantics): correctness on deep trees, cycles, orphaned nodes, draft-filtering for students, performance with `EXPLAIN ANALYZE` on realistic data volume.
  6. Migration hygiene: do 0001–0087 replay cleanly on an empty DB? Any manual-console drift between staging and the migrations?
  7. Run and then **audit** `scripts/security-check.mjs` — what does it actually check, and what does it miss?
  8. Regenerate `database.generated.ts` and diff against committed — type drift is a correctness finding.
- **Skills/agents/tools.** `nested-sections` skill (query semantics reference); `/security-review`; `general-purpose` agent for the policy-matrix extraction if desired; Supabase CLI + psql via Bash.
- **Deliverables.** Policy matrix document (`audit/reports/rls-matrix.md`); fixed migrations (as **new** migrations, never edits to applied ones); phase report.
- **Exit criteria.** Every matrix cell verified; every DEFINER function reviewed; migrations replay clean; security-check passes.
- **Risks.** Live-verification against production by mistake — **hard rule: staging only**. Fixing RLS can break legitimate client paths → re-run affected client flows after each policy change.
- **Effort.** 3 sessions. Do not compress this phase.

### Phase 3 — Auth & identity (client side)
- **Objectives.** Every account lifecycle path is correct, calm, and safe.
- **Scope.** `app/(auth)/*` (sign-in, register + oath, reset-password), `edit-profile.tsx`, `profile.tsx` account rows (sign-out, delete account), `src/api/auth.ts`, `useAuth`, guest→registered upgrade, ban flow.
- **Tasks.** Full checklist per screen, plus: OTP flows (wrong/expired/reused code, resend spam), email-change two-step atomicity (crash between steps), instant phone change abuse (`sms_autoconfirm` implications), password-change reauth correctness, oath screen back-navigation (can name/gender be re-submitted?), guest-progress migration on register (is anon-session data carried over or orphaned? verify explicitly — likely subtle), sign-out during pending outbox writes, delete-account completeness client-side (local caches, downloads, AsyncStorage wiped?), Supabase error → Arabic mapping coverage (`arabicSignInError` unknown-error fallback), keyboard/RTL input on all forms, `withAuthTimeout` behavior on flaky networks.
- **Skills/agents/tools.** `run` + `verify` on device/simulator; `/security-review` on the diff.
- **Deliverables.** Fixes + phase report incl. an account-lifecycle state diagram.
- **Exit criteria.** Every lifecycle transition manually exercised on both platforms; checklist complete ×4 screens.
- **Risks.** Requires real email delivery for OTP — needs staging SMTP or test inbox.
- **Effort.** 1–2 sessions.

### Phase 4 — Content browsing & discovery
- **Objectives.** The content tree, home feed, search, and reading surfaces are correct at every depth and data shape.
- **Scope.** Home (`index.tsx` + all `components/home/*`), `section/[id]`, `recent`, `featured`, `sheikh-info`, `attachment/[id]`, `search`, `SectionsGrid`/rails/`ContinueCard`, pull-to-refresh wiring.
- **Tasks.** Full checklist per screen, plus: deep trees (5+ levels) and pathological sections (0 lectures, 500 lectures, only-drafts → student sees what?), progress rollup display vs Phase 2 server truth, search edge cases (Arabic diacritics/hamza variants, prefix matching, empty/1-char queries, debounce cancellation, results for content the viewer shouldn't see — gender/draft), stale-cache-after-admin-unpublish reconciliation (`reconcileContentListsAfterHydration`), `DISPLAY_NAME_OVERRIDES` hardcoded UUID in `sheikh-info.tsx` (env-dependent data in code — finding), FlatList virtualization on rails and long sections, image loading (sheikh photos signed URLs expiring while on screen), transcript reader with huge/empty/non-UTF8 content.
- **Skills/agents/tools.** `run`, `verify`; `Explore` for component-level tracing; `/code-review` on diff.
- **Deliverables.** Fixes + phase report.
- **Exit criteria.** Checklist ×7 screens; tree edge cases seeded in staging and verified.
- **Effort.** 2 sessions.

### Phase 5 — Audio player, downloads, and progress (the product's heart)
- **Objectives.** Playback is bulletproof: correct, resumable, offline-capable, background-safe, and the patched expo-audio fork is fully understood.
- **Scope.** `player/[id]`, `MiniPlayer`, `components/player/*`, `playerStore`, `src/lib/{audioController,audioDuration,resumeCache,downloads}.ts`, `downloadsStore`, `DownloadButton`, `downloads.tsx`, progress saving (`useProgress`, `saveLectureProgress`), the expo-audio patch, media-notification controls, `?t=` deep-link seek.
- **Tasks.**
  1. **State-machine mapping** of playerStore + audioController: play/pause/seek/rate/next/prev/complete across {streaming, downloaded, expired-signed-URL, offline} sources. Document, then test every transition.
  2. Signed-URL lifecycle: 3600s TTL vs 30-min staleTime (the `_layout.tsx` comment) — prove a mid-playback expiry can't happen, incl. pause-overnight-resume.
  3. Background audio: lock-screen/notification controls (both platforms — this is the patched code), interruption handling (phone call, other app's audio, Bluetooth disconnect, headphone unplug), kill-and-restore, iOS audio-session category correctness.
  4. Progress writes: tick cadence, `MAX_LISTEN_TICK_SEC` scrub-guard bypass attempts, completion at 95% (`COMPLETE_THRESHOLD` — note CLAUDE.md says 90%: doc/code divergence finding), double-device concurrent listening (last-write-wins? corruption?), offline ticks through the outbox and replay ordering.
  5. Downloads: interrupt mid-download (kill, airplane mode), storage-full, redownload-over-existing, delete-while-playing, orphaned files vs store hydration (`useHydrateDownloads`), download integrity (partial file plays?), iOS storage location vs iCloud-backup exclusion, Android scoped storage.
  6. Auto-advance (PlaybackSettings) interaction with downloads/offline/gender-guard.
  7. Player UI: RTL waveform/seek direction, swipe-to-dismiss (Android transparentModal path in `_layout.tsx` — the documented flash workaround), rate slider extremes, tablet layout, VoiceOver/TalkBack on transport controls.
  8. Memory/perf: audio buffer retention across many consecutive lectures, listener cleanup in mini↔full player transitions, Reanimated worklet leaks.
- **Skills/agents/tools.** `run` on **physical devices** (audio focus, lock screen — emulators lie); `ins-apk` for Android device installs; `verify`; `/code-review high`.
- **Deliverables.** Player state-machine doc; expo-audio patch dossier (what it changes, upstream status, SDK-upgrade risk); fixes; phase report.
- **Exit criteria.** Every state transition verified on physical iOS + Android; background/interruption matrix passes; downloads survive chaos testing.
- **Risks.** Patched-fork fixes may require native rebuilds per iteration (slow). Highest user-impact phase.
- **Effort.** 3 sessions.

### Phase 6 — Journey, streaks, goals, badges
- **Objectives.** Personal-progress math is provably correct and calm-by-design (never comparative, never punishing).
- **Scope.** `journey.tsx`, `components/journey/*`, `StreakCard`, `useJourney`/`useStreak`, `src/api/journey.ts`, `src/constants/badges.ts`, weekly-goal editor, buddy-compare card (display side), streak RPCs.
- **Tasks.** Full checklist, plus: timezone correctness of "day" boundaries (device vs server TZ — classic streak bug; test around midnight and TZ changes/travel), streak recovery-window logic, badge award idempotency (double-award on concurrent ticks?), badge revocation guarantees (broken streak must never revoke — stated invariant), goal-metric edge cases (goal edited mid-week, zero-goal), guest gating (JourneyGate) and register-upgrade seeding, offline journey rendering from persisted cache vs stale figures, Arabic pluralization of counts (`arDayCount`).
- **Skills/agents/tools.** `run`, `verify`; SQL verification against Phase 2 matrix; `/code-review`.
- **Deliverables.** Fixes + phase report incl. streak/day-boundary spec.
- **Exit criteria.** Streak math verified across TZ scenarios; checklist ×1 screen + 4 embedded cards.
- **Effort.** 1–2 sessions.

### Phase 7 — Community: Q&A, voice notes, benefits, notes, buddy, moderation
- **Objectives.** All user-generated-content surfaces are safe (anonymity, moderation, abuse) and correct.
- **Scope.** `questions.tsx`, `lecture-questions/[id]`, `lecture-benefits/[id]`, `lecture-note/[id]`, `buddy-search.tsx`, `components/questions/*` (incl. `VoiceRecorder`/`VoiceNotePlayer`), `ReportSheet`, buddy stores/hooks, `sheikh/index.tsx` (answering side), related RPCs (client behavior; server was Phase 2).
- **Tasks.** Full checklist per screen, plus: **anonymity end-to-end** (asker identity absent from every payload the sheikh/other students receive — inspect network responses, not just UI), voice-note recording permissions flow (deny → re-ask → settings), recording interruption (call mid-recording), upload failure/retry, max duration/size, playback of corrupt audio; note autosave debounce vs rapid navigation (data loss window) and offline note edits (outbox conflict if edited on two devices); benefits post→moderate→delete lifecycle incl. `is_mine` correctness after sign-out/in; buddy invitation races (simultaneous mutual invites, invite-then-ban, gender edge when profile has no gender), buddy cancel/re-pair; report flow for guests; blocked-word UX; multi-question answers (migration 0086) rendering.
- **Skills/agents/tools.** `run` with **two simultaneous test accounts** (+ a sheikh account via `seed-sheikh.mjs`); `verify`; `/security-review` (anonymity + UGC).
- **Deliverables.** Anonymity verification memo; fixes; phase report.
- **Exit criteria.** Checklist ×6 screens; two-device flows verified; anonymity proven at the network layer.
- **Effort.** 2–3 sessions.

### Phase 8 — Quizzes
- **Objectives.** Server-graded quiz integrity: no client-side answer leakage, timing enforced server-side, results respect admin visibility switches.
- **Scope.** `quiz/[id]`, `quiz-attempt/[attemptId]`, `quiz-result/[attemptId]`, `useQuizzes`, `components/quiz/*`, quiz RPCs (client behavior).
- **Tasks.** Full checklist, plus: answer-key never in any client payload before submit (inspect responses); countdown seeded from server remaining-seconds — device-clock tampering, backgrounding during countdown, kill-and-reopen mid-attempt, submit exactly at deadline, double-submit race; attempts-left enforcement (client bypass → server refusal); resume of in-progress attempt from another entry point; already-submitted redirect loop check; `show_result`/`show_correct_answers` all four combinations; guest gating; offline mid-attempt (answers queued or lost? — define and verify the contract); persisted-cache rule (only `myStats` — confirm no attempt data leaks to disk).
- **Skills/agents/tools.** `run`, `verify`; `/security-review` (grading integrity); `/code-review`.
- **Deliverables.** Fixes + phase report incl. attempt-lifecycle diagram.
- **Exit criteria.** Checklist ×3 screens; timing/integrity attacks all repelled server-side.
- **Effort.** 1–2 sessions.

### Phase 9 — Notifications, reminders, broadcasts, engagement systems
- **Objectives.** The full notification stack (push, local ladder, inbox, prefs, broadcasts) is correct, deduplicated, permission-safe, and calm.
- **Scope.** `notifications.tsx`, `reminder/[id]`, `PrefsToggles`, `src/lib/{notifications,notificationPhrases,notificationState,notify}.ts`, `notificationsStore`, `NotificationsBootstrap` (deep audit — Phase 1 only skimmed it), broadcasts (`BroadcastCard`, `useBroadcasts`), rating prompt, feedback sheet, share, onboarding tour (`TourCard`/`StartHereCard`/`tourStore`), `UpdateGate` interplay, bubble (verify flag-off is truly inert).
- **Tasks.** Full checklist, plus: permission flows (deny → toggle on in prefs → what happens; iOS provisional; Android 13+ POST_NOTIFICATIONS runtime prompt); push-token lifecycle (rotation, sign-out → token unregistered? cross-account token leakage on shared device); §7 priority dispatcher (resume > weekly-goal > daily) — verify dedup and that `NOTIF_TEST_MODE=false` paths are what ship; badge count reset; inbox mark-read races and `refetchType: 'all'` invalidation storms (perf); broadcast 1-day window + dismiss persistence + `recordBroadcastView` dedup; deep-link taps into gender-gated/unpublished/deleted content; notification content leaking private data on lock screen; rating-prompt threshold math (`addForegroundSeconds` across kills); tour on tiny screens and after content changes (`sectionId: null` path).
- **Skills/agents/tools.** Physical devices mandatory (push); `run`, `verify`; `/code-review`.
- **Deliverables.** Notification-matrix doc (type × trigger × platform × permission state); fixes; phase report.
- **Exit criteria.** Matrix verified on physical iOS + Android; no duplicate/orphan notifications in a 24h soak.
- **Risks.** Cron/server-push timing makes some cases slow to verify — use staging cron overrides, never `NOTIF_TEST_MODE` in a shipped build (add a release-check for it in Phase 12).
- **Effort.** 2–3 sessions.

### Phase 10 — Admin web dashboard + sheikh surface
- **Objectives.** All 22 admin screens + `sheikh/index.tsx` are production-quality; the upload pipeline (the content lifeline) is bulletproof; publisher/sheikh role boundaries hold in the UI *and* (already proven in Phase 2) at RLS.
- **Scope.** `app/admin/*` (dashboard, upload, lectures, sections, sheikhs, quizzes ×4 screens, questions, contributions, ratings, reports, feedback, reminders, broadcasts, featured, buddies, users + user detail, analytics, settings, unclassified), `components/admin/*`, `sheikh/index.tsx`, `useAdminGuard`, `AdminShell`.
- **Tasks.** Checklist per screen (web-adapted: browser matrix Chrome/Safari/Firefox, RTL in browser, no mini-player assumptions), plus: **upload form** end-to-end (huge files, transcode path `audioTranscode.web.ts` vs native, interrupt mid-upload, duplicate submission, R2 orphan on failed metadata write, draft→publish→notify-on-publish chain); section tree editing (move node under its own descendant — cycle guard; reorder; delete-with-children); publisher-role screen hiding vs direct-URL access; user management (role changes take effect on target's next boot? ban propagation timing); quiz editor (delete question with existing attempts); moderation queues (contributions/reports/feedback) pagination and action races; analytics correctness vs raw SQL; `unclassified` queue readiness for the future Telegram bot (stated design goal).
- **Skills/agents/tools.** `run` (web); browser via Playwright/manual; `/code-review`; `/security-review` (admin surface).
- **Deliverables.** Fixes; phase report; admin-screen inventory with per-screen status.
- **Exit criteria.** Checklist ×23 screens; upload chaos tests pass; role-boundary URL probing clean.
- **Effort.** 3 sessions (largest screen count; leverage per-screen parallelism via `general-purpose` agents for the read/analyze half if the user approves spawning).

### Phase 11 — Cross-cutting sweeps: performance, memory, accessibility, device matrix, chaos
- **Objectives.** System-level quality that per-screen passes can't see; burn down the accumulated P2/P3 backlog.
- **Scope.** Whole app.
- **Tasks.**
  1. **Performance**: cold-start time budget (boot→Home interactive) on low-end Android; JS-thread stalls during scroll (rails, long sections); re-render profiling (React DevTools) on Home and player; bundle size + `PLAN_PERFORMANCE.md` follow-ups; AsyncStorage cache size growth over a month of simulated use.
  2. **Memory soak**: 30-minute navigation soak on device, watch for listener/store growth; player memory across 20 consecutive lectures.
  3. **Accessibility sweep**: VoiceOver + TalkBack full pass on the 8 highest-traffic screens; contrast check of the theme palette; touch-target audit; font-scaling (iOS Dynamic Type / Android font size max) — RTL Arabic with 2× fonts.
  4. **Device matrix execution**: the Phase 0 matrix run end-to-end (smoke script of ~20 core flows per device); iPad specifically — portrait lock vs multitasking behavior, layout at tablet widths (declared support must either work or be dropped in app.json).
  5. **Chaos/network**: airplane-mode toggles mid-flow on every mutating screen; 3G throttling; server 500s/timeouts injected (staging); outbox replay storms; clock skew.
  6. **Orientation/theme**: confirm portrait lock actually holds everywhere (esp. player modal, web ignores it fine); confirm light-only forcing has no OS-dark bleed (system dialogs, keyboards, status bar).
  7. Batch-fix the P2/P3 backlog from `audit/FINDINGS.md`; run `simplify` skill over hot files touched repeatedly during the audit.
- **Skills/agents/tools.** `run`, `ins-apk`, physical device farm, React DevTools/Flipper-equivalent profiling, `simplify`, `dataviz` (perf report charts if useful).
- **Deliverables.** Perf baseline numbers (recorded in report for regression comparison); a11y report; device-matrix results grid; backlog burn-down; phase report.
- **Exit criteria.** No P0/P1 open anywhere; cold start within agreed budget; a11y pass on top screens; matrix grid green or consciously waived.
- **Effort.** 3 sessions.

### Phase 12 — Test infrastructure & regression safety net
- **Objectives.** The audit's manual verifications become durable. Today there are **zero tests** — the single biggest maintainability finding of the baseline.
- **Scope.** Test tooling selection + highest-value coverage, not 100% coverage.
- **Tasks.**
  1. Add Jest + React Native Testing Library; wire `npm test` and typecheck into a pre-push/CI step (GitHub Actions if the repo has a remote).
  2. Unit-test the pure logic first (highest value/effort ratio): streak/day-boundary math, badge thresholds, `arNum`/`arDayCount`/format helpers, outbox queue ordering, resumeCache, notification phrase/priority pickers, quiz status derivation.
  3. Contract tests for `src/api/*` against staging (or `pgTAP`/SQL tests for the RPC layer — decide in-phase).
  4. Component tests for the 5 most defect-dense components found during Phases 3–10 (data-driven choice from FINDINGS.md).
  5. Optional (recommend, user decides): Maestro flows for the 10-flow smoke script from Phase 11, runnable before each release.
  6. Document the testing conventions in CLAUDE.md.
- **Skills/agents/tools.** `verify`, `/code-review`; `claude-code-guide` agent if CI/harness questions arise.
- **Deliverables.** Running test suite + CI; testing conventions doc; phase report.
- **Exit criteria.** `npm test` green and guarding the audited invariants; CI red/green demonstrated.
- **Effort.** 2 sessions.

### Phase 13 — Release readiness & final sign-off
- **Objectives.** Ship-blocking hygiene: store compliance, config truth, final holistic review, go/no-go.
- **Scope.** Build/release chain + final review of everything.
- **Tasks.**
  1. **Release-config lint**: assert `USE_MOCK=false`, `NOTIF_TEST_MODE=false`, `DEMO_ACCOUNTS` absent from the release bundle (inspect the actual bundle output, don't trust the source), no staging URLs/keys in `env`, console.log stripping, sourcemap handling. Automate as `scripts/release-check.mjs` so it outlives the audit.
  2. Store compliance re-verification: iOS privacy manifests vs actual data collected (email, name, gender, listening data — the manifest currently declares only name+email: verify completeness), account-deletion flow (5.1.1(v)) re-test, background-audio justification, Android 15 edge-to-edge, target API levels, `IOS_SUBMISSION.md` refresh.
  3. Versioning/EAS: `app.json` version vs `APP_VERSION` vs UpdateGate minimums coherent; production build profile produces installable artifacts (build one of each; `ins-apk` the Android one).
  4. Data lifecycle sign-off: backup/restore posture for Supabase + R2; delete-account wipe re-verified against the final schema.
  5. **Final holistic review**: user runs `/code-review ultra` on the accumulated audit branch(es)/PRs (user-triggered — cannot be launched by the agent) + a final `/security-review`; triage anything new.
  6. Produce the **production sign-off report**: per-phase status, all waived findings with justification, perf baselines, known-risks register, and the go/no-go recommendation.
- **Skills/agents/tools.** `/security-review`, `/code-review ultra` (user runs), `ins-apk`, EAS CLI, `Artifact` (publish the sign-off report as a shareable page if desired).
- **Deliverables.** `scripts/release-check.mjs`; sign-off report (`audit/reports/SIGNOFF.md`); refreshed `IOS_SUBMISSION.md`.
- **Exit criteria.** Zero open P0/P1; release-check green on the actual build artifacts; sign-off report accepted by the user.
- **Effort.** 1–2 sessions.

---

## 4. Roadmap summary

| Phase | Focus | Effort (sessions) |
|---|---|---|
| 0 | Baseline, env, audit scaffolding, doc-rot fixes | 1–2 |
| 1 | Root shell, gates, RTL, persistence, deep links | 2 |
| 2 | Backend: migrations, RLS, RPCs, edge functions, R2 | 3 |
| 3 | Auth & identity (client) | 1–2 |
| 4 | Content browsing & discovery | 2 |
| 5 | **Player, downloads, progress** | 3 |
| 6 | Journey, streaks, badges | 1–2 |
| 7 | Community & UGC (Q&A, voice, notes, buddy) | 2–3 |
| 8 | Quizzes | 1–2 |
| 9 | Notifications & engagement | 2–3 |
| 10 | Admin dashboard + sheikh surface | 3 |
| 11 | Perf, memory, a11y, device matrix, chaos | 3 |
| 12 | Test infrastructure | 2 |
| 13 | Release readiness & sign-off | 1–2 |
| **Total** | | **≈ 27–34 focused sessions** |

**Ordering rationale.** Phase 1–2 first because every later phase's "is this a client bug or a
server bug?" question needs the shell and the RLS matrix settled. Player (5) before the
engagement systems that hang off playback state (6, 9). Admin (10) after student features so the
audit already knows what each admin action is supposed to produce. Sweeps (11) after all feature
fixes have landed. Tests (12) after behavior has been fixed — codify the *corrected* behavior.

**Parallelization.** Phases 3–9 are largely independent of each other once 1–2 are done; if the
user wants speed, the read/analyze halves can be farmed to `general-purpose` agents per feature
(fixes still land serially per branch). Otherwise execute serially — depth over speed, per the
audit's charter.

**Standing risks across the whole audit.**
- No staging environment yet confirmed → Phase 0 blocker to resolve first.
- Physical-device-only behaviors (audio focus, push, RTL restart) — emulator results are not sign-off evidence for Phases 5 and 9.
- The expo-audio patch is the single largest upgrade-fragility point in the codebase.
- Fixing RLS (Phase 2) can silently break client flows verified earlier — any policy change triggers a re-run of the affected feature's checklist.
- Scope temptation: 49 screens × ~30 checklist dimensions is enormous; the severity scheme and "confirmed-only fixes" rule are what keep this finishable.
