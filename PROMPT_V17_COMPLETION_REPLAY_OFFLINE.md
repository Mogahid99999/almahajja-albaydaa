# V17 — Fix lecture completion/replay logic + offline download persistence (student app)

Read `CLAUDE.md` first, then the memory index (`memory/MEMORY.md`) and load any
memory that looks relevant — especially `v10-offline-perf-plan`,
`v11-offline-sync-plan`, `background-audio-lockscreen`, `v13-r2-storage-migration-state`,
and `android-release-build-recipe`. This is an Expo SDK 56 app, Arabic **RTL**,
Supabase backend, audio via **expo-audio**, downloads via **expo-file-system**.

## How to work (non-negotiable)
- **This is a real, on-device audio/offline bug.** It does NOT reproduce in a
  browser and barely in an idle emulator — you must reproduce and verify on a
  **connected physical device** with real playback, real downloads, and real
  network toggling. Screenshots/logcat are the source of truth, not "it
  typechecks."
- Sign in as the **student test account**: `dffallacanan6@gmail.com` /
  `12345678` (guest-first native app — reach sign-in via the profile /
  «إنشاء حساب» entry, don't stay a guest).
- **Reproduce every bug first**, on device, and report a concrete before-state
  per bug. Then fix. Then re-verify the exact same steps on device.
- Work **autonomously**: do not stop to ask which approach to take or for
  permission to proceed. Pick the correct fix, implement it, verify on device,
  and report. Only surface a genuine, blocking, destructive-or-scope decision.
- `npx tsc --noEmit` must stay clean. Data access stays inside `src/api/*`.
  If (and only if) a migration is truly required it is append-only from the
  current latest number, applied to the live DB via the Supabase Management API
  with a browser User-Agent (see `supabase-mgmt-api-cloudflare-ua` memory), and
  `node scripts/security-check.mjs` must stay green.

---

## Problem 1 — Completion logic wrongly locks a lecture and «stuck» on replay/seek when ONLINE

### Reported symptoms
- Listen to ~90% of a lecture, leave, come back → the app treats it as
  **completed and won't play it again**.
- Trying to replay it, or dragging the **seek bar** to any position, leaves the
  player **stuck** — playback never starts.
- The bug appears **only with an internet connection**; it does NOT happen
  offline. (This asymmetry is the key diagnostic clue — see below.)

### Required behavior
1. Use a **95%** completion threshold (or the single configured value) to mark a
   lecture complete — not 90%.
2. **Even after a lecture is marked complete, keep saving the real last
   position (seek position).** Completion must not overwrite the resume point
   with the end of the track.
3. Reopening a lecture (even a completed one) **resumes from the last saved
   position**, not the end.
4. The user can **drag the seek bar to any position and playback starts
   immediately** — no hang — whether the lecture is complete or not.
5. **Every lecture is fully replayable**, online AND offline.
6. At 100% it still shows as completed, but the user can freely replay and
   scrub, with the last position continuing to save.

### Where to look / likely root cause (verify on device, don't blind-fix)
- Completion threshold constant: `src/config.ts` → `COMPLETE_THRESHOLD = 0.9`
  (change to `0.95`, and make sure nothing else hard-codes 0.9).
- **The online-only «stuck» is almost certainly a resume-position corruption,
  not a network issue.** In `src/lib/audioController.ts`:
  - `persist(positionSec, finished)` (~line 402) saves
    `pos = finished ? currentDuration : positionSec` and calls
    `saveLectureProgress({ positionSec: pos, completed: reachedThreshold, ... })`.
    So on completion the **server progress row's `positionSec` gets pinned to
    the end of the track** (full duration).
  - On the next open **while online**, `loadLectureBody` adopts the server
    resume position: around line 626-629 it does
    `if (!opts?.restart && data.positionSec > here) void seekTo(data.positionSec)`
    — i.e. it seeks the fresh player straight back to the END, which immediately
    re-satisfies completion / `didJustFinish`, so playback can't run and a
    seek-back-forward fights the server value. **Offline, that server row is
    never read**, so the local resume cache (real last position) is used and the
    bug disappears — exactly matching the report.
  - The `seekGuardUntil` window (seek → `didJustFinish` ignored) and
    `justFinished`/`trackCompleted` flags are involved in whether a manual
    replay/seek revives the player; confirm a seek after natural end actually
    restarts (the code notes a native ENDED player sometimes needs a fresh
    `createPlayer` rather than `replace()`).
- **Fix direction (decide from the evidence, keep it minimal):**
  - Stop persisting the *end of the track* as the resume position on completion.
    Keep `completed`/`justCompleted` reporting for badges, but save the **actual
    last listened position** as `positionSec` (both to the server row and the
    local resume cache / download sidecar), so a completed lecture reopens where
    the user really was — not at the end.
  - Ensure the resume-adoption in `loadLectureBody` can never yank playback to a
    position at/near the end that instantly re-completes it (e.g. treat a resume
    position within the last few seconds / past the completion point as "start
    from a sensible place" or 0, and never let it re-trigger completion).
  - Guarantee a manual seek (and pressing play after natural end) reliably
    (re)starts the native player, rebuilding it when it's in the ENDED state
    (mirror the existing `justFinished` / `forceFreshPlayer` handling).
  - Confirm the `restart`/replay path (`LoadOpts.restart`, `seekTo`) works from
    a completed state both online and offline.

### Verify on device (Problem 1)
- Online: play a lecture to ~92%, background the app, reopen from Home/section →
  it must resume near ~92% and **play** (not sit at the end, not stuck).
- Online: on a lecture already at/over threshold, drag the seek bar to the
  middle and to near-start → playback starts immediately each time.
- Repeat both offline (airplane mode, using a downloaded lecture) → identical
  behavior.
- Take one to 100%, confirm it shows completed, then replay + scrub freely and
  confirm the last position keeps saving across a reopen.

---

## Problem 2 — Downloaded lectures lose their "downloaded" state until an online refresh

### Reported symptoms
- Download a lecture, then close the app or leave the phone for a couple of
  hours → on reopening, the lecture may **no longer show as downloaded**, even
  though the audio file is still physically on the device.
- The app only re-recognizes it **after** the internet is turned on and a small
  refresh happens; then it shows as downloaded again.

### Required behavior
1. "Is this downloaded?" must be answered from **local state (the on-device
   manifest / local DB / filesystem)** — never from a server sync.
2. The app must work **fully offline after the first online sync + download**.
3. Downloaded lectures stay visible as downloaded for **days/months offline**,
   across full app close and **Force Stop**, as long as the files exist on disk.
4. After one online session where the user downloaded lectures, they can, with
   **no internet at all**: open the app, play every downloaded lecture, see the
   correct download state, and keep their last position, notes, and progress
   history — surviving a Force Stop without needing to reconnect.

### Where to look / likely root cause (verify on device)
- Local download source of truth is the manifest: `src/lib/downloads.ts`
  (`.manifest.json` in the app's private Documents dir, `readManifest()` /
  `writeManifest()`, `relativePathFor`, SAF `safUri` entries). This is correct
  in principle — the bug is that the **download state surfaced to the UI is not
  being hydrated from that manifest reliably at cold start / offline**.
- `src/stores/downloadsStore.ts` (Zustand) is **not** `persist`-wrapped — so
  its "downloaded" set is rebuilt at launch. Trace how it's seeded:
  - Confirm the store is hydrated from `readManifest()` **synchronously/early
    and unconditionally at startup**, before and independently of any network
    call — not from (or gated behind) a server list, a `useDownloads` query, or
    connectivity.
  - Check `src/hooks/useDownloads.ts` and `DownloadButton.tsx` /
    `DownloadedLectureRow.tsx` for a code path where download status is derived
    from server data (or a query that fails/empties offline) instead of the
    manifest.
  - Check whether a cold start races: the manifest read completing *after* the
    first render leaves the row showing "not downloaded" until something (the
    online refresh) re-runs it. If so, hydrate eagerly and mark the store
    hydrated so the UI waits for local truth, not server truth.
  - Confirm the SAF/`content://` path (`downloads.ts` ~line 193) still validates
    existence appropriately offline and doesn't drop entries it can't
    live-check.
- Also confirm **progress, resume position, and notes** survive Force Stop
  offline (they should already via the resume cache + outbox from V10/V11 —
  verify, and fix if this bug's hydration issue also affects them).

### Verify on device (Problem 2)
- Online: download 2-3 lectures across different sections. Confirm they show
  downloaded.
- Enable airplane mode, **Force Stop** the app (App info → Force stop), wait,
  relaunch with no network → all downloaded lectures still show downloaded and
  **play** offline; last position / notes / progress intact.
- Leave it a long gap if feasible (or simulate by clearing the in-memory store /
  cold launch repeatedly) → downloaded state must never depend on a network
  refresh to reappear.

---

## Environment / device tips
- `adb` lives at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` (not on
  PATH). The app package is `com.riwaqalilm.app`. Target the device explicitly
  with `-s <serial>` (`adb devices` first).
- For a JS-only fix, a debug build + the running Metro dev server fast-refreshes
  on device; for a clean end-to-end check build/install a fresh APK (release
  recipe + JAVA_HOME/node-on-PATH gotchas are in `android-release-build-recipe`).
- Screenshot: `adb -s <serial> exec-out screencap -p > shot.png`, then **look at
  it**. Toggle network with `adb -s <serial> shell svc wifi disable/enable` +
  `svc data disable/enable`, or airplane mode, to reproduce the online-vs-offline
  asymmetry.

## Definition of done
- Both problems reproduced on the connected device (before-state captured), then
  fixed, then the exact repro steps re-verified as passing on device — online
  AND offline where stated.
- Threshold is 95%; completed lectures resume at the true last position, are
  fully replayable, and seek never hangs, online or offline.
- Downloaded state is answered purely from local storage, survives Force Stop
  and long offline gaps, and the app is fully usable offline after one online
  sync.
- `npx tsc --noEmit` clean; `node scripts/security-check.mjs` green if any
  migration was touched (prefer none).
- Short written report: root cause per bug → fix made → device verification, and
  update memory with a V17 note.
