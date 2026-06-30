# خطة إصلاح لوحة الإدارة + تحديثات التطبيق — Admin panel fixes & app updates

Status date: 2026-06-30 · Live Supabase (`USE_MOCK=false`) · Admin = web, Student = Android.
Derived from `sharia_app_prd_mvp_aligned.pdf` §13 (attachments), §14 (direct upload),
§15 (web admin panel), §7 (sheikh chips) + `PLAN.md`.

## How the admin panel is wired today (so we don't rebuild what exists)
- Screens: `app/admin/{index,upload,sections,unclassified}.tsx` + `AdminShell` nav.
- API: `src/api/{admin,sheikhs,sections,attachments,lectures,notifications}.ts`.
- DB: `supabase/migrations/0001..0006`. **RLS already lets admins INSERT/UPDATE/DELETE**
  `sections`, `sheikhs`, `lectures`, `attachments` (see `*_admin_write` policies) — so most
  CRUD here is **client code only, no new RLS needed.**
- Student reads require `status='published'` **and** a non-null `section_id`
  ([sections.ts:56-62](src/api/sections.ts#L56-L62), [sections.ts:162-167](src/api/sections.ts#L162-L167)).

---

## Diagnosis — each reported issue → root cause

| # | Reported issue | Root cause (verified in code) | Fix area |
|---|---|---|---|
| 1 | Add/edit/delete a **Sheikh** | `sheikhs.ts` has only `getSheikhs`. No create/update/delete; no screen. | API + new screen |
| 2 | Edit/delete **categories & tree** | `admin.ts` has only `createSection`. No update/delete/reparent. `sections.tsx` only renders the tree read-only. | API + sections screen |
| 3·8 | **Attachment upload** interface | `AttachmentManager` only takes a **URL/text**; `createAttachment` always sets `storage_path: null` ([attachments.ts:126](src/api/attachments.ts#L126)). The `attachments` bucket exists (0002) but is never written. No file picker. | API + AttachmentManager |
| 4 | Show **draft** lectures | No admin screen lists drafts. Dashboard shows **published-only** ([index.tsx:98-100](app/admin/index.tsx#L98-L100)); unclassified shows **section-less only**. `getAdminLectures` already returns all statuses but nothing renders them. | New Lectures screen |
| 5 | Show **published** lectures **with playback** | No lectures list with a player in admin. | New Lectures screen |
| 6 | **Delete** lectures | No `deleteLecture` API or UI. | API + Lectures screen |
| 7 | Improve uploads + accept **.ogg** | Picker is `type:'audio/*'` (already accepts ogg). But: no duration extraction (`duration_sec` stays null), `contentType` falls back to `audio/mpeg`, no upload feedback. `lectures` bucket has **no MIME restriction**, so ogg uploads fine. ⚠️ **expo-audio can't play Ogg on iOS** (Android OK). | Upload form |
| 9 | **Uploaded lectures don't appear** | Upload **defaults to `draft`** ([upload.tsx:85](app/admin/upload.tsx#L85)). A draft-with-section is invisible in **every** admin view *and* the student app → looks "lost." Fixed by the Lectures screen (see/publish drafts) + verifying the publish→section flow. | Lectures screen + verify |

### App updates
| Item | Current | Change |
|---|---|---|
| A · **Next lecture** (manual + auto on completion) | `audioController` plays one lecture; `didJustFinish` only marks complete ([audioController.ts:55-59](src/lib/audioController.ts#L55-L59)). No notion of "next". | Add `getNextLecture(sectionId, order)`; on finish auto-advance (respect a setting); add a "next" control in the full player + mini player. |
| B · **Remove follow-section**, notify everyone | Notifications **fan out to followers only** (`fanout_to_followers` / `followers_of_section`, migration 0006). `FollowButton` on the section page drives `section_follows`. | New migration: fan out to **all students** gated by per-type prefs. Remove `FollowButton` + follow API usage. (Leave `section_follows` table in place, unused.) |

---

## Plan (phased; each phase compiles & is verifiable)

### Phase 0 — Verify the live data first (10 min, no code)
Before building, confirm issue #9's mechanism on the real project: query `lectures`
(status, section_id) for the "missing" ones. Expect: `status='draft'` or `section_id IS NULL`.
This proves the fix and rules out a deeper bug.

### Phase 1 — DB migration `0007_admin_and_notify_all.sql` (needs approval before running)
- **Notify all students** instead of followers: add `fanout_to_all(type,title,body,data)`
  that inserts one inbox row per **profile with role='student'** whose pref is ON, and point
  `notify_lecture_published` / `notify_attachment_added` at it. (Keep `section_id` in the
  payload for deep-linking.) Follower functions stay but go unused.
- No other schema changes required (CRUD uses existing admin RLS; ogg needs no bucket change).
- Idempotent, append-only — never edit 0001–0006.

### Phase 2 — API layer (`src/api/*`, mirror existing patterns; branch on `USE_MOCK`)
- `sheikhs.ts`: `createSheikh(name)`, `updateSheikh(id,name)`, `deleteSheikh(id)`.
- `admin.ts`: `updateSection(id,{title,description,parentId,order,showHeader})`,
  `deleteSection(id)` (⚠️ cascades to child sections + their lectures — surface this in UI),
  `updateLecture(id,{title,sectionId,sheikhId,order,status})`, `deleteLecture(id)`
  (DB delete + `storage.remove([audio_path])`).
- `attachments.ts`: real file upload — `uploadAttachmentFile(file,type)` → `attachments`
  bucket → set `storage_path` (lazy-import `expo-document-picker`, same guard as the audio
  picker in `upload.tsx`).
- `lectures.ts`: `getNextLecture(sectionId, currentOrder)` (published, same section, next `order`).

### Phase 3 — Admin screens
- **New `/admin/lectures`** (fixes #4, #5, #6, #9): list ALL lectures with a status filter
  (draft/published/unclassified), inline **play** (expo-audio works on web), **publish/unpublish**,
  **edit** (title/section/sheikh/order), **delete** (confirm). Add to `AdminShell` nav + a
  dashboard quick-link + make the "مسودة" stat tappable.
- **New `/admin/sheikhs`** (fixes #1): list + add + rename + delete (warn: lectures keep
  playing; `sheikh_id` is `ON DELETE SET NULL`).
- **`/admin/sections`** (fixes #2): per-node edit (title/description/parent/showHeader/order)
  + delete (confirm cascade) + reorder. Reuse `TreePicker` for reparenting.
- **`AttachmentManager`** (fixes #3/#8): add a file-upload control for pdf/image (and optional
  file for transcript) alongside the URL field; wire to `uploadAttachmentFile`.
- **`/admin/upload`** (fixes #7): keep `audio/*` (accepts ogg) + add explicit `.ogg` note,
  extract duration before insert (so `duration_sec` is set), set correct `contentType`, show
  upload state; consider defaulting the toggle to **published** or making the draft warning louder.

### Phase 4 — Student app updates
- **Next lecture** (A): in `audioController`, on `didJustFinish` optionally call
  `getNextLecture` → `playLecture(next)`; add a "next" button to `TransportControls` /
  `PlayerUtilityBar` and the mini player. Add a small setting (auto-advance on/off).
- **Remove follow** (B): delete `FollowButton` from `section/[id].tsx`; drop follow hooks/usage;
  rely on the Phase-1 notify-all fan-out so students get "درس جديد" without following.

### Phase 5 — Verify (web admin + the Android phone/APK)
Upload (ogg) → publish → appears on Home "newly added" + section page + plays; edit/reorder;
delete removes it from app + storage; add a section attachment (file) → downloads in app;
publish a new lecture → every student gets a notification (no follow); player auto-advances and
the next button works; sheikh add/rename/delete; section edit/delete (cascade confirmed).

---

## Risks & decisions to surface
- **`deleteSection` cascades** to all descendant sections **and their lectures** (FK
  `ON DELETE CASCADE`). UI must require explicit confirmation showing what will be deleted.
- **.ogg on iOS**: expo-audio can't decode Ogg Vorbis on iOS; fine on Android/web. MVP is
  Android-first, so accept ogg now and note a future server-side transcode for iOS.
- **Notify-all volume**: with following removed, every publish notifies every student. That's
  the requested behavior; per-type prefs (and the existing quiet-inbox design) keep it calm.
- Admin runs on **web** — use expo-audio (web-capable) or a native `<audio>` for admin playback.
