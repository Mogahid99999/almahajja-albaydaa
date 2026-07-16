# Phase 5 — Player state machine (playerStore + audioController)

> Deliverable of PLAN_AUDIT Phase 5 task 1. Derived from `src/lib/audioController.ts`
> (the single owner of the expo-audio instance), `src/stores/playerStore.ts`, and the
> screens that drive them. Every transition below was verified by code-path analysis
> in the 2026-07-16 audit session; rows marked **[device]** additionally need the
> physical-device pass (deferred — see `audit/reports/phase-5.md`).

## 1. State model

The machine is the product of three layers that must stay in agreement:

| Layer | State | Owner |
|---|---|---|
| **UI store** (`usePlayerStore`) | `currentLectureId, title, sheikhName, isPlaying, isLoading, positionSec, durationSec, rate, nextLectureId, prevLectureId, loadError, isStalled` | written ONLY by audioController |
| **Controller module state** | `player, currentId, currentDuration, currentSectionId, currentOrder, pendingId, pendingPromise, loadGen, justFinished, forceFreshPlayer, intendPlay, hasStartedPlaying, autoPlayRetries, errorRetryCount, seekGuardUntil, lastAutoAdvancedFrom, warmedNextFor, lastSavedAt/Pos, hasSavedTrack, trackCompleted, prefetchInFlight` | `src/lib/audioController.ts` |
| **Native player** (expo-audio) | idle / loading / buffering / playing / paused / **ENDED** / **ERROR** | ExoPlayer (Android, patched) / AVPlayer (iOS, stock) |

### Effective top-level states

```
CLOSED ──(load)──▶ LOADING ──▶ PLAYING ⇄ PAUSED
   ▲                  │  │         │
   │                  │  └──▶ UNAVAILABLE (offline + not downloaded)
   │                  ▼            │
   └──(stop)──── ERRORED ◀── STALLED (rebuffering)
                      ▲
                   ENDED (didJustFinish) ──▶ auto-advance → LOADING(next)
```

- **CLOSED** — `currentLectureId === null`; MiniPlayer unmounted, no native player.
- **LOADING** — `isLoading` true; native source resolving/decoding.
- **PLAYING / PAUSED** — `isPlaying` mirrors native `status.playing`.
- **STALLED** — playing but `isBuffering` with `position > 0`: "…جارٍ إعادة الاتصال" hint.
- **ERRORED** — `loadError` set (after 2 silent rebuild retries): retry UI in the full
  player; MiniPlayer play-tap rebuilds via `toggle()`'s loadError branch.
- **ENDED** — native ENDED after `didJustFinish`; `justFinished` flags that the
  instance cannot be revived by `replace()`/`play()` — every exit from ENDED
  **recreates** the player.
- **UNAVAILABLE** — the load rejected (offline + not downloaded, or 15s URL-fetch
  timeout); surfaced by the player screen's `unavailable` flag, not the store.

## 2. Entry points (who can start a load)

| Entry | Path | Notes |
|---|---|---|
| Lecture row / rail / search / downloads row / StartHereCard tap | `preloadLecture(id)` fired at tap, in parallel with `router.push('/player/id')` | Screen's mount effect is the fallback caller; F-500 makes both share ONE promise |
| Player screen mount (deep link, notification tap) | `preloadLecture(id, {startAtSec?})` | `?t=` clamped (F-505); on the already-current lecture `t` now seeks forward (F-507) |
| ContinueCard (Home) | `preloadLecture(id, {startAtSec})` / `playLecture(id)` / `pause()` | Phase 4 F-037 semantics |
| Lecture-note screen play chip | `playLecture(id)` | toggle-if-current |
| Admin lectures screen | `playLecture(id)` | web: no lock-screen session |
| Auto-advance | `playLecture(nextId)` from `didJustFinish` | guarded by `lastAutoAdvancedFrom` |
| Lock-screen / notification prev·next (Android, patched) | `mediaControlAction` event → `playNext()/playPrev()` | **[device]** |
| Reconnect recovery | `reloadCurrent(currentId, {startAtSec})` | 4s cooldown between attempts |

