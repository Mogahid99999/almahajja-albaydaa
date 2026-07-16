# expo-audio fork dossier (patch-package) — input to Phase 5

**Patch:** `patches/expo-audio+56.0.12.patch` (applied by `postinstall`; Android sources are
compiled from node_modules because `package.json → expo.autolinking.buildFromSource:
["expo-audio"]`). **Android-only** — iOS runs stock expo-audio, which is why the iOS lock
screen shows ±10s instead of prev/next (documented platform difference, IOS_SUBMISSION.md).

**Companion patch:** `patches/react-native-web+0.21.2.patch` — adds a no-op
`swapLeftAndRightInRTL()` to rn-web's `I18nManager` shim (all three dist flavors) so the
root layout's RTL bootstrap doesn't crash web (GLITCH_LOG #14). Trivial, low upgrade risk.

## What the expo-audio patch changes (7 Kotlin files)

| File | Change | Why |
|---|---|---|
| `AudioModule.kt` | After a denied/delayed `requestAudioFocus()`, marks the player `isPaused = true` before `play()` | Delayed focus grants (Bluetooth/car renegotiation, esp. right after auto-advance) otherwise leave the next lecture loaded but silently stuck — the `AUDIOFOCUS_GAIN` listener only resumes players flagged paused |
| `BaseAudioPlayer.kt` | `onIsPlayingChanged` no longer reports the transient `STATE_ENDED`/`BUFFERING` dip as a real stop (moves `onPlaybackStateChange` below the transient guard) | The old order released audio focus the instant a track ended, racing JS auto-advance's `play()` on the next lecture; if the release won, the re-request came back delayed/denied → silent stall |
| `AudioPlayer.kt` | Adds `emitControlAction(action)` → emits a `mediaControlAction` event to JS | Lock-screen/notification prev/next are forwarded to JS; `audioController` resolves the real section-aware neighbour |
| `AudioRecords.kt` | `Metadata` record gains `durationMs: Long?` and `deepLinkUri: String?` | JS supplies track length + a deep link with each metadata update |
| `MetadataInjectingPlayer.kt` | Publishes `durationMs` as `METADATA_KEY_DURATION` | Streaming sources otherwise report no duration → empty/broken lock-screen scrubber |
| `AudioControlsService.kt` | (a) New `ACTION_SKIP_NEXT`/`ACTION_SKIP_PREV` session commands + `dispatchSkip()` → JS; (b) replaces the seek-±10s buttons with **Previous/Play-Pause/Next** on both control surfaces (legacy ≤ Android 12L notification actions and media3 `CommandButton` layout); (c) notification tap opens `deepLinkUri` (`riwaqalilm:///player/<id>`) instead of the bare launcher intent | Lecture-based product wants prev/next lecture (seek stays available via the scrubber); tapping the notification should land on the full player |
| `AudioMediaSessionCallback.kt` | Takes the owning service, advertises + routes the two skip commands | Wires media-session custom commands to `dispatchSkip` |

## Contract with JS (what Phase 5 must verify)

- `audioController` listens for `mediaControlAction` events (`{action: 'next'|'prev'}`) and
  resolves neighbours itself — the native side never picks the track.
- JS passes `durationMs` + `deepLinkUri` in every lock-screen metadata update; a missing
  `durationMs` regresses the system scrubber, a missing `deepLinkUri` falls back to launcher.
- Focus handling assumes the app uses `setAcceptsDelayedFocusGain`.

### Phase 5 verification (2026-07-16, code-level — device matrix still pending)

- **Patch present and applied**: all 7 hunk files confirmed in the checked-out patch
  AND live in `node_modules` (riwaq markers in `AudioModule.kt:479`,
  `BaseAudioPlayer.kt:94`, `mediaControlAction` in `AudioPlayer.kt`;
  `setAcceptsDelayedFocusGain(true)` set at `AudioModule.kt:162` by the patch's
  assumption's own module — the contract holds).
- **JS listener**: `createPlayer()` (audioController) registers `mediaControlAction`
  on every player instance and routes `next|prev` through the same section-aware
  `playNext()/playPrev()` as the in-app buttons. Registered per-instance; instances
  are fully released via `player.remove()` on stop/teardown (no listener leak).
- **`durationMs`**: `syncLockScreen()` sends it only when `durationSec > 0` and is
  re-invoked the first time a REAL duration lands from a status tick (`wasSeed`
  check in `onStatus`) — so a streaming source with a 0/wrong DB seed still gets a
  correct system scrubber shortly after start. A lecture whose duration never
  reports keeps an empty scrubber (accepted).
- **`deepLinkUri`**: built with `Linking.createURL('/player/<id>')` per track and
  refreshed on every `syncLockScreen()` (track switch, duration landing) — the
  notification tap always targets the CURRENT lecture.
- **Auto-advance offline**: since Phase 5, neighbours also resolve from the download
  manifest when offline (F-502), so the patched prev/next controls keep working
  through a downloaded series with no connection **[device-verify]**.
- Still requiring physical devices (deferred by owner instruction this phase):
  lock-screen controls end-to-end, delayed-focus/Bluetooth renegotiation, the
  ENDED-state auto-advance under Doze, interruption matrix (calls, unplug), and
  the iOS stock-behavior delta (±10s instead of prev/next).

## Upgrade / fragility notes

- **Any expo-audio version bump invalidates the patch file name and likely the hunks** —
  rebase by hand against the new sources, then regenerate with `npx patch-package expo-audio`.
  The two focus fixes (AudioModule/BaseAudioPlayer) are behavioral and easy to lose in a
  rebase — re-run the Phase 5 background/interruption matrix after ANY expo-audio upgrade.
- Upstream status: not upstreamed (riwaq-specific UX choices baked in, e.g. replacing seek
  buttons). Candidate to upstream separately: the two focus-race fixes are arguably
  general-purpose bugs.
- **Line endings:** patches MUST stay LF byte-for-byte — enforced by `.gitattributes`
  (`*.patch -text`) after audit finding F-001 (CRLF checkout silently broke `postinstall`,
  leaving builds with unpatched expo-audio).
- Verified this session (2026-07-14): patch applies cleanly to pristine 56.0.12, apply is
  idempotent, and node_modules matches pristine+patch exactly; Android dev build compiled
  the patched Kotlin (`:app:compileDebugKotlin` executed) and booted.
