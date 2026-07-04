Project: المَحجّة البَيْضَاء — Expo SDK 56 (React Native + TypeScript), Supabase backend,
Zustand + TanStack Query, Expo Router file-based routing, RTL Arabic-first app.
Working directory: D:\Projects\Al-Mahajjah\App\almahajja-albaydaa
Build target: Android standalone RELEASE (test device R5CX10P3BPL). USE_MOCK=false.
Plan file: @PLAN_ADMIN_V5.md   (read it fully — it is the complete spec for this session.)

TASK: Enhance the admin panel (لوحة التحكم) per PLAN_ADMIN_V5.md, following its "Build Order".
Six areas: (1) make every admin screen responsive on a phone; (2) richer dashboard stats;
(3) a تحليلات التقدم العلمي (progress analytics) section; (4) إدارة المستخدمين (user
management) with admin actions; (5) a limited "ناشر" (publisher) role + a seeded test
account; (6) an editable «عن المنصة» page with a Telegram live-broadcast link.

The admin panel runs INSIDE the native app (AuthGate routes role==='admin' → /admin) and on
web; most work is JS + SQL + one new Edge Function. Keep the calm, non-competitive Islamic
tone; NO public student-vs-student ranking; Arabic UI strings stay Arabic exactly as written.

BEFORE CODING — re-read the current state of the files the plan calls out and confirm each
fact against the live code (the plan lists what was verified this session). Key files:
  - src/components/admin/AdminShell.tsx            (nav list + responsive shell; Features 1,5)
  - app/admin/index.tsx                            (dashboard; Feature 2)
  - app/admin/*.tsx                                (per-screen responsive audit; Feature 1)
  - src/api/auth.ts, app/_layout.tsx (AuthGate)    (roles + routing; Feature 5)
  - supabase/migrations/0001_initial_schema.sql    (is_admin(), app_role enum, content RLS)
  - src/types/database.generated.ts                (profiles / daily_listening / quiz_attempts / weekly_goals)
  - app/(student)/about.tsx                        (editable About; Feature 6)
  - supabase/migrations/0021_app_config.sql        (app_config key/value store; Feature 6)
  - supabase/functions/notify-on-publish/index.ts  (Edge Function deploy pattern; Feature 4)

Then CONFIRM the 5 open questions in the plan's "Open questions" section BEFORE Step 1,
using AskUserQuestion:
  1. Account status model — derive (banned_until + inactivity) vs a stored column? inactivity window?
  2. "Active today" definition + good-progress / started-stopped thresholds.
  3. Password edit — direct service-role set (recommended) vs reset link; may admin change roles?
  4. Publisher scope — the 5 listed items only, or also المحاضرات الواردة (unclassified)?
  5. About editing shape — fixed fields (recommended) vs free-text; Telegram URL the only new link?

RULES:
- All data-access via src/api/*; components never call supabase directly.
- Rollups/counts/aggregates are server-side SQL (SECURITY DEFINER RPCs), never client-side.
- Admin READS of user data → DEFINER RPCs gated on public.is_admin(). Admin MUTATIONS that
  need the service role (set password w/o old, ban/unban, edit another user's email) → the
  new `admin-users` Edge Function (verify_jwt=true; verify caller is admin inside). NEVER put
  the service-role key in the client bundle.
- Content-table writes move from is_admin() → a new is_content_manager() (admin OR publisher);
  profiles / analytics / users / app_config writes STAY is_admin() only.
- RTL throughout; calm Islamic tone; no competitive framing; no public student ranking.
- No code comments unless the WHY is non-obvious.
- Migrations are APPEND-ONLY; never edit 0001–0021. New migrations start at 0022. A new enum
  value ('publisher') needs its OWN migration/transaction step (0022) before it's used (0023).
  Re-create RLS policies with drop-if-exists/create in a NEW migration — never edit old ones.
- To apply migrations live: Supabase project ref is prpyxnxgkpspjoxvcaro; POST the SQL to the
  Management API query endpoint (POST /v1/projects/{ref}/database/query) with the user's
  access token, and regen types via GET /v1/projects/{ref}/types/typescript into
  src/types/database.generated.ts. (Ask the user for the token; don't assume a prior one is valid.)
- To deploy the Edge Function: multipart POST to
  /v1/projects/{ref}/functions/deploy?slug=admin-users (metadata {entrypoint_path:"index.ts",
  name, verify_jwt:true} + the index.ts file) — mirror how notify-on-publish was deployed.
  Edge Functions are NOT part of the APK.
- To build+install: set $env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10", PREPEND
  node to PATH ($env:PATH = "C:\Program Files\nodejs;" + $env:PATH) — gradle shells out to
  node — then run android\gradlew.bat -p android :app:assembleRelease, then install with
  the full adb path: & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R5CX10P3BPL
  install -r android\app\build\outputs\apk\release\app-release.apk
  (If a Metro cache error "ENOTEMPTY … metro-cache" appears, delete %TEMP%\metro-cache and rebuild.)
- Package id: com.riwaqalilm.app · scheme: riwaqalilm. Demo admin: admin@gmail.com / test55%%.
  Device screenshots: adb ... shell screencap -p /sdcard/x.png then adb ... pull (piping
  screencap through PowerShell corrupts the PNG).

Do NOT force the V4 app_config `min_app_version` above the installed version on the LIVE DB —
it's a global gate and would lock out real users. Leave it at 1.0.0.

Some areas need a seeded publisher account + a real student with progress/quiz history to
fully verify — note what you verified vs what needs those accounts.

You may improve on the plan's approach where you find something cleaner, but keep the calm
non-competitive tone, the no-public-ranking rule, the service-role-only-in-Edge-Function rule,
and the append-only migration rule non-negotiable.

Supabase access token (if needed): ask the user — do not assume the one from a prior session
is still valid.