## 3. The load pipeline (`loadLecture` → `loadLectureBody` → `startPlayer`)

1. **Pause the outgoing track** if switching lectures (persist its position first).
2. `gen = ++loadGen`, `pendingId = id`, `pendingPromise = p` — every `await` below is
   followed by a `gen !== loadGen` bail so the **last requested lecture always wins**
   (rapid taps, auto-advance racing a manual tap, stop() mid-load).
3. **Fast path (downloaded + sidecar)**: resolve resume position =
   max(sidecar `positionSec`, resumeCache) → `sanitizeResumePosition` (≥ duration−15s
   → restart at 0) → clamp `startAtSec` (F-505) → commit module state (section context
   now seeded from the sidecar — F-502) → `setTrack` → `startPlayer(localUri)` —
   **zero network before audio starts**. Then a background `getLecturePlayback`
   refreshes section context + adopts a *further-ahead* server resume position
   (forward-only). Offline, neighbours resolve from the download manifest instead
   (F-502).
4. **Fast-fail**: not downloaded + `!isOnlineSync()` → throw immediately (player
   screen shows the offline notice). Load failures reaching a screen-less caller are
   surfaced via the shared promise (F-500).
5. **Streaming path**: `ensureQueryData(queryKeys.lecture(id))` bounded by a 15s
   timeout; staleTime 30min < the 3600s signed-URL TTL (§6). Then the same
   resume-sanitize/clamp ordering as the fast path (restart > startAt > max(server,
   resumeCache), never rewind) → commit → `resolveNext/resolvePrev` → `startPlayer`.
