Project: المَحجّة البَيْضَاء — Expo SDK 56 (React Native + TypeScript), Supabase backend,
Zustand + TanStack Query, Expo Router file-based routing, RTL Arabic-first app.
Working directory: D:\Projects\Al-Mahajjah\App\almahajja-albaydaa
Build target: Android standalone RELEASE (test device R5CX10P3BPL). USE_MOCK=false.
Plan file: @PLAN_V4_FIXES.md   (read it fully — it is the complete spec for this session.)

TASK: Fix the eight field-reported issues in PLAN_V4_FIXES.md, following its "Build Order".
These are mostly-independent bug/polish items from real-device use. Keep the calm,
non-competitive Islamic tone; Arabic UI strings stay in Arabic exactly as written.

The eight issues (full detail + root causes already investigated in the plan):
  1. Push notification shows the Expo icon instead of the app/brand mark.
  2. Bottom controls (home MiniPlayer, player utility bar) sit under the system nav bar.
  3. "عرض الكل" next to "أُضيف حديثاً" is inert (no onAction wired).
  4. Sending a buddy invite never notifies the recipient (no notifications row → no push).
  5. No "update available" prompt when a new version ships (expo-updates not installed).
  6. Uploading a lecture from the phone never completes (native transcode throws + blocks submit).
  7. Audio seek is broken — mid-seek jumps to the end (streaming duration mismatch).
  8. Want a new-lessons count badge on the launcher icon that clears on open.

BEFORE CODING — re-read the current state of the files the plan calls out, and confirm your
understanding of each root cause against the live code (some may have shifted). Key files:
  - app.json                                          (notification plugin icon; Issue 1, 5)
  - src/lib/audioController.ts, src/components/player/Waveform.tsx   (seek; Issue 7)
  - app/admin/upload.tsx, src/api/admin.ts, src/lib/audioTranscode*.ts  (mobile upload; Issue 6)
  - supabase/migrations/0015_study_buddy.sql, 0016_buddy_notifications.sql  (invite push; Issue 4)
  - supabase/functions/notify-on-publish/index.ts     (Expo push worker; Issue 4, 8)
  - src/lib/notifications.ts, app/_layout.tsx         (badge + handler; Issue 8)
  - src/components/home/NewlyAddedRail.tsx, src/components/ui/SectionTitle.tsx  (عرض الكل; Issue 3)
  - app/(student)/_layout.tsx, src/components/MiniPlayer.tsx, src/components/player/PlayerUtilityBar.tsx  (safe-area; Issue 2)
  - src/api/types.ts, src/components/notifications/labels.ts  (new notification type; Issue 4)

Then CONFIRM the 5 open questions in the plan's "Open questions" section BEFORE Step 1,
using AskUserQuestion:
  1. عرض الكل destination — new "أحدث الدروس" screen (recommended) vs route to search?
  2. Update strategy — binary min-version gate + expo-updates (recommended) vs OTA only vs store link?
  3. Notification large icon — small white silhouette only (standard) vs also a colored large icon?
  4. Badge source — unread new_lecture only vs all unread inbox? Clear-on-open (recommended)?
  5. Buddy invite tap route — incoming-requests view vs buddy-search vs dedicated screen?

RULES:
- All data-access via src/api/*; components never call supabase directly.
- Rollups/counts/tree-walks are server-side SQL, never client tree-walking.
- RTL throughout; calm Islamic tone; no competitive framing.
- No code comments unless the WHY is non-obvious.
- Migrations are append-only; never edit 0001–0018. New migrations start at 0019.
  A new enum value needs its own migration/transaction step before it can be used
  (see the 0015 buddy_activity precedent) — so 'buddy_request' goes in 0019, the
  code that uses it in 0020.
- buildFromSource: ["expo-audio"] in package.json is intentional — do not remove it.
  expo-audio is patched (patches/) for media prev/next, deep-link, and duration —
  keep those patches intact when touching audio.
- To apply migrations live: Supabase project ref is prpyxnxgkpspjoxvcaro; POST the SQL to
  the Management API query endpoint (POST /v1/projects/{ref}/database/query) with the
  user's access token, and regen types via GET /v1/projects/{ref}/types/typescript into
  src/types/database.generated.ts. (Ask the user for the token if not provided.)
- To deploy the Edge Function change (Issue 8): supabase functions deploy notify-on-publish
  (or apply via the dashboard) — it is NOT part of the APK.
- To build+install: set $env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10",
  PREPEND node to PATH ($env:PATH = "C:\Program Files\nodejs;" + $env:PATH) — gradle's
  settings.gradle shells out to node and fails without it — then run
  android\gradlew.bat -p android :app:assembleRelease, then install with the full adb path:
  & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R5CX10P3BPL install -r
  android\app\build\outputs\apk\release\app-release.apk
- Batch every native-affecting change (Issues 1, 2, 5, 6, 7, 8) into ONE rebuild at the end.
- Package id: com.riwaqalilm.app · scheme: riwaqalilm (deep-link testing via
  adb shell am start -a android.intent.action.VIEW -d "riwaqalilm://...").
- Device screenshots: adb ... shell screencap -p /sdcard/x.png then adb ... pull (piping
  screencap through PowerShell corrupts the PNG).

Some fixes need a real second device / two accounts to fully verify (push icon in Issue 1,
buddy invite push in Issue 4, badge in Issue 8) — note what you verified vs what needs the
user's second device.

You may improve on the plan's approach where you find something cleaner, but keep the calm
non-competitive tone and the append-only migration rule non-negotiable.

Supabase access token (if needed): ask the user — do not assume the one from a prior session
is still valid.
