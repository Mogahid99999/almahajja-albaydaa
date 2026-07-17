# Phase 11 report — Cross-cutting sweeps: performance, memory, accessibility, device matrix, chaos

**Method.** Mixed: static code audit (memory/listener leaks, accessibility labels,
release-config truth) plus one physical Android device pass via `adb` (debug build —
no release build, no iOS device, no tablet). Full device-matrix execution (30-min soak,
full VoiceOver/TalkBack pass, network chaos injection) was **not** performed live this
pass — deferred, not waived, matching the posture Phase 5 set for its own
device-dependent items (`audit/reports/phase-5.md`).

**Findings.** F-1100 (P2, fixed), F-1101 (P2, fixed), F-1102 (P3, open), F-1103 (P3,
open), F-1104 (release-check clean, script added), F-1105 (P3 lead, open),
F-1106 (P3 lead, open).

---

## 1. Memory / listener-leak sweep (static)

Every `AppState`/event-emitter listener and `setInterval`/`setTimeout` registration in
`app/` and `src/` was traced to its cleanup:

- `app/_layout.tsx` (3× `AppState` listeners), `quiz-attempt/[attemptId].tsx` (interval +
  listener), `src/lib/outbox.ts` (heartbeat interval), `src/lib/audioController.ts`
  (player event listeners across `createPlayer`/`teardownPlayer`), `lecture-note/[id].tsx`
  (autosave timer) — all correctly torn down on unmount/reload. No leak.
- `src/lib/supabase.ts:42` — module-scope `AppState` listener, never captured. Harmless:
  the module is a singleton loaded once, never unmounted.
- `app/(auth)/sign-in.tsx:26` — `BackHandler` listener, flagged by the research pass as
  needing direct confirmation; **confirmed clean** (`.remove()` present in the effect
  cleanup at line 31).
- F-1102 — three admin screens' `flash()` toast helper doesn't capture/clear its
  `setTimeout`; unmount-within-3s calls `setState` on an unmounted component. P3, no
  crash on current RN, logged not fixed (low-traffic screens, small scoped fix available
  if the owner wants it).
- F-1103 — `src/lib/connectivity.ts` debounce timer possibly not cleared before
  reassignment on rapid flapping. P3, logged, not reproduced.

**Verdict:** no P0/P1 memory leaks found. The codebase's listener-cleanup discipline is
good — every component-lifecycle-bound registration this pass found had a matching
cleanup; the only gaps are two small P3s in low-traffic admin/utility code.

## 2. Accessibility sweep (static — labels & touch targets)

Checked `TouchableOpacity`/`Pressable`/`TouchableHighlight` usage across the highest-
traffic screens (Home, player, section, journey, admin dashboard shell) for missing
`accessibilityRole`/`accessibilityLabel`, focusing on icon-only buttons (nothing for
VoiceOver/TalkBack to read).

**Fixed this pass:**
- **F-1100** — `MiniPlayer`'s play/pause toggle (icon-only, no label at all) and the
  outer card (no role, relied on nested text being read out of context). Added
  `accessibilityRole="button"` and a state-aware Arabic label to the toggle
  (`"تشغيل"`/`"إيقاف مؤقت"`), and a composed label to the card
  (`"متابعة الاستماع: {title}"`).
- **F-1101** — admin dashboard's `StatCard`, `UrgentReportsBanner`, and `QuickLink`
  components all lacked accessibility props. Added role + composed Arabic label to each.

**Already clean** (verified, not touched): `ContinueCard`, `SectionsGrid`,
`LectureRowItem`, `GoalCard`, `DownloadButton`, shared `IconButton`, and the MiniPlayer's
close/next buttons already had correct `accessibilityRole`/`accessibilityLabel`. Student
screens (`(student)/index.tsx`, `section/[id].tsx`, `journey.tsx`) compose these shared
primitives rather than raw `Pressable`s, so they inherit the good state except where the
shared component itself was gapped (MiniPlayer, above).

**Not done this pass:** a live VoiceOver/TalkBack pass (the plan's actual acceptance
bar — static label presence proves *something* is announced, not that the announced
order/flow is correct), font-scaling at 2× Dynamic Type / Android max, and full
touch-target measurement beyond the two icon buttons spot-checked. Deferred to F-1106.

## 3. Release-config lint (Phase 13 deliverable, pulled forward)

Since this sweep already needed to check `src/config.ts` flags and grep for hardcoded
secrets, the actual `scripts/release-check.mjs` script (specified for Phase 13) was
written and verified rather than just eyeballing the values once:

```
PASS  USE_MOCK is false
PASS  NOTIF_TEST_MODE is false
PASS  BUBBLE_ENABLED is false
PASS  DEMO_ACCOUNTS gated behind USE_MOCK
PASS  no hardcoded Supabase URLs outside env.ts
PASS  no hardcoded Supabase secret/service-role key literals
SKIP  bundle-level checks (need --bundle <path> to a built bundle)
```

The bundle-level leg (grepping an actual built JS bundle for literal leaked strings,
per PLAN_AUDIT §13.1 "inspect the actual bundle output, don't trust the source") is
wired but unexercised — no release/EAS bundle was built this pass. Run it against a real
build artifact in Phase 13 proper.

## 4. Device pass (physical Android, debug build)

Connected device: Samsung Galaxy A71 (SM-A715F), Android, arm64-v8a, mid/low tier —
via `adb` (USB debugging authorized this session).

- Built and installed a debug APK (`npx expo run:android`; required switching
  `JAVA_HOME` to Temurin 17 — the system default Temurin 26 fails the Android Gradle
  Plugin's `jlink`/`core-for-system-modules` transform on this toolchain; **note for
  future device passes on this machine**).
- App launched, bundled (2308 modules), and rendered on-device without crash.
- Cold-start measured via `ActivityTaskManager: Displayed` logcat line: **~16.7s**
  (F-1105). This is a **debug build** number — Metro/dev-bridge overhead inflates it
  well past what a release Hermes build would show. Not usable as a perf baseline;
  re-measure against a release build in Phase 13.
- No crash, no ANR, no visible layout break on first paint (RTL rendered correctly,
  status bar/insets handled).

**Not exercised this pass** (F-1106): the 30-minute navigation memory soak, 20-consecutive-
lecture player memory check, VoiceOver/TalkBack pass, iPad/tablet layout, small-phone
(SE-class)/Go-class Android, Android 15 target, network chaos (airplane mode mid-flow,
3G throttle, injected 500s/timeouts), and orientation/theme checks (portrait-lock holding,
light-only forcing with no OS-dark bleed). These need either more device time than one
session affords or hardware not available here (iOS device, tablet, second Android tier).

## 5. What's clean

- Release-config flags (`USE_MOCK`, `NOTIF_TEST_MODE`, `BUBBLE_ENABLED`, `DEMO_ACCOUNTS`
  gating) — all correct, now covered by an automatable script.
- Listener/timer cleanup discipline across the app — no P0/P1 leaks found.
- App boots and renders correctly on a real mid-tier Android device.
- Shared UI primitives (`IconButton`, `DownloadButton`, `GoalCard`, etc.) already carry
  correct accessibility props — the gaps found were in two components that used raw
  `Pressable` directly instead of the shared primitives.

## 6. Deferred (not waived)

F-1105 (cold-start needs a release-build re-measurement) and F-1106 (full device-matrix
execution: soak, a11y live pass, tablet/small-phone/Android-15, network chaos,
orientation/theme) are logged as open leads for the Phase 13 pass or a dedicated
device-farm session, per the same "deferred, not waived" convention Phase 5 used for its
own physical-device exit criteria.
