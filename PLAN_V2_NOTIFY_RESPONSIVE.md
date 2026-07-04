# PLAN V2 — Notifications (PRD §17/§20), App Rename, Admin Responsiveness

> منصة دروس العلم الشرعي / **المَحجّة البَيْضَاء**.
> Expo SDK 56 + Supabase (USE_MOCK=false). Admin = web dashboard. Student = Android.
> Supabase project ref: `prpyxnxgkpspjoxvcaro`. Android package: `com.riwaqalilm.app`.
> EAS projectId: `bd220e01-9d37-428a-9155-02c8b8e67e72`.

This plan is the source of truth for the next conversation. It is grounded in the
**actual current state** of the code (verified, not assumed). Items already done in
the previous session are marked ✅ so they are not redone.

---

## 0. Already DONE in the previous session (do NOT redo)

- ✅ **Web admin file-picker crash fixed** ("Failed to fetch" / `handlePickAudio`).
  Root cause: `await import('expo-document-picker')` made Metro split an on-demand
  async chunk that fails to fetch on the web dev server. Fixed with a
  platform-resolved module:
  - `src/lib/documentPicker.web.ts` — static import (no async chunk).
  - `src/lib/documentPicker.ts` — native lazy `require` (safe in Expo Go).
  - `app/admin/upload.tsx` + `src/components/admin/AttachmentManager.tsx` now import
    `getDocumentAsync` from `@/lib/documentPicker`.
- ✅ **Brand name** changed from `رِواق العِلم` → `المَحجّة البَيْضَاء` in the 3
  user-facing spots: `app/(auth)/sign-in.tsx`, `src/components/home/HomeHeader.tsx`,
  `src/components/admin/AdminShell.tsx`. (`app.json` `name` was already correct — the
  launcher icon already reads المَحجّة البَيْضَاء on the device.)
- ✅ **Release AAB + APK built** and the APK installed + verified running on the
  physical phone (sign-in renders, live Supabase reachable). Artifacts:
  `android/app/build/outputs/bundle/release/app-release.aab`,
  `android/app/build/outputs/apk/release/app-release.apk`.
- ✅ `npm run typecheck` is clean after the above.

> Note: the APK currently on devices was built BEFORE the rename edits, so it still
> shows `رِواق العِلم` on its sign-in screen. The next build picks up the new name.

---

## 1. App rename — finish + DECISION on technical identifiers

**User-facing rename is complete** (§0). What remains is a deliberate decision, NOT
blind find-replace:

