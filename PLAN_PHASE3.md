# خطة المرحلة الثالثة — Phase 3 (Offline download + About)

Status date: 2026-06-30 · Backend: live Supabase (`USE_MOCK=false`).

## TL;DR — most of Phase 3 is already in the tree

Before planning new work I audited what exists. Phase 3 turns out to be **~80% already
built and committed** (in the "finish Phase 2 live backend + audio upload" line of
work). The task brief assumed the download button still needed wiring onto rows and the
player — it's already there. So this plan is mostly about closing the **functional
gaps** that make offline download actually do something, not about building UI.

### ✅ Already done (verified, no work needed)

| Piece | Where |
|---|---|
| Zustand downloads store | [src/stores/downloadsStore.ts](src/stores/downloadsStore.ts) |
| File ops (download / delete / `localUriFor`) via expo-file-system new API | [src/lib/downloads.ts](src/lib/downloads.ts) |
| `useDownload` / `useDownloadedIds` hooks (+ per-lecture disk reconcile) | [src/hooks/useDownloads.ts](src/hooks/useDownloads.ts) |
| Reusable `DownloadButton` (idle/downloading/downloaded/error) | [src/components/DownloadButton.tsx](src/components/DownloadButton.tsx) |
| Download button **on lecture rows** | [src/components/section/LectureRowItem.tsx:155](src/components/section/LectureRowItem.tsx#L155) |
| Download chip **on the full player** | [src/components/player/PlayerUtilityBar.tsx:98](src/components/player/PlayerUtilityBar.tsx#L98) |
| "المحاضرات المحمّلة" downloads page + row | [app/(student)/downloads.tsx](app/(student)/downloads.tsx), [DownloadedLectureRow.tsx](src/components/downloads/DownloadedLectureRow.tsx) |
| "عن المنصة" About page (full, calm, du'a for scholars/contributors) | [app/(student)/about.tsx](app/(student)/about.tsx) |
| Profile links → Downloads + About | [app/(student)/profile.tsx:168-178](app/(student)/profile.tsx#L168-L178) |

So **the About page item (#9) is effectively complete** — I'll only verify it renders and
is linked (it is). No code planned there unless you want copy changes.

### ❌ The real gaps (this is the actual Phase 3 work)

The download button saves an `.mp3` to disk — **but nothing ever plays it.**
`playLecture` always streams from a freshly **signed Supabase URL** that expires in 1h
([lectures.ts:12-19](src/api/lectures.ts#L12-L19)). Consequences:

1. **Offline playback is a no-op.** Downloaded files are never used as a playback
   source. Tapping a downloaded lecture with no connection fails — even though the audio
   is sitting on disk.
2. **Metadata isn't cached.** `playLecture` and the downloads page both need a network
   round-trip (`getLecturePlayback` / `getLecturesByIds`) just to show a title. Offline,
   those throw → the screen can't even render the lecture.
3. **Downloads page is wrong on cold start.** The store is in-memory; it only learns a
   file exists when that lecture's `DownloadButton` mounts somewhere. After an app
   restart, before visiting any section, `useDownloadedIds()` returns `[]` → the
   downloads page shows "empty" despite files on disk.

---

## Proposed work

### Tier 1 — Offline-first playback *(core — without this, download does nothing)*

**`src/lib/audioController.ts` → `playLecture`:** prefer the local file.

- Resolve `localUriFor(lectureId)` and use it as the audio source when present:
  `const source = localUri ?? data.audioUrl;` → `createAudioPlayer({ uri: source })`.
- This alone makes a downloaded lecture play from disk while online (instant, no
  re-stream). Tier 2 makes it work with *no* connection.

### Tier 2 — Make "offline" genuinely work end-to-end

**a. Metadata sidecar on download** — `src/lib/downloads.ts`
- When `downloadLecture` runs, also persist `<documents>/lectures/<id>.json` with the
  few fields the UI needs offline: `{ id, title, sheikhName, durationSec, sectionTitle,
  coverLetter }`. The download hook already fetches the full `LecturePlayback`, so the
  data is in hand — just thread it through.
- `deleteLecture` removes both the `.mp3` and the `.json`.
- Add `readDownloadMeta(id)` and `listDownloadedIds()` (via `Directory.list()`).

**b. Offline fallback in `playLecture`** — `src/lib/audioController.ts`
- Wrap `getLecturePlayback` in try/catch. If it throws **and** a local file + sidecar
  exist, build the player track from the cached sidecar metadata and play from disk.
  (Resume position offline defaults to 0 — acceptable for MVP; noted as a known limit.)

**c. Hydrate the store from disk on startup** — `src/lib/downloads.ts` + `app/(student)/_layout.tsx`
- A small effect on app entry calls `listDownloadedIds()` and seeds the store
  (`status:'downloaded', localUri, progress:1`) so `useDownloadedIds()` is correct
  immediately, even before any row mounts and even offline.

**d. Downloads page reads cached metadata** — `app/(student)/downloads.tsx`
- Swap the network `useLecturesByIds(ids)` for sidecar-backed cards
  (`getDownloadedCards()`), so the downloads page is fully functional offline. (Falls
  back gracefully if a sidecar is missing.)

### Tier 3 — Polish

- **Web guard on `DownloadButton`:** on web, `downloadLecture` throws
  ("التحميل غير مدعوم على الويب"), so the button currently lands in the red error state.
  Render nothing (or a disabled state) on `Platform.OS === 'web'` — downloads are a
  mobile feature; web is the admin surface. (One-line guard.)
- **About page:** verify-only. Already complete and linked.

---

## Out of scope (explicitly, to avoid creep)

- Granular download progress %. The new expo-file-system `File.downloadFileAsync` has no
  progress callback; the existing spinner + binary 0→1 is the pragmatic choice. Keep it.
- Background / resumable downloads, queueing, "download whole section."
- Storage-usage display / "clear all downloads."
- Any change to the About copy unless you ask.

## Files touched

- `src/lib/audioController.ts` — offline-first source + offline metadata fallback (Tier 1, 2b)
- `src/lib/downloads.ts` — sidecars, `readDownloadMeta`, `listDownloadedIds`, `getDownloadedCards`, delete-both (Tier 2a, d)
- `src/hooks/useDownloads.ts` — thread metadata into `download()`; add hydrate + cards selectors (Tier 2a, c, d)
- `app/(student)/_layout.tsx` — startup hydrate effect (Tier 2c)
- `app/(student)/downloads.tsx` — sidecar-backed cards (Tier 2d)
- `src/components/DownloadButton.tsx` — web guard (Tier 3)

## Verification

- `npm run typecheck` clean.
- Manual (Android emulator, live backend): download a lecture → kill app → reopen →
  downloads page lists it → enable airplane mode → tap → plays from disk; delete →
  file + sidecar gone, row disappears. Confirm About renders and is reachable from
  Profile. Web: download control hidden, no error chip.

## Open decision for you

How far do you want to take "offline" in this pass?

- **A — Full offline (Tier 1 + 2 + 3):** downloads truly work with no connection
  (recommended; it's what PRD §10 promises).
- **B — Minimal (Tier 1 + web guard only):** downloaded files play from disk *while
  online* (faster, no re-stream), but a fully offline session still can't load lecture
  metadata. Smaller change; defers the sidecar/hydration work.
