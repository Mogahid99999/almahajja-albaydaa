# Phase 5 report — Audio player, downloads, and progress

**Branch:** `audit/phase-5-player` · **Session:** 2026-07-16 · **Findings range:** F-500…F-515
(+ closes F-039, annotates F-016).

**Owner constraint for this session:** the player is confirmed working on real devices by
the owner; this phase executed **everything that does not require a physical device** —
full code-path audit, state-machine mapping, static verification of every transition,
confirmed-fix work, and regression tests. All device-only rows are explicitly deferred
(§5) and stay attached to F-019's device pass; **emulator/simulator results were not used
as sign-off evidence for anything** (PLAN_AUDIT standing risk).

## 1. What was audited

Whole playback vertical: `app/player/[id].tsx`, `MiniPlayer`, `components/player/*`
(TransportControls, Waveform, PlaybackRateSlider, PlayerUtilityBar, LessonToolsRow/Sheet),
`playerStore`, `downloadsStore`, `src/lib/{audioController,audioDuration,resumeCache,downloads}.ts`,
`useDownloads`/`useProgress`/`useLecture`, `DownloadButton`, `downloads.tsx`,
`DownloadedLectureRow`, `src/api/progress.ts`, the playback legs of `src/api/lectures.ts`,
the expo-audio patch (all 7 Kotlin hunks re-verified in node_modules), the signed-URL
lifecycle (`r2-read-url` 3600s ↔ 30-min controller staleTime ↔ 45-min screen staleTime ↔
persistence allowlist), and every `preloadLecture`/`playLecture` call site app-wide.

## 2. Deliverables

- **State-machine doc:** `audit/reports/phase-5-state-machine.md` — 3-layer state model,
  25-row transition table, load pipeline, progress-persistence contract, and the
  signed-URL expiry proof (task 2: a mid-playback expiry IS possible on >60-min streams,
  and the T16 silent-rebuild path provably recovers with a fresh URL because at expiry
  time the cache entry is always older than the 30-min staleTime; pause-overnight-resume
  recovers through the same path).
- **expo-audio patch dossier:** `audit/EXPO_AUDIO_PATCH.md` extended with the Phase-5
  JS-contract verification (listener wiring, durationMs seed→real refresh, deepLinkUri
  freshness, no listener leak, delayed-focus contract intact).
- **Fixes + regression tests:** below; `src/lib/__tests__/audioControllerLoad.test.ts`
  (7 tests) and `src/lib/__tests__/downloadsManifest.test.ts` (7 tests), one named
  regression per fixed finding.

## 3. Findings fixed this phase

| ID | Sev | One-line |
|---|---|---|
| F-500 | P2 | Row-started load failures were dropped (screen's fallback preload no-op'd on the in-flight load) → silently dead player screen; in-flight promise now shared |
| F-501 | P2 | Five internal recovery reloads (`toggle` after end/error, seek-after-end, error-retry timer, reconnect) swallowed their own failure → stuck spinner/dead pause with recovery disarmed; `reloadCurrent()` surfaces via `loadError` |
| F-502 | P2 | Offline auto-advance + next/prev dead for downloaded series; sidecar now carries `sectionId`/`order`, neighbours resolve from the manifest offline (and as fallback on failed fetches) |
| F-503 | P2 | (= F-039) unbounded row-mount signed-URL prefetch flood; in-flight mint budget (4) |
| F-504 | P2 | Android SAF download buffered the whole audio file as one base64 JS string (OOM risk on long lectures); replaced with a native streaming `File.move` into the SAF tree |
| F-505 | P3 | Unclamped deep-link `?t=` past the end instantly completed a lecture (didJustFinish with no seek-guard); clamped to duration−1 |
| F-506 | P3 | Download manifest re-read+parsed from disk on every call on hot per-row/per-tick paths; in-memory mirror (single-writer invariant) |
| F-507 | P3 | `?t=` was ignored when the target lecture was already current; now seeks forward (never rewinds) |

Logged, not fixed: F-508 (rate resets on close/restart — product decision), F-509 (slow-server
timeout wears offline copy), F-510 (neighbour queries fetch whole section), F-511
(DownloadButton double-tap race), F-512 (iOS partial-file orphan — wontfix, self-heals),
**F-513 (P2 lead → Phase 13: iOS downloads sit in iCloud-backed-up Documents — Apple 2.23
store-review risk; expo-file-system's new API has no backup-exclusion flag, needs a config
plugin or an owner risk-acceptance)**, F-514 (per-session re-praise — wontfix), F-515
(`ensureAudioMode` failure never retried).

## 4. Task-by-task status (PLAN_AUDIT Phase 5)

1. **State machine mapped + every transition verified** — done statically (doc §4);
   device-behavior rows marked [device].
2. **Signed-URL lifecycle** — proven (doc §6). The `_layout.tsx` allowlist comment
   (45-min staleTime "stays under TTL") is accurate but the controller's own 30-min
   `ensureQueryData` bound is what actually protects audio starts; both verified.
