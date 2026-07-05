Project: المَحجّة البَيْضَاء — Expo SDK 56 (React Native + TypeScript), Supabase backend,
Zustand + TanStack Query, Expo Router file-based routing, RTL Arabic-first app.
Working directory: D:\Projects\Al-Mahajjah\App\almahajja-albaydaa
Build target: Android standalone RELEASE (test device R5CX10P3BPL — Samsung/One UI). USE_MOCK=false.
Plan file: @PLAN_V10_OFFLINE_PERF.md   (read it fully — it is the complete, DECIDED spec.)

TASK: Per PLAN_V10_OFFLINE_PERF.md, in its build order E → B → A → C → D:
  FIX E) /downloads screen crash (infinite render loop from an unstable Zustand array
     selector in src/hooks/useDownloads.ts — GLITCH_LOG #20). Fix with a shallow-equal
     selector; verify on the RELEASE build; mark #20 fixed in GLITCH_LOG.md.
  FIX B) Section screen bottom dead zone: move the 118px bottom pad INTO the FlatList
     contentContainerStyle (+ safe-area inset), make it conditional on the MiniPlayer
     actually showing, so the quizzes/attachments footer scrolls fully into view and
     nothing hides behind the system nav bar.
  CHANGE A) استعادة المداومة rule: recovery now requires ≥ 2 FULLY COMPLETED lessons
     within the 3-day window (migration 0044: completed_at column + new compensatory
     bar in record_meaningful_activity; drop the 240s / 2-listened / 1-completion
     paths). Update the Arabic copy in StreakCard, StreakDetailCard, and any reminder
     phrasing that still describes the old bar.
  PERF C) Instant section navigation: migration 0045 get_section_page(p_section_id)
     single-RPC (reusing existing rollup functions, security invoker, pinned
     search_path), client getSectionPage becomes one rpc call; queryClient defaults
     staleTime 30min / gcTime 7d / networkMode offlineFirst; placeholderData
     keepPreviousData; spinner ONLY when isLoading && !data; prefetch section pages
     from visible section cards on Home and in SubsectionsScroller.
  FEATURE D) Offline-first: PersistQueryClientProvider + async-storage persister
     (add @tanstack/react-query-persist-client + @tanstack/query-async-storage-persister;
     async-storage is already installed), maxAge 30d, version buster, dehydrate only
     successful non-volatile queries (persist home/sections/lectures/notes; exclude
     notifications/admin/questions/quiz-attempts). Offline cold start must render Home
     from cache (no blocking session refresh), downloaded lectures must play from the
     local file with no network call, non-downloaded ones show a calm inline notice.

WORK AUTONOMOUSLY — DO NOT ask the user questions mid-work. Every design choice is
LOCKED in the plan; proceed exactly as specified. (Only request the Supabase access
token if it's missing.) Good, calm, on-brand UI/UX is a first-class requirement.

BEFORE CODING — re-read the files the plan calls out and confirm each fact still holds:
  - src/hooks/useDownloads.ts (:67-73 selector), src/stores/downloadsStore.ts,
    app/(student)/downloads.tsx, GLITCH_LOG.md #20        (Fix E)
  - app/(student)/section/[id].tsx, src/components/ui/Screen.tsx (:31 bottomPad),
    src/components/MiniPlayer.tsx + its player store, grep bottomPad     (Fix B)
  - supabase/migrations/0014_daily_streak_recovery.sql (record_meaningful_activity,
    bar at ~:212), 0001_initial_schema.sql (user_lecture_progress — NO completed_at
    yet), src/api/progress.ts (the completed=true write path),
    src/components/home/StreakCard.tsx:165, src/components/journey/StreakDetailCard.tsx:45,
    grep «أربع دقائق»                                     (Change A)
  - src/api/sections.ts (getSectionPage :117 — the 6 sequential round-trips),
    src/hooks/useSections.ts, src/lib/queryClient.ts, src/constants/queryKeys.ts,
    src/components/section/SubsectionsScroller.tsx, app/(student)/index.tsx,
    src/mock/api.ts (keep USE_MOCK working)               (Perf C)
  - app/_layout.tsx (provider swap + session gate), src/lib/version.ts,
    src/lib/audioController.ts (:284-354 local-uri playback), src/hooks/useNotes.ts,
    package.json (@tanstack/react-query major, zustand version)   (Feature D)
  - supabase/migrations (latest is 0043; confirm — new migrations start at 0044)

RULES:
- All data-access via src/api/*; components never call supabase directly.
- Migrations are APPEND-ONLY; never edit 0001–0043. New: 0044_streak_recovery_two_lessons.sql,
  0045_get_section_page.sql. Pin search_path per 0042's convention. After applying,
  run node scripts/security-check.mjs — must stay green. Do NOT weaken any RLS policy.
- record_meaningful_activity keeps its exact signature (client callsites untouched).
- get_section_page is security INVOKER and reuses get_section_rollup /
  get_children_rollups — do not duplicate the recursive CTEs.
- RTL throughout; calm Islamic tone; Arabic UI strings stay Arabic; Feather icons only.
  No leaderboard/competitive UI. No code comments unless the WHY is non-obvious.
- Only the two @tanstack persist packages may be added as dependencies — nothing else,
  no native modules (this must not require a new native rebuild beyond the normal one).
- To apply migrations live: project ref prpyxnxgkpspjoxvcaro; POST SQL to
  POST /v1/projects/{ref}/database/query with the user's access token (send a browser
  User-Agent header — the endpoint 403s behind Cloudflare without one); regen types via
  GET /v1/projects/{ref}/types/typescript into src/types/database.generated.ts. Ask for
  the token if it's missing.
- To build+install: set $env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10",
  PREPEND node to PATH ($env:PATH = "C:\Program Files\nodejs;" + $env:PATH), then run
  android\gradlew.bat -p android :app:assembleRelease, then install with the full adb
  path: & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R5CX10P3BPL install -r
  android\app\build\outputs\apk\release\app-release.apk
  (If a Metro "ENOTEMPTY … metro-cache" error appears, delete %TEMP%\metro-cache and rebuild.)
- Package id: com.riwaqalilm.app · scheme: riwaqalilm. Demo admin: admin@gmail.com / test55%%.
  Device screenshots: adb ... shell screencap -p /sdcard/x.png then adb ... pull (piping
  screencap through PowerShell corrupts the PNG).

Verify on device (release build), per the plan's Verification section:
1. /downloads opens clean — empty AND with downloads present (this crashed before).
2. كتاب التوحيد: scroll to bottom — the «اختبر هذا العنصر» quiz card is fully visible,
   no dead band, nothing under the system bar; repeat with the MiniPlayer active.
3. Streak recovery: 1 completed lesson in the window → NOT restored; 2nd completed →
   restored; 4+ minutes listening alone → NOT restored. New copy shows in the sheet
   and on the journey card.
4. Cold-open العقيدة → ONE round trip; reopen → instant, no spinner; prefetched child
   section opens instantly.
5. Offline drill: play a downloaded lecture → force-stop → airplane mode → relaunch:
   Home + sections + lecture names + notes all render from cache; the downloaded
   lecture plays from the local file; a non-downloaded lecture shows the calm inline
   notice (no spinner, no crash).
6. security-check.mjs green; types regenerated; GLITCH_LOG #20 marked fixed.

Supabase access token: ask the user — do not assume the one from a prior session is
still valid.
