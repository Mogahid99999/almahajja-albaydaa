# Plan: V4 — Field Fixes & Polish

**Date:** 2026-07-02
**Target:** Android standalone RELEASE build, device R5CX10P3BPL, USE_MOCK=false
**Nature:** Eight mostly-independent bug/polish items reported from real-device use.
Several require a **new native build** (notification icon, badge, expo-updates,
seek). Batch them so there's one rebuild, not eight.

Calm/non-competitive tone stays non-negotiable throughout; Arabic UI strings stay
Arabic. All data-access via `src/api/*`; append-only migrations start at **0019**
(0001–0018 are never edited). Migrations apply live via the Management API
(project ref `prpyxnxgkpspjoxvcaro`); regen `src/types/database.generated.ts`
after. `buildFromSource: ["expo-audio"]` stays in package.json.

---

## Issue 1 — Push/notification icon shows the Expo mark, not the app icon

**Symptom:** On other phones, the notification in the tray shows the generic
Expo icon instead of the brand mark.

**Root cause:** `app.json` → `expo-notifications` plugin points `icon` at
`./assets/android-icon-monochrome.png`. That asset is the adaptive-icon
*themed/monochrome* layer (padded, not a clean notification silhouette). Android
notification **small icons must be a flat white shape on full transparency** —
anything else renders as a white blob or falls back to the launcher default.
The distributed APK may also predate the config, so a rebuild is required
regardless.

**Fix:**
- Add a dedicated `assets/notification-icon.png` — pure white, transparent
  background, ~96×96 (the المَحجّة rhombus/mark silhouette). Generate from
  `assets/logo.pdf` (see [[app-icon-source]] memory).
- Point the plugin `icon` at it; keep `color: "#C9A463"` (brass tint).
- Optional large icon: Android shows the app icon as the large icon only if the
  push provides one. Decide whether to add a `largeIcon` (bundled drawable) or
  leave small-icon-only (acceptable and standard).
- **Rebuild** (native change) and verify with a real Expo push to a *second*
  device (the reporter's complaint is cross-device).

**Files:** `app.json`, `assets/notification-icon.png` (new). Verify: send a test
push (e.g. flip a followed lecture to published) and inspect the tray icon.

---

## Issue 2 — Bottom buttons partially hidden behind the system nav bar

**Symptom:** On the launcher/home and elsewhere, the lowest controls sit under
the phone's gesture/nav bar.

**Root cause:** `Screen` adds `insets.bottom` to *scroll* content, but the
**fixed/absolute** bottom surfaces don't: the globally-mounted `MiniPlayer`
(`app/(student)/_layout.tsx`), the player utility bar
(`src/components/player/PlayerUtilityBar.tsx`), and the primary CTA buttons on
the new quiz intro/solver/result screens. On a device with an on-screen nav bar
these render flush to the physical bottom.

**Fix:**
- `MiniPlayer` — add `paddingBottom: insets.bottom` (or lift its offset) via
  `useSafeAreaInsets`.
- `PlayerUtilityBar` and any absolutely-pinned bars — add the bottom inset.
- Audit the quiz screens' bottom CTAs (they use `Screen bottomPad`, which is
  fine, but confirm on-device).

**Files:** `app/(student)/_layout.tsx` or `src/components/MiniPlayer.tsx`,
`src/components/player/PlayerUtilityBar.tsx`. Verify: home + player on the device
with the 3-button nav bar visible.

---

## Issue 3 — "عرض الكل" next to "أُضيف حديثاً" does nothing

**Root cause:** `NewlyAddedRail` renders `<SectionTitle actionLabel="عرض الكل" />`
with **no `onAction`** — `SectionTitle` only shows the pressable when a handler
is passed, and here it isn't wired.

**Fix (decision needed — see Open Questions):** either
- (a) Build a simple "أحدث الدروس" list screen (`app/(student)/recent.tsx`) that
  lists newly-added published lectures (reuse `LectureRowItem`), or
- (b) Point it at the existing search/browse entry.

Recommended: (a) a small dedicated recent-lectures screen — matches the label.

**Files:** `src/components/home/NewlyAddedRail.tsx` (+ new screen + an
`api/lectures` list fn if (a)). Verify: tap navigates and lists.

---

## Issue 4 — Buddy invitation never notifies the recipient (even push)

**Symptom:** Sending a buddy invite produces no notification for the invitee,
even with the app closed.

