Project: المَحجّة البَيْضَاء — Expo SDK 56 (React Native + TypeScript), Supabase backend,
Zustand + TanStack Query, Expo Router file-based routing, RTL Arabic-first app.
Working directory: D:\Projects\Al-Mahajjah\App\almahajja-albaydaa
Build target: Android standalone RELEASE (test device R5CX10P3BPL — a Samsung/One UI phone). USE_MOCK=false.
Plan file: @PLAN_REMINDERS_V7.md   (read it fully — it is the complete, DECIDED spec.)

TASK: Per PLAN_REMINDERS_V7.md, following its "Build Order":
  FEATURE) التذكيرات النافعة — admin/publisher broadcast reminders (virtuous seasons/sunan) to
     ALL users: created from the panel with title, body, and "show as a home card?"; delivered
     as a phone push + an inbox row distinguished as a special type; tapping (shade or in-app)
     opens a dedicated detail page; a home card shows for 1 day then auto-hides; editable/deletable.
  FIX 1) "All notification types except new-lecture pushes never reach users." Diagnose and fix
     so EVERY type works reliably.
  FIX 2) Add daily streak (المداومة) keep-alive reminders so users don't lose their streak
     (calm phrases suggested in the plan).
  FIX 3) The bottom mini-player can't be closed — add a close (×) control.

WORK AUTONOMOUSLY — DO NOT ask the user questions mid-work. Every design choice is LOCKED in
the plan; pick the best-recommended option everywhere and proceed. (Only request the Supabase
access token if it's missing.) Good, calm, on-brand UI/UX is a first-class requirement.

KEY DIAGNOSIS (already investigated — confirm live, then fix):
- The 0009 webhook pushes on EVERY notifications INSERT with NO type filter, so server pushes
  work for all types IF their rows get inserted. new_lecture working proves the path works.
- The reminders that "never arrive" are DEVICE-scheduled (expo-notifications TIME_INTERVAL at
  6h–24h) and Samsung/One UI battery optimization (Doze / "sleeping apps") drops them. FIX =
  move time-based reminders to SERVER pg_cron → notifications INSERT → push (the reliable path,
  as weekly-goal already does in 0013). Keep only in-session presentations local (completion
  praise, goal congrats).
- The floating bubble genuinely no-ops (native overlay module not linked). Leave it OFF; do NOT
  spend this batch on it — deliver value via reliable push.
- FIRST diagnostic step: check `select * from cron.job;` + `cron.job_run_details` (is pg_cron
  firing at all?), confirm push_tokens rows exist for the test user, and trigger one of each
  server type end-to-end.

BEFORE CODING — re-read the files the plan calls out and confirm each fact:
  - supabase/migrations/0009_notifications_webhook.sql, 0013_weekly_goal_reminders.sql  (push pipeline + cron pattern)
  - src/lib/notifications.ts, src/api/progress.ts, app/_layout.tsx  (where reminders are scheduled today)
  - supabase/functions/notify-on-publish/index.ts  (push worker; no type filter)
  - src/stores/playerStore.ts (reset), src/lib/audioController.ts, src/components/MiniPlayer.tsx  (Fix 3)
  - src/api/types.ts, src/components/notifications/labels.ts  (NotificationType + labels)
  - app/(student)/index.tsx  (Home — add BroadcastCard), src/components/admin/AdminShell.tsx  (nav; publisher-visible)
  - supabase/migrations (latest is 0031 — new migrations start at 0032; confirm)

RULES:
- All data-access via src/api/*; components never call supabase directly.
- Fan-outs / cross-user reads are server-side SECURITY DEFINER RPCs. Broadcast create/edit/delete
  is is_content_manager() (admin OR publisher). Reminder crons are DEFINER, revoked from clients,
  invoked by pg_cron.
- Notifications ride the EXISTING pipeline (INSERT public.notifications → 0009 webhook →
  notify-on-publish → Expo Push). Do NOT rewrite notify-on-publish; just insert rows of the new
  types (best-effort, swallow errors). New reminders must be reliable (server cron), not device alarms.
- RTL throughout; calm Islamic tone; do NOT over-notify (dedup reminders once per user per day;
  quiet-hours safe). Arabic UI strings stay Arabic.
- No code comments unless the WHY is non-obvious.
- Migrations are APPEND-ONLY; never edit 0001–0031. New migrations start at 0032. New enum values
  ('streak_reminder', 'beneficial_reminder') need their OWN migration/transaction step before use.
  Re-create policies with drop-if-exists/create in NEW migrations.
- To apply migrations live: project ref prpyxnxgkpspjoxvcaro; POST SQL to
  POST /v1/projects/{ref}/database/query with the user's access token; regen types via
  GET /v1/projects/{ref}/types/typescript into src/types/database.generated.ts. Ask for the token.
- pg_cron: schedule with cron.schedule / unschedule the old job name first (see 0013). Verify the
  job appears in cron.job and later in cron.job_run_details.
- To build+install: set $env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10", PREPEND node
  to PATH ($env:PATH = "C:\Program Files\nodejs;" + $env:PATH), then run
  android\gradlew.bat -p android :app:assembleRelease, then install with the full adb path:
  & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R5CX10P3BPL install -r
  android\app\build\outputs\apk\release\app-release.apk
  (If a Metro "ENOTEMPTY … metro-cache" error appears, delete %TEMP%\metro-cache and rebuild.)
- Package id: com.riwaqalilm.app · scheme: riwaqalilm. Demo admin: admin@gmail.com / test55%%.
  Device screenshots: adb ... shell screencap -p /sdcard/x.png then adb ... pull (piping
  screencap through PowerShell corrupts the PNG).

Do NOT touch the V4 app_config min_app_version (leave it 1.0.0 — a global gate that would lock
out real users). Do NOT weaken existing RLS.

Verify on device: to test crons without waiting, invoke the dispatcher functions directly via
the Management API and confirm push + inbox row. Beneficial reminder: create → push to the device
→ shade tap opens the detail → home card present (gone after 24h / on dismiss). Mini-player × stops
audio, hides the bar, clears lock-screen controls. Confirm each server notification type pushes.
Note what you verified vs what needs a 2nd account or a waiting period.

Supabase access token: ask the user — do not assume the one from a prior session is still valid.