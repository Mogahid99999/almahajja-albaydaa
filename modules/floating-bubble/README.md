# Floating Bubble (resume overlay) — PLAN_V3 Phase 9

**Status: experimental, OFF by default, NOT yet linked into the build.**

A dhikr-reminder-style floating bubble that nudges the student to resume an
in-progress lesson, drawn *over other apps* while the phone is actively in use.
Android-only (iOS has no equivalent — it degrades to nothing).

This directory is **reference code, not autolinked**. It lives under `native/`
(not `modules/`) on purpose so it cannot affect the current verified build. The
JS policy layer (`src/lib/bubble.ts`) already ships dormant: with the module
unlinked, `requireOptionalNativeModule('FloatingBubble')` returns null and every
bubble call no-ops.

## What's here
- `expo-module.config.json` — Expo module manifest (Android).
- `index.ts` — JS entry: `requireNativeModule('FloatingBubble')`.
- `android/src/main/java/com/riwaqalilm/bubble/FloatingBubbleModule.kt` — the
  Expo module: `hasPermission` / `requestPermission` / `show` / `hide`, the
  `WindowManager` `TYPE_APPLICATION_OVERLAY` window, and an `ACTION_USER_PRESENT`
  (unlock) receiver that emits `onUserPresent` to JS.

## Activation (focused follow-up — needs a device + prebuild)
1. `git mv native/floating-bubble modules/floating-bubble` (Expo autolinks local
   modules from `modules/`).
2. Ensure `SYSTEM_ALERT_WINDOW` is in the manifest (already present) and that the
   `expo-notifications` plugin config (app.json) is applied.
3. `npx expo prebuild -p android` — **then re-apply the two local edits** that
   the bare `android/` carries and prebuild would reset:
   - `android/app/build.gradle` → `release { signingConfig signingConfigs.debug }`
   - `android/local.properties` → `sdk.dir=...`
4. Set `BUBBLE_ENABLED = true` in `src/config.ts`.
5. Wire a consent screen → `requestOverlayPermission()` (opens the system
   draw-over-other-apps toggle; it cannot be granted silently), gated behind the
   `bubbleEnabled` settings toggle.
6. Drive `maybeShowResumeBubble(...)` from the module's `onUserPresent` event with
   the current resume target (lessonId + paused second + title).
7. Build the release APK (see `PLAN_V2_NOTIFY_RESPONSIVE.md` §4) and device-verify
   per the §15 checklist: appears only while in use, ≤3/day, ≥2h gap, respects
   quiet hours (23:00–05:00), defers (not falls back) when locked, taps open the
   player at the exact paused second.

## Risks (per §13)
`SYSTEM_ALERT_WINDOW` user grant required; Android 12+ background-start + overlay
restrictions; Samsung One UI aggressive battery/overlay suppression. Ship behind
the flag and degrade to nothing if denied/unsupported.