**Root cause:** `send_buddy_request` (migration 0015) inserts only into
`buddy_requests`. The push pipeline is driven by INSERTs on `public.notifications`
(0009 webhook → `notify-on-publish` → Expo Push). No `notifications` row is ever
written for an invite, so nothing is delivered.

**Fix (migration 0019 + 0020 — enum value needs its own transaction step, per
the 0015 precedent):**
- `0019`: `alter type public.notification_type add value if not exists
  'buddy_request';`
- `0020`: update `send_buddy_request` (and `respond_buddy_request` on *accept*)
  to `insert into public.notifications (...)` for the recipient / original
  sender, type `buddy_request`, honoring the recipient's pref (missing row = ON),
  with `data → { route: '/(student)/buddy-search' }` (or the incoming-requests
  surface). Keep it inside the DEFINER function; swallow errors so an invite
  never fails on a notification hiccup.
- Client: add `buddy_request` to `NotificationType` + `NOTIFICATION_TYPES` +
  `defaultNotificationEnabled` (`src/api/types.ts`) and to `labels.ts`
  (label/description/icon/order). Confirm the tap route resolves.

**Files:** `supabase/migrations/0019_*.sql`, `0020_*.sql`, `src/api/types.ts`,
`src/components/notifications/labels.ts`. Verify: two accounts, send invite →
recipient gets a tray push with app closed + an inbox row.

Note: this reuses the existing webhook/Edge Function unchanged — only new
`notifications` rows are needed.

---

## Issue 5 — Prompt the user to update when a new version ships

**Root cause:** `expo-updates` is not installed; there's no update channel and no
version gate.

**Fix (decision needed — see Open Questions):**
- **OTA path (recommended for JS-only fixes):** add `expo-updates` + configure
  EAS Update, check for an update on launch/foreground, and show a calm
  "تحديث متوفر" prompt that downloads + reloads. Note: OTA can't ship the *native*
  changes in this very batch (icon/badge/seek) — those need a new APK.
- **Binary-update gate (recommended alongside):** a lightweight remote
  "minimum supported version" value (a tiny Supabase table/RPC or a JSON asset)
  checked on launch; if the installed `expo-application` nativeVersion is below
  it, show a blocking/gentle "حدّث التطبيق" screen linking to the download.

Recommended: ship the binary-version gate now (works for direct-APK
distribution) and add expo-updates for future JS pushes.

**Files:** `package.json`, `app.json` (updates config), a boot check in
`app/_layout.tsx`, small `src/api/appVersion.ts` + optional migration for the
min-version value. Verify: set min-version above installed → prompt appears.

---

## Issue 6 — Uploading a lecture from the phone never completes

**Symptom:** Admin on mobile picks audio; the row shows
"ضغط الصوت متاح في لوحة الإدارة على الويب فقط" and the save button stays disabled.

**Root cause:** `app/admin/upload.tsx` unconditionally kicks off
`transcodeToMp3` (ffmpeg.wasm, web-only) and **blocks submit** until it reports
`done` (`audioBlocksSubmit = audioFile != null && convert.state !== 'done'`). The
native `audioTranscode.ts` stub rejects, so submit is permanently blocked on
mobile.

**Fix:**
- On native (`Platform.OS !== 'web'`): **skip client-side compression** — keep
  the picked file and upload the original directly (no ffmpeg). Gate submit on
  the *upload* finishing, not on transcode.
- Make `uploadLectureAudio` robust for large native files: prefer
  `expo-file-system`'s `uploadAsync` (streamed multipart to the Supabase Storage
  REST endpoint with the session access token) over `fetch(uri).arrayBuffer()`
  (which buffers the whole file in memory and can OOM on long lectures).
- Duration on native: `document.createElement('audio')` is web-only; derive
  duration another way on native (e.g. a brief `expo-audio` load) or allow null
  (the player recovers duration from playback).
- Ensure the admin panel is reachable/usable on a phone when signed in as admin
  (responsive form already degrades to single-column; verify the flow).

**Files:** `app/admin/upload.tsx`, `src/api/admin.ts` (upload helper),
possibly a native duration helper. Verify: on the device, admin login → upload a
real audio file → row appears + plays.

---

## Issue 7 — Audio seek is broken (mid-seek jumps to the end; "jumbled")

**Symptom:** Trying to scrub from ~10:00 to ~23:00 misbehaves; seeking to the
middle jumps to the end of the clip.