- **KEEP these technical identifiers as-is** (do not rename): Android `package` /
  iOS `bundleIdentifier` = `com.riwaqalilm.app`, `scheme` = `riwaqalilm`, `slug` =
  `riwaq-al-ilm`, the EAS `projectId`, and `google-services.json`. Reason: changing
  the Android package creates a *different app* (existing installs can't update),
  breaks the FCM sender config (push), invalidates the EAS project and deep links.
  These strings are never shown to users.
- Optional cosmetic: the design-reference comment in `app/(student)/index.tsx:15`
  (`screens/رواق العلم.dc.html`) — harmless, leave or update.

**Action:** in the next build, confirm the 3 renamed strings render. No code change
needed beyond what's done.

---

## 2. Notifications — implement ALL of PRD §17, make them fire even when app is closed

### 2.1 Why "nothing works" today (root cause)

- Notifications were being tested in **Expo Go**, where `expo-notifications` is fully
  disabled (SDK 53+). `src/lib/notifications.ts` deliberately no-ops there. So **zero**
  notifications could ever fire in Expo Go — this is expected, not a bug.
- The fix is to test on the **standalone build** (the APK we now install). The local
  notification layer (`src/lib/notifications.ts`) is already written and works in a
  real build; it just was never exercised outside Expo Go.
- **Server push** (appear in the shade when the app is CLOSED, fanned out to all
  students) is wired in code but **not deployed**: the `notify-on-publish` Edge
  Function exists but isn't deployed, there's no Database Webhook calling it, and FCM
  credentials aren't uploaded to Expo. That's the missing infrastructure.

### 2.2 Current building blocks (already in the repo)

- `src/lib/notifications.ts` — local layer: `configureNotificationHandler`,
  `ensurePermission`, `getToken`, `scheduleResumeReminder`, `cancelResumeReminder`,
  `addResponseListener`. Real-build only (no-ops on web/Expo Go).
- `src/api/notifications.ts` — inbox + per-type prefs + `registerPushToken` +
  (unused) follows. Types: `new_lecture`, `new_attachment`, `new_quiz`,
  `resume_reminder`.
- `app/_layout.tsx` → `NotificationsBootstrap` — on sign-in: request permission,
  get Expo token, `registerPushToken`, and deep-link taps.
- DB: migration `0007_admin_and_notify_all.sql` (APPLIED) — `fanout_to_all` inserts
  one `notifications` row per student when a lecture is published / attachment added.
- `supabase/functions/notify-on-publish/index.ts` — Expo Push worker (reads
  `push_tokens` for the row's user, POSTs to Expo Push API). **Not deployed.**
- `src/api/progress.ts` — calls `scheduleResumeReminder` when an in-progress save
  happens; cancels on completion.

### 2.3 PRD §17 mapping (what to build, what's out of scope)

| PRD §17 item | Type | Status / action |
|---|---|---|
| تم إضافة محاضرة جديدة | `new_lecture` | In-app ✅ via trigger. **Add push delivery** (2.5). |
| تم إضافة مرفق جديد | `new_attachment` | In-app ✅ via trigger. **Add push delivery** (2.5). |
| تذكير بإكمال درس بدأه الطالب | `resume_reminder` | Local ✅. **Reword** copy (2.4). |
| تذكير بمواصلة سلسلة بدأها | `resume_series` (NEW) | **Build** local series reminder (2.4). |
| تم فتح اختبار جديد | `new_quiz` | Quizzes OUT OF SCOPE — defer (type kept, no UI). |
| إشعار بنتيجة اختبار | — | Quizzes OUT OF SCOPE — defer. |
| تذكير بالهدف الأسبوعي | — | Weekly goals OUT OF SCOPE (CLAUDE.md) — defer. |

PRD §20 encouraging messages (calm tone, no gamification):
- On completion (≥90%): **"أكملت الدرس، نفعك الله بما سمعت"** (user-requested wording).
- Reminder body example: **"لا تنسى درس اليوم، بارك الله فيك"** (user-requested).
- On progress save: "تم حفظ تقدمك، نفعك الله بما سمعت" (optional, in-app only).

### 2.4 Phase A — local notifications that fire even when the app is closed

Local scheduled notifications fire via the OS even when the app is killed — this
directly satisfies "pop-up notifications should appear even when the app is closed".

1. **Reword the resume reminder** in `src/lib/notifications.ts` →
   title `"لا تنسى درس اليوم، بارك الله فيك"`, body = lecture title. Keep the
   deterministic `resume-<id>` identifier + 24h `RESUME_REMINDER_HOURS`.
2. **Completion encouragement**: add `presentCompletionPraise(lectureTitle)` that fires
   an immediate local notification `"أكملت الدرس، نفعك الله بما سمعت"`. Call it from
   the completion seam (where progress crosses ≥90% in `src/api/progress.ts` /
   `src/lib/audioController.ts`), gated by a new pref `completion_praise`.
3. **Series reminder** (§17 item 5): add `scheduleSeriesReminder(sectionId, title)` —
   a local reminder to continue a started series; schedule when a student starts a
   lecture inside a section and hasn't finished the section. Gate on `resume_series`.
4. **Optional daily remembrance**: a single calm daily local notification (repeating
   trigger) "لا تنسى درس اليوم، بارك الله فيك" if the student has an in-progress
   lesson; gate on a `daily_reminder` pref (default OFF to stay calm).
5. **Prefs**: extend `NOTIFICATION_TYPES` + `NotificationType` + the prefs UI
   (`src/components/.../PrefsToggles`) with the new types. Missing row = ON default
   (existing convention), except `daily_reminder` default OFF.

### 2.5 Phase B — server push (shade delivery for new lecture / new attachment, app closed)

This is the infrastructure that's missing. Order:

1. **FCM credentials → Expo** (Android push needs this): create/Use the Firebase
   project behind `google-services.json`, generate a **service account key (FCM v1)**,
   and upload it via `eas credentials` (Android → Push notifications: FCM V1). Without
   this, Expo Push silently fails to deliver to Android.
2. **Deploy the Edge Function**:
   `supabase functions deploy notify-on-publish --project-ref prpyxnxgkpspjoxvcaro`
   (use the provided access token). It auto-receives `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY`.
3. **Database Webhook**: on `public.notifications` INSERT → POST the new row to the
   function URL. Configure via Supabase Dashboard (Database → Webhooks) or as a SQL
   trigger using `pg_net`/`supabase_functions.http_request`. Add a new migration
   `0008_notifications_webhook.sql` if doing it in SQL so it's reproducible.
4. **Verify token registration**: sign in as a student on the real APK → confirm a row
   in `push_tokens` (the bootstrap registers it once permission is granted).
5. **End-to-end test**: admin publishes a lecture → `fanout_to_all` inserts rows →
   webhook fires → function pushes via Expo → **notification appears in the phone's
   shade even with the app closed**. Repeat for "add attachment".

> If FCM setup is blocked (no Firebase access), Phase A still delivers real OS
> notifications for reminders/completion when the app is closed; only the
> server-fanned new-lecture/new-attachment pushes need Phase B.

### 2.6 Verification checklist (run on the real APK, not Expo Go)

- [ ] Fresh install → first launch as student → OS permission prompt appears, grant it.
- [ ] `push_tokens` has a row for the student.
- [ ] Start a lesson, leave it → resume reminder fires (temporarily shorten the
      interval to ~1 min for testing) with the new wording, **app closed**.
- [ ] Complete a lesson (≥90%) → "أكملت الدرس، نفعك الله بما سمعت" appears.
- [ ] Admin publishes a lecture → student device gets a shade notification, **app
      closed** (Phase B).
- [ ] Admin adds an attachment → shade notification (Phase B).
- [ ] Tapping a notification deep-links (lecture → player, section → section page).
- [ ] Tone stays calm: no sound, no badge counts (already configured).

---

## 3. Admin panel — make it responsive on all screen sizes

### 3.1 Root cause

`src/components/admin/AdminShell.tsx`:
- `styles.root` has **`minWidth: 700`** → forces horizontal overflow below 700px.
- Sidebar is a **fixed 252px** column, always visible (`flexDirection: 'row'`), never
  collapses → unusable on a phone-width browser.
- Several admin screens use fixed two-column layouts (upload already reads
  `useWindowDimensions`; dashboard/lectures/sections need the same treatment).

### 3.2 Tasks

1. **AdminShell responsive shell**:
   - Remove `minWidth: 700`.
   - Add a breakpoint via `useWindowDimensions` (e.g. `compact = width < 900`).
   - Compact: hide the fixed sidebar; show a top bar with a hamburger that opens the
     nav as an overlay/drawer (RN `Modal` or an absolute panel). Content goes full
     width, single column.
   - Wide: keep the current two-pane layout.
2. **Screen layouts** — make each admin screen stack to one column when compact:
   - `app/admin/index.tsx` (StatCard grid → wrap to 1–2 per row).
   - `app/admin/upload.tsx` (already conditional; verify the right rail stacks below).
   - `app/admin/lectures.tsx`, `app/admin/sections.tsx` (rows/editors fit narrow;
     icon button rows wrap; TreePicker usable at small width).
   - `app/admin/sheikhs.tsx`, `app/admin/unclassified.tsx`.
3. **Wide rows / tables**: either wrap into stacked cards on compact, or wrap them in a
   horizontal `ScrollView` so nothing is clipped.
4. **Touch targets**: ensure ≥44px tap targets for the compact (touch) layout.

### 3.3 Verification

- [ ] Web admin at ~390px (phone), ~768px (tablet), ~1280px (desktop): no horizontal
      overflow, nav reachable, forms usable, nothing clipped.
- [ ] Sign in as admin on the phone browser → can navigate + upload.

---

## 4. Build / run / verify workflow (Windows specifics that bite)

The machine's **Windows PATH is corrupted** and breaks `cmd.exe` subprocess command
resolution during Gradle. Always set a clean PATH for the shell session before
building, and use **absolute** paths to `gradlew.bat`:

```powershell
$root = "D:\Projects\Al-Mahajjah\App\almahajja-albaydaa\android"
$sdk  = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "C:\Program Files\nodejs;C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem;C:\Program Files\Git\cmd;$sdk\platform-tools"
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = $sdk
& "$root\gradlew.bat" -p "$root" assembleRelease bundleRelease --no-daemon --console=plain
```

Install + launch + screenshot on the connected phone (`R5CX10P3BPL`):

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb -s R5CX10P3BPL install -r "$root\app\build\outputs\apk\release\app-release.apk"
& $adb -s R5CX10P3BPL shell am start -n com.riwaqalilm.app/.MainActivity
# screenshot (binary-safe — never use PowerShell '>' redirect for PNG):
& $adb -s R5CX10P3BPL shell screencap -p /sdcard/s.png
& $adb -s R5CX10P3BPL pull /sdcard/s.png .\s.png
```

- The phone may drop off `adb devices` when the screen locks → unlock + re-accept the
  USB-debugging prompt, or `adb kill-server; adb start-server`.
- `android/local.properties` already has `sdk.dir=...` (required by Gradle).
- Release block is debug-signed (`signingConfig signingConfigs.debug`) → no secrets
  needed to build.

---

## 5. Suggested order for the next conversation

1. Notifications **Phase A** (local: reword + completion praise + series reminder +
   prefs) — fastest path to "notifications visibly work, even app closed".
2. Build APK → install on phone → run the §2.6 local-notification checks.
3. Notifications **Phase B** (FCM creds → deploy function → webhook → token check →
   end-to-end push). Requires Firebase/Expo credentials — gather first.
4. Admin **responsiveness** (§3) — verify on the web at 3 widths.
5. Final build + full device verification + commit.

Keep all data access in `src/api/*`, branch on `USE_MOCK`, mirror existing patterns,
`npm run typecheck` after each phase, calm non-gamified tone throughout.