6. **`startPlayer`**: recreate the native player if `justFinished || forceFreshPlayer`
   (ENDED/errored/stalled instances don't survive `replace()`), else gapless
   `replace()`. Apply rate, seek, `play()`, arm `intendPlay`, bind lock-screen
   metadata (`syncLockScreen`).

## 4. Transition table

| # | From | Event | Guard | Effect / To |
|---|---|---|---|---|
| T1 | CLOSED/any | `preloadLecture(id)` | not current, not pending | load pipeline → LOADING |
| T2 | any | `preloadLecture(id)` same id pending | — | returns the in-flight promise (F-500) |
| T3 | any | `preloadLecture(current, {t})` | `t >` position | `seekTo(t)` (F-507); else no-op |
| T4 | PLAYING | `playLecture(current)` / `toggle()` | — | pause + persist + invalidate views → PAUSED |
| T5 | PAUSED | `toggle()` | not ended/errored | `play()`, arm intendPlay → PLAYING |
| T6 | ENDED | `toggle()` | `justFinished` | `reloadCurrent(restart:true)` → LOADING (fresh player, from 0) |
| T7 | ERRORED | `toggle()` | `loadError` | `forceFreshPlayer`; `reloadCurrent(startAt: here)` → LOADING |
| T8 | LOADING | first `status.playing` | — | `hasStartedPlaying=true` → PLAYING |
| T9 | LOADING | loaded but not playing | `intendPlay && !hasStartedPlaying`, ≤5 retries | re-issue `play()` (auto-start guard; never overrides a later lock-screen pause) |
| T10 | PLAYING | tick (1s) | >5s since save | `persist(pos)` (§7) |
| T11 | PLAYING | position ≥ duration−120s | autoAdvance on, next known, online, once/track | force-warm next lecture's fresh signed URL (`warmNextPlayback`) |
| T12 | PLAYING | `didJustFinish` | not seek-induced (`seekGuardUntil`), not already handled (`lastAutoAdvancedFrom`) | persist(complete, real pos), `justFinished=true` → ENDED; if autoAdvance && next → T13 |
| T13 | ENDED | auto-advance | `nextLectureId` set | `playLecture(next)` → LOADING (recreated player) |
| T14 | PLAYING | `status.isBuffering`, pos>0 | — | STALLED (UI hint only; native keeps trying) |
| T15 | STALLED | data flows | — | back to PLAYING |
| T16 | any | `status.error` | retries < 2 | silent rebuild from same position (1.5s delay) → LOADING |
| T17 | any | `status.error` | retries exhausted | `loadError` set → ERRORED |
| T18 | LOADING | internal reload rejects | still current | `loadError` set, spinner cleared (F-501) → ERRORED |
| T19 | ERRORED/STALLED/silently-stopped | offline→online edge | 4s cooldown | `forceFreshPlayer`; `reloadCurrent(startAt: here)` → LOADING |
| T20 | any | `seekTo(sec)` | not ended | clamp to [0, max−0.25], arm 1.2s seek-guard, native seek |
| T21 | ENDED | `seekTo(sec)` | `justFinished` | rebuild fresh from clamped target (restart if 0) |
| T22 | any | `setRate(r)` | — | store + native rate (0.8–2.0; persists across tracks, resets on stop — F-508) |
| T23 | any | `stop()` (MiniPlayer ×) | — | persist, release player + lock-screen session, reset ALL module state, `loadGen++` (kills in-flight loads) → CLOSED |
| T24 | any | `playNext()/playPrev()` | neighbour resolved | `playLecture(neighbour)`; offline neighbours come from the download manifest (F-502) |
| T25 | any | new track commits | — | `setTrack` resets neighbours/loadError/isStalled; `resetTrackProgress` re-arms per-track flags |

## 5. Progress persistence (§ persist)

- Cadence: every ≥5s while playing, plus pause / stop / track-switch / finish.
- Each save writes THREE places: server `save_activity` RPC (or the offline outbox,
  day-stamped device-local per F-043), the download sidecar (`updateDownloadPosition`,
  no-op if not downloaded), and the resumeCache sidecar (every lecture).
- `deltaSec` = forward movement since last save, capped at `MAX_LISTEN_TICK_SEC` (90)
  — a scrub-forward credits ≤90s per save event (documented inflation bound; server
  clamps 6h/day on replay only — noted for the Phase 2/13 hygiene list).
- Completion: `posInt/duration ≥ 0.95` (`COMPLETE_THRESHOLD`) or a natural finish;
  `justCompleted` fires once per track per session (badges/praise); resume position
  is NEVER pinned to the end (V17 Problem 1) and near-end resumes restart from 0.

## 6. Signed-URL lifecycle (proof sketch, task 2)

- `r2-read-url` mints URLs valid **3600s**. The controller reads the playback entry
  through `ensureQueryData` with `staleTime` **30min** — so audio never *starts* on a
  URL older than 30min (≥30min validity left). The screen's `useLecturePlayback`
  (45min staleTime) only feeds UI metadata, never the audio source.
- A lecture longer than the URL's remaining validity WILL see the stream's ranged
  requests start failing after expiry: native ERROR → T16 silent rebuild →
  `ensureQueryData` sees the entry ≥60min old (> 30min staleTime) → **fresh URL,
  resume from the same position**. Same recovery covers pause-overnight-resume.
- Every pause/stop/finish invalidates `queryKeys.lecture(id)` (so the *next* open
  re-reads the true server position), and a cold launch force-invalidates the most
  recently active lecture's entry (resumeCache `_lastActive` pointer).
- Warm-ahead (T11) re-mints the NEXT lecture's URL 120s before the handoff so a
  lock-screen auto-advance needs zero network at `didJustFinish` **[device]**.

## 7. Known-accepted quirks (logged, not fixed)

- Rate resets to 1.0 on `stop()` and app restart (F-508 — product decision).
- The 15s URL-fetch timeout lands in the offline-worded notice even when the cause
  is a slow server (F-509).
- `getNextLecture`/`getPreviousLecture` each fetch the whole section id/order list
  per track (F-510 — fine at real section sizes).
- Re-listening a completed lecture re-fires completion praise once per session
  (per-session `trackCompleted` — calm by design, F-514).
- `ensureAudioMode` marks itself done even if `setAudioModeAsync` failed; a genuinely
  failed audio-session setup is never retried in-session (F-515).
