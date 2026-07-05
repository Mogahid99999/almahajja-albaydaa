# PLAN 4 — Play Store Submission Hygiene

Source: static/security code scan. None of these are crashes or functional
bugs — they're the kind of thing that gets an app rejected, flagged, or
delayed during Google Play review, or causes friction on the *next* release
after this one. Lower urgency than Plans 1–3 but should be resolved before
hitting "submit."

---

## Phase 4.1 — Remove the unused RECORD_AUDIO permission

**File:** `app.json` (`android.permissions` array), which generates
`android/app/src/main/AndroidManifest.xml`.

**Problem:** `android.permission.RECORD_AUDIO` is declared, but nothing in
the codebase actually records audio — this is a pure playback app
(`expo-audio`, no recorder API called anywhere; confirmed via a full grep of
`app/`, `src/`, `modules/` for `RECORD_AUDIO`, `useAudioRecorder`,
`requestRecordingPermissions`, `AudioRecorder` — zero hits). An unused
sensitive/dangerous permission is a known Google Play review flag (mismatch
with the Data Safety form) and undermines user trust ("why does an Islamic
lecture app want my microphone?").

**Fix:** remove `"android.permission.RECORD_AUDIO"` from `app.json`'s
`android.permissions` list. Keep `MODIFY_AUDIO_SETTINGS` and the
`FOREGROUND_SERVICE*` permissions — those ARE needed for the working
background-audio/media-session behavior. Rebuild and confirm background
playback + media notification controls still work after removal (they
should — recording and playback permissions are independent).

---

## Phase 4.2 — Decide on the floating-bubble feature before this submission

**Files:** `android/app/src/main/AndroidManifest.xml` (`SYSTEM_ALERT_WINDOW`
permission), `src/config.ts` (`BUBBLE_ENABLED = true`),
`modules/floating-bubble/` (a real, compiled native Kotlin module — not a
stub; both debug and release build outputs present).

**Problem:** `SYSTEM_ALERT_WINDOW` ("draw over other apps") is one of the
most heavily-scrutinized special permissions in Google Play review — it
requires an explicit Permissions Declaration (written justification, often
a demo video) and apps without a clear essential use case risk rejection or
a materially slower review. The in-code comment next to `BUBBLE_ENABLED`
says "OFF by default," but the value is currently `true`, so the feature
ships active in the current build regardless of that comment's intent.

**This needs an owner decision, not a unilateral code change** — ask
whether shipping the floating "resume bubble" feature in this first Play
Store submission is intentional:
- **If not essential for launch:** set `BUBBLE_ENABLED = false` in
  `src/config.ts` and remove `SYSTEM_ALERT_WINDOW` from `app.json`'s
  permissions for this submission. The native module code doesn't need to
  be deleted — just disabled — so it can be re-enabled in a later release
  once a proper Play Console permissions declaration is prepared.
- **If it should ship now:** leave the code as-is, but flag to the owner
  that they need to prepare the Play Console "sensitive permissions"
  declaration for `SYSTEM_ALERT_WINDOW` before submitting, or the review
  will likely stall.

---

## Phase 4.3 — Fix the two banned `row-reverse` usages

**Files:** `app/(auth)/sign-in.tsx:134` (WhatsApp support-link row) and
`app/(auth)/sign-in.tsx:191` (`pwWrapStyle`, password show/hide-eye row).

**Problem:** the app forces native RTL globally
(`I18nManager.forceRTL(true)`, both in `app/_layout.tsx:103` and natively in
`MainApplication.kt`), which already auto-mirrors plain `flexDirection:
'row'` children right-to-left. Explicitly setting `row-reverse` on top of
that cancels the automatic mirroring, flipping child order back toward LTR
— these are the ONLY two `row-reverse` occurrences in the entire `app/` +
`src/` tree; every other RTL-sensitive spot in the codebase correctly uses
plain `row` + physical left/right styling instead.

**Fix:** replace both with plain `flexDirection: 'row'`. Then visually
verify on-device: does the WhatsApp icon+text land on the intended side of
the support-link row, and does the password field's show/hide eye icon land
on the correct side? If the current `row-reverse` output actually looks
correct when checked visually (possible if there's a compensating style
elsewhere), leave it as-is but add a one-line comment explaining why this
spot is a deliberate exception to the project's `row-reverse` ban — don't
silently remove it without checking, since flipping a currently-correct
layout would be a regression.

*(This is also referenced in Plan 2 as a related RTL cause — do this fix as
part of whichever plan gets picked up first; don't do it twice.)*

---

## Phase 4.4 — Set an explicit `android.versionCode` in app.json

**File:** `app.json` (`android` block). Currently the only place
`versionCode` exists is inside the gitignored, prebuild-regenerated
`android/app/build.gradle:95` (`versionCode 1`).

**Problem:** since `android/` isn't committed to git, a future
`expo prebuild --clean` fully regenerates it. Without `expo.android.versionCode`
set explicitly in `app.json`, that regeneration resets `versionCode` back to
Expo's CNG default (1) rather than preserving whatever was actually
submitted to Play last time. Harmless for THIS first submission, but Google
Play requires a strictly increasing `versionCode` on every subsequent
upload — this is a footgun for the *next* release, not this one.

**Fix:** add `"versionCode": 1` explicitly under `app.json`'s `expo.android`
block now, and make a note (in whatever release-process doc/checklist this
project uses, or just as a PR comment) that it must be manually incremented
alongside `version` before every future submission.

---

## Phase 4.5 — Routine dependency/config hygiene (low priority, quick wins)

Bundle these together since they're all small and mechanical:

1. **`app.json`'s legacy top-level `splash` key** fails SDK-56 schema
   validation per `expo-doctor` (SDK 53+ deprecated it in favor of the
   `expo-splash-screen` config plugin). Currently harmless — the prebuilt
   splash assets are still honored by Expo's backward-compat prebuild layer
   — but migrate to the `expo-splash-screen` plugin when convenient, not
   urgent for this submission.
2. **7 packages one-or-two patch versions behind** their SDK-56-expected
   versions (`@expo/metro-runtime`, `expo`, `expo-asset`, `expo-constants`,
   `expo-linking`, `expo-notifications`, `expo-router`). Run
   `npx expo install --check` and accept the patch bumps — routine hygiene,
   nothing currently broken.
3. **`outbox.ts` offline-queue has no size/age cap**
   (`src/lib/outbox.ts:56-85`) — every enqueue/flush re-serializes the
   *entire* queue to AsyncStorage with no eviction of very old entries.
   Not currently exploitable or user-visible, but a multi-week offline
   stretch across many lectures would make every tick progressively more
   expensive with no upper bound. Low priority: add a cap (e.g. drop/merge
   entries older than N days) whenever this area is next touched.