3. **Background audio / interruptions / kill-restore / audio-session** — **deferred to
   device pass** (owner confirms working today; patch dossier lists exactly what to
   re-verify after any expo-audio upgrade).
4. **Progress writes** — tick cadence (≥5s), forward-only delta capped at 90s/save,
   completion at 0.95 (matches CLAUDE.md since the Phase-0 F-008 fix), never-un-complete,
   resume never pinned to the end, offline ticks day-stamped through the outbox (F-043
   contract), identity-boundary outbox clearing (F-025) unaffected. Scrub-guard bypass
   bound documented: ≤90s credited per save event; the client is not the security
   boundary (Phase 2 owns RPC-side clamps). Double-device: `save_activity` upsert is
   last-write-wins on position (forward-adopted on read), deltas additive — no corruption
   path found.
5. **Downloads** — interrupt/kill (F-512 logged; Android immune via temp+move),
   storage-full surfaces as the error state (message from FS layer), redownload-over-existing
   verified consistent (manifest only commits after success; verify-prune reconciles),
   delete-while-playing: playback continues on the open file handle (iOS) / provider
   stream (Android) until track switch — next load falls back to streaming; orphan
   reconciliation (`useHydrateDownloads` + per-row `verifyDownload`) verified incl. the
   F-506 cache; integrity of partial files: iOS-only edge logged as F-512; iCloud backup
   → F-513; Android scoped storage (SAF) flow re-read end-to-end, OOM copy fixed (F-504).
6. **Auto-advance** — online, offline-downloaded (F-502), gender-guard N/A within a
   section (same-section neighbours share visibility; server filters `published`),
   double-fire guarded (`lastAutoAdvancedFrom`), warm-ahead once per track.
7. **Player UI** — RTL waveform math verified (pageX + mirror under `I18nManager.isRTL`);
   Android sheet/swipe-dismiss logic re-read incl. the documented transparentModal flash
   workaround (no-history fallback to `/` present); rate slider extremes clamped and
   stepped; compact-viewport layout paths sane. VoiceOver/TalkBack + tablet → Phase 11 /
   device pass (Waveform's `adjustable` role has no increment/decrement actions — noted
   for the Phase 11 a11y sweep).
8. **Memory/perf** — single player instance invariant holds at every path (teardown on
   ENDED/error/stop before recreate); mini↔full transitions hold no subscriptions beyond
   zustand hooks; the one unbounded per-row cost found (prefetch flood + manifest
   re-parsing) fixed as F-503/F-506. Long-session buffer retention → device soak
   (Phase 11).

## 5. Deferred to the physical-device pass (with F-019)

Lock-screen/notification controls (patched prev/next, scrubber, deep-link tap), delayed
audio focus over Bluetooth/car, interruption matrix (call, other-app audio, unplug),
kill-and-restore, Doze-locked auto-advance to a never-played lecture, F-016 ogg decode
on iOS, F-504 one real SAF download on Android, F-502 offline auto-advance through a real
downloaded series, gesture-handler v3 (F-003) swipe/scrub feel, per-screen a11y/tablet
rows (§2 checklist columns marked N/A-this-session accordingly).

## 6. Verification

`npm run typecheck` clean · `npm test` 150/150 green (18 suites, incl. the 14 new
Phase-5 regressions; both new suites exit without open handles — the one remaining
jest "worker failed to exit gracefully" warning reproduces on the pre-existing suite
alone, logged for Phase 12 hygiene) · no migrations touched (no security-check needed)
· `verify` skill N/A for device-runtime surfaces per owner instruction; the pure-logic
changes are exercised by the new unit suites.

**/code-review high:** the multi-agent finder pass hit the session usage limit, so the
same 8 angles (line-by-line, removed-behavior, cross-file tracer, reuse,
simplification, efficiency, altitude, conventions) were executed inline with a
verify pass. Surviving findings, triaged:
1. **CONFIRMED, applied** — `reloadCurrent`'s failure surfacing could flash the error
   UI over a NEWER in-flight load of the same lecture (stale rejection landing during
   a user retry). Guarded with a `pendingId === lectureId` bail.
2. **CONFIRMED, applied** — the F-507 already-current `?t=` seek bypassed the F-505
   clamp (seekTo's own end-guard is only −0.25s), so a crafted past-the-end `t` could
   still near-instantly complete the current lecture. Now routed through
   `clampStartAt` like the load paths.
3. **PLAUSIBLE, logged** — prefetch budget slots can be held by fetches that pause
   under `networkMode: 'offlineFirst'` when the connection drops mid-flight,
   disabling row warming until reconnect (self-heals; prefetch is best-effort).
   Accepted; a timeout bound is the follow-up if it ever matters.
4. **Cleanup, not applied** — the startAt clamp block is duplicated across the two
   load paths (4 lines each, different duration sources); extraction judged not worth
   the parameter plumbing in this file's style.