**Root cause (primary hypothesis):** duration mismatch. For a **streaming**
source, `status.duration` is frequently `0`/absent, so `onStatus` never overrides
the store duration and the UI keeps the **DB `duration_sec`** (metadata, often
inaccurate). The `Waveform` maps a tap to `fraction * durationSec` using that DB
value, but `player.seekTo(seconds)` runs against the player's **real** timeline.
When DB duration > real duration, a "middle" tap yields a second past the real
end → the player clamps to the end / fires `didJustFinish`. RTL tap-mirroring in
`Waveform.handlePress` is a secondary suspect.

**Fix:**
- Establish a single source of truth for duration: prefer the **player-reported**
  duration once known; clamp every `seekTo` to `[0, currentDuration]`.
- Ensure a seek can't trip `didJustFinish` → auto-advance (guard the finish
  handler so a programmatic seek to ≈end doesn't advance).
- Re-verify the RTL `locationX → fraction` mapping on-device (bars use `flex:1`
  + gaps; confirm the mapping matches the visual).
- Consider replacing the tap-only waveform with a proper **draggable** scrubber
  for reliable fine seeking.

**Files:** `src/lib/audioController.ts` (`seekTo`, `onStatus`, duration
handling), `src/components/player/Waveform.tsx`. Verify: on a real streaming
lecture, seek to several absolute positions (¼, ½, ¾) and confirm the audio lands
there; confirm the lock-screen scrubber still works ([[background-audio-lockscreen]]).

---

## Issue 8 — Show a new-lessons count badge on the app icon (WhatsApp-style)

**Symptom / ask:** Want the number of new lessons as a launcher-icon badge that
clears when the app is opened.

**Root cause:** No badge logic. `configureNotificationHandler` sets
`shouldSetBadge: false`; nothing calls `setBadgeCountAsync`.

**Fix:**
- Server: have `notify-on-publish` set `badge: <unread count>` on the Expo push
  message — compute the recipient's unread `notifications` count (or unread
  `new_lecture` count) at send time.
- Local handler: flip `shouldSetBadge: true` in `configureNotificationHandler`.
- On app foreground/open: `Notifications.setBadgeCountAsync(0)` (and mark the
  relevant inbox state) so the badge clears — wire into the existing app-open
  effect in `app/_layout.tsx`.
- Note: Android launcher numeric badges are launcher-dependent (One UI/Samsung —
  the test device — supports them; some launchers show only a dot). Document
  this; iOS is exact.

**Files:** `supabase/functions/notify-on-publish/index.ts`, `src/lib/notifications.ts`,
`app/_layout.tsx`. Verify: receive a new-lesson push → badge shows the count →
open app → badge clears.

---

## Open questions to confirm BEFORE starting

1. **عرض الكل destination** — new "أحدث الدروس" list screen (recommended), or
   route to search/browse?
2. **Update strategy** — binary min-version gate now + expo-updates for later
   (recommended), OTA only, or a simple "new version" store/download link?
3. **Notification large icon** — small white silhouette only (standard), or also
   add a colored large icon (app logo) on the right of the push?
4. **Badge source** — count of unread `new_lecture` only, or all unread inbox
   notifications? Clear-on-open (recommended) vs clear-as-read.
5. **Buddy invite route** — where should the invite push/inbox tap land: the
   incoming-requests view, buddy-search, or a dedicated requests screen?

---

## Build order

```
Step 0   Confirm the 5 open questions (AskUserQuestion).
Step 1   DB: migration 0019 (add 'buddy_request' enum) → apply live.
Step 2   DB: migration 0020 (invite/accept notification inserts) → apply live;
             regen database.generated.ts.
Step 3   Buddy client wiring: NotificationType + labels.ts (Issue 4).
Step 4   Seek fix: audioController duration/seek clamp + Waveform (Issue 7).
Step 5   Mobile upload: native no-transcode path + robust upload (Issue 6).
Step 6   عرض الكل: recent screen + wire onAction (Issue 3).
Step 7   Safe-area bottoms: MiniPlayer + utility bar + CTAs (Issue 2).
Step 8   Badge: handler + server badge + clear-on-open (Issue 8).
Step 9   Update prompt: min-version gate (+ expo-updates) (Issue 5).
Step 10  Native assets: notification-icon.png + plugin (Issue 1).
Step 11  typecheck → release build → install on R5CX10P3BPL.
Step 12  Device verify each item; deploy the Edge Function change (Issue 8).
```

Batch all native-affecting changes (1, 2, 5, 6, 7, 8) into the **single** rebuild
at Step 11. DB + Edge Function changes deploy independently of the APK.
