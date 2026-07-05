Project: المَحجّة البَيْضَاء — Expo SDK 56 (React Native + TypeScript), Supabase backend,
Zustand + TanStack Query v5 (with PersistQueryClientProvider since V10), Expo Router,
RTL Arabic-first app.
Working directory: D:\Projects\Al-Mahajjah\App\almahajja-albaydaa
Build target: Android standalone RELEASE (test device R5CX10P3BPL — Samsung/One UI;
if R5CX10P3BPL is absent, use the running emulator). USE_MOCK=false.
Plan file: @PLAN_V11_OFFLINE_SYNC.md   (read it fully — it is the complete, DECIDED spec.)

TASK: Per PLAN_V11_OFFLINE_SYNC.md, in its build order S → A → C → B → D → E:
  S) Migrations 0046 (apply_meaningful_activity day-parameterised core +
     record_meaningful_activity wrapper + save_activity one-call progress RPC with
     replay semantics) and 0047 (get_home_page single-RPC Home). Apply live, regen
     types, security-check must stay 20/20.
  A) Connectivity foundation: add expo-network (the ONLY new dependency), new
     src/lib/connectivity.ts wiring TanStack onlineManager + isOnline() + onReconnect().
  C) Live progress tick becomes ONE rpc('save_activity') call (currently ~5 network
     calls every 5s: select-prev + upsert + record_meaningful_activity +
     get_journey_summary + user_badges select). Delta computed client-side from the
     last saved position in audioController; badges re-evaluated ONLY on completion.
  B) Offline outbox (src/lib/outbox.ts, AsyncStorage): coalesced activity/note/goal
     entries, day-accurate replay via save_activity(p_day, p_is_replay=true) sorted by
     day, flush on reconnect + app-foreground + post-boot + 60s-while-nonempty.
     Optimistic note + weekly-goal edits with the quiet «سيُحفظ عند عودة الاتصال» state.
  D) getHomeData = one rpc('get_home_page'); prefetch getLecturePlayback for the
     resume card and for resolveNext's target (gapless auto-advance; skip offline).
  E) Persist ['quizzes','myStats'] + notifications root; keepPreviousData on
     journey/goal/badges/notifications hooks; offline mark-read stays unqueued.

WORK AUTONOMOUSLY — DO NOT ask the user questions mid-work. Every design choice is
LOCKED in the plan. (Only request the Supabase access token if it's missing — never
commit it to any file.) Good, calm, on-brand UI/UX is a first-class requirement.

BEFORE CODING — re-read the files the plan cites and confirm each fact still holds:
  - supabase/migrations/0044_streak_recovery_two_lessons.sql (the body to refactor
    into apply_meaningful_activity), 0045_get_section_page.sql (style to mirror),
    0039 (grant/revoke convention)                                     (S)
  - src/api/progress.ts:101-163 (saveLectureProgress pipeline), src/api/journey.ts:134-176
    (recordListening + badge diff), src/lib/audioController.ts:127-131 + :218-230
    (tick + persist), src/config.ts:39 (MAX_LISTEN_TICK_SEC)           (C)
  - src/lib/downloads.ts:90 (sidecar position stays), src/api/notes.ts:29,
    src/hooks/useNotes.ts, app/(student)/lecture-note/[id].tsx (~:200 save states),
    src/hooks/useJourney.ts:39 (useSetWeeklyGoal), app/_layout.tsx (NotificationsBootstrap
    onActive — the foreground flush hook point)                        (B)
  - src/api/sections.ts:25-114 (getHomeData 5 sequential awaits), src/api/lectures.ts
    (getLecturePlayback + audioUrl TTL 3600s), src/hooks/useLecture.ts (queryKeys.lecture),
    src/lib/audioController.ts:154-169 (resolveNext)                   (D)
  - app/_layout.tsx:57 (PERSISTED_QUERY_ROOTS + shouldDehydrateQuery),
    src/constants/queryKeys.ts (myQuizStats / notifications keys),
    app/(student)/journey.tsx:90+:124                                  (E)
  - supabase/migrations: latest is 0045; confirm — new migrations start at 0046.

RULES:
- All data-access via src/api/*; components never call supabase directly.
- Migrations APPEND-ONLY (0046_offline_activity_sync.sql, 0047_get_home_page.sql);
  pin search_path = public; revoke PUBLIC/anon + grant authenticated per 0039; never
  weaken RLS. record_meaningful_activity(uuid,integer,boolean) keeps its exact
  signature. save_activity live path keeps today's position-overwrite semantics;
  ONLY replay uses greatest(); completed is always OR-merged; completed_at never
  overwritten once set.
- Only expo-network may be added as a dependency — nothing else.
- USE_MOCK=true must keep working (mock paths untouched).
- RTL; calm Islamic tone; Arabic UI strings stay Arabic; Feather icons only; NO
  offline banners/toasts beyond the two quiet inline states the plan specifies.
- To apply migrations live: project ref prpyxnxgkpspjoxvcaro; POST the SQL to
  POST /v1/projects/{ref}/database/query with the user's access token AND a browser
  User-Agent header (the endpoint 403s behind Cloudflare without one); regen types via
  GET /v1/projects/{ref}/types/typescript into src/types/database.generated.ts.
  Then run node scripts/security-check.mjs — must stay 20/20 — and npx tsc --noEmit.
- To build+install: $env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10";
  PREPEND node to PATH ($env:PATH = "C:\Program Files\nodejs;" + $env:PATH); run
  android\gradlew.bat -p android :app:assembleRelease; install with the full adb path:
  & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R5CX10P3BPL install -r
  android\app\build\outputs\apk\release\app-release.apk
  (Metro "ENOTEMPTY … metro-cache" error → delete %TEMP%\metro-cache and rebuild.
  expo-network is a new native module: the normal assembleRelease rebuild links it.)
- Package id: com.riwaqalilm.app · scheme: riwaqalilm.
- Device screenshots: adb ... shell screencap -p /sdcard/x.png then adb ... pull
  (piping screencap through PowerShell corrupts the PNG).
- OFFLINE testing must use FULL airplane mode (cmd connectivity airplane-mode enable
  + svc wifi disable + svc data disable) — disabling one radio is not offline.

Verify on device (release build), per the plan's Verification section:
1. Online tick audit: exactly one save_activity call per ~5s of playback; resume,
   completion, and streak behavior unchanged.
2. THE CORE DRILL — airplane mode: play a downloaded lecture ≥3 min, edit its note,
   change the weekly goal; force-stop; relaunch still offline (optimistic values
   visible); reconnect → within ~1 min the server has the listening seconds (streak
   card shows «واصلت اليوم»), the note body, and the new goal. Plus one day-boundary
   replay proving yesterday's outbox entry credits YESTERDAY's daily_listening row.
3. Cold Home = ONE network round-trip; «تابع الاستماع» opens with no metadata wait;
   auto-advance is gapless.
4. Airplane mode: رحلتي العلمية shows streak ring + weekly goal + الأوسمة +
   «اختباراتك»; notifications inbox shows last-fetched rows.
5. Airplane toggle while the app is open → queries refetch on reconnect (onlineManager).
6. security-check 20/20; types regenerated; typecheck clean.
