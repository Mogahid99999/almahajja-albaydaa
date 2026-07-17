# Phase 9 report — Notifications, reminders, broadcasts, engagement systems

**Method.** Static code review only — no physical devices available this session
(push/lock-screen/permission-prompt verification is explicitly deferred to a
device pass, per PLAN_AUDIT §9's own "physical devices mandatory" note).
**Scope.** `notifications.tsx`, `reminder/[id].tsx`, `PrefsToggles`,
`src/lib/{notifications,notificationPhrases,notificationState,notify}.ts`,
`notificationsStore`, `NotificationsBootstrap` (in `app/_layout.tsx`),
`BroadcastCard`/`useBroadcasts`, `RatingPromptModal`/`ratingPrompt.ts`,
`FeedbackSheet`, `TourCard`/`StartHereCard`/`tourStore`, `UpdateGate`
interplay, the floating bubble (`bubble.ts`, `BubbleConsent`), plus the SQL
notification fan-out (0003/0006/0007/0013/0016/0028) and `notify-on-publish`.
**Findings.** F-900 (P2, open), F-901 (P2, open). F-023 closed (verified
inert). F-033's Phase 9 leg confirmed real, stays open (root cause now points
at F-900).

---

## 1. What's clean

- **NOTIF_TEST_MODE**: `src/config.ts` has it hardcoded `false` — the
  short-delay/no-jitter test paths are not reachable in the shipped build.
- **§7 priority dispatcher** (`app/_layout.tsx`'s foreground handler): resume
  correctly outranks the daily reminder (`if (prefs.daily_reminder &&
  !hasResume) await scheduleDailyReminder(); else await cancelDailyReminder()`)
  — matches the documented resume > weekly-goal > daily order (weekly-goal is
  server cron-push, coordinated separately, so the local dispatcher only needs
  to arbitrate resume vs. daily). Re-arming on every foreground correctly
  resets the dead-man's-switch clock.
- **Dedup**: every local reminder type uses a deterministic identifier
  (`resume-<id>`, `series-<id>`, single `daily-reminder`) and cancels-before-
  reschedule, so re-saving progress replaces rather than stacks. Badge is
  cleared on every foreground.
- **Push-token identity hygiene**: `useNotificationsStore`'s `registered` flag
  is correctly reset in `stopDeviceSideEffects` (shared by sign-out, ban, and
  delete-account), so a second identity on the same device/run re-registers
  its own token instead of silently skipping registration under the flag left
  by the previous user. Voluntary sign-out unregisters its own token before
  the session drops.
- **Broadcast dedup**: `recordBroadcastView` is fire-and-forget with its own
  try/catch and the SQL RPC (0083) owns the actual dedup; `BroadcastCard`'s
  local dismiss list persists to AsyncStorage and is capped at 50 entries.
- **Gender guard on notification-open deep links**: both the cold-start path
  (`app/_layout.tsx`) and the in-app inbox (`notifications.tsx`) run
  `isLectureVisibleToViewer` before navigating to a pushed lecture — a broad
  push can't leak a gender-hidden lecture through a tap.
- **Bubble flag-off (F-023)**: confirmed truly inert by tracing every call
  site. `BUBBLE_ENABLED=false` short-circuits `native()` to `null` before any
  Android/module check, so `bubbleSupported()`, `bubbleEligibleNow()`,
  `maybeShowResumeBubble()`, and `addBubbleListeners()` are all no-ops, and
  `BubbleConsent` renders `null` (no dangling settings row for an absent
  module). Closed — no device verification needed since the gate is pure JS.
- Tour's `sectionId: null` path degrades correctly (`route()` returns `null`
  → `next()` skips the step quietly, terminating at `reset()` if every
  remaining step is unresolvable). Tiny-screen layout is unverifiable
  statically — deferred to the device pass per the task brief.

## 2. Findings

### F-900 (P2) — banned accounts keep receiving push (confirms F-033)
Neither `fanout_to_all` (0007, the new-lecture/new-attachment fan-out) nor any
of the direct-insert triggers (buddy activity 0016, questions 0028, weekly
goal 0013) filter on ban status — `profiles` has no ban column (0025's own
comment: status is derived from `auth.users.banned_until`, which none of
these functions read). `notify-on-publish`'s `push_tokens` lookup is a bare
`.eq('user_id', ...)`, same gap. Combined with the already-known fact that a
ban can't unregister the device token client-side (F-033), a banned account's
device keeps getting both inbox rows and real Expo pushes indefinitely.
Not fixed live — it touches six-plus migrations' security-definer functions
plus a deployed edge function; needs a security-review-backed change and a
staging soak, not a drive-by static-review edit. Phase 9 device pass: ban a
test account, confirm no push lands afterward.

### F-901 (P2) — question text leaks into lock-screen notification body
`ask_question`/`answer_question` (0028) put `left(question_body, 120/100)` —
the raw question text — directly into the notification's `body`, which Expo
Push forwards verbatim into the OS notification (lock-screen preview unless
the OS-level "hide content" setting is on). Every other notification type in
this codebase deliberately keeps push copy generic for this exact reason
(lecture *titles* only, never transcript; `buddy_activity` uses one fixed
phrase with zero specifics) — the Q&A path is the one place raw user content
rides into a system notification, potentially exposing a private or
anonymous-flagged question to anyone glancing at the sheikh's or asker's
locked phone. Recommend swapping to a generic phrase (mirroring
`buddy_activity`), full text in-app only. Left open (same live-migration
caution as F-900) rather than edited unreviewed.

## 3. Deferred to the device pass (per PLAN_AUDIT §9)
- iOS provisional / Android 13+ POST_NOTIFICATIONS runtime prompts.
- Actual push delivery, badge rendering on real launchers, lock-screen
  preview behavior under the OS's own hide-content setting.
- Tour on tiny screens / after content changes.
- 24h soak for duplicate/orphan notifications.
- F-900/F-901 live confirmation once fixed.

## 4. Exit criteria
Static checklist complete for all in-scope files; no code changes made this
pass (all real findings are either already-fixed-and-verified in earlier
phases, F-023 closing as inert-by-inspection, or F-900/F-901 needing a
reviewed live-migration change rather than a static-review edit). Device
matrix verification (push e2e, permission flows, badge, lock-screen content)
remains the explicit gate before Phase 9 can be marked fully closed.
