Project: المَحجّة البَيْضَاء — Expo SDK 56 (React Native + TypeScript), Supabase backend,
Zustand + TanStack Query, Expo Router file-based routing, RTL Arabic-first app.
Working directory: D:\Projects\Al-Mahajjah\App\almahajja-albaydaa
Build target: Android standalone RELEASE (test device R5CX10P3BPL). USE_MOCK=false.
Plan file: @PLAN_QNA_NOTES_V6.md   (read it fully — it is the complete, DECIDED spec.)

TASK: Build three student-facing features per PLAN_QNA_NOTES_V6.md, following its "Build Order":
  A) أسئلة وأجوبة (Q&A) — a general questions space (entry on Home) AND per-lesson questions
     (opened from the lecture), each: public list of answered questions, a compose box with
     "نشر باسمي / إخفاء الاسم" and "للعامة / للشيخ فقط". A NEW "شيخ" (sheikh) role + login with
     an inbox to receive & answer questions, and delete-any (sheikh or admin). Notifications:
     sheikh ← new question, asker ← answer.
  B) ملاحظاتي — a private per-lesson note (summary), visible only to that student, autosaved.
  C) فوائد الدارسين — an anonymous "benefits" space per lesson: everyone sees the benefit text
     with NO author name; author may delete their own; only admin sees the author, can hide/
     delete any, and ban the writer.

WORK AUTONOMOUSLY — DO NOT ask the user questions mid-work. Every design choice is already
LOCKED in the plan's "Locked decisions" section; pick the best-recommended option everywhere
and proceed. (The only thing to request if missing is the Supabase access token.)

Good UI/UX is a first-class requirement: calm, on-brand (teal/brass, RTL), uncluttered.

BEFORE CODING — re-read the current state of the files the plan calls out and confirm each
fact against the live code. Key files:
  - src/api/auth.ts, app/_layout.tsx (AuthGate + deep-links)   (roles + routing)
  - src/api/types.ts, src/components/notifications/labels.ts   (NotificationType + labels)
  - supabase/functions/admin-users/index.ts                    (add 'sheikh' to VALID_ROLES)
  - app/admin/sheikhs.tsx                                       (add "إضافة حساب شيخ")
  - app/(student)/index.tsx                                     (Home — add "ساحة الأسئلة" card)
  - app/player/[id].tsx, src/components/player/PlayerUtilityBar.tsx  ("أدوات الدرس" tools row; keep V4 safe-area inset)
  - supabase/migrations/0026_*.sql (latest)                    (migration numbering — new ones start at 0027)
  - src/types/database.generated.ts                            (app_role, notification_type, lectures/sheikhs)

RULES:
- All data-access via src/api/*; components never call supabase directly.
- Cross-user reads + all moderation are server-side SECURITY DEFINER RPCs. Anonymity is
  enforced IN SQL: the public/sheikh RPCs must NEVER return the author of an anonymous
  question or of any فائدة — only is_admin() RPCs may resolve the author.
- Posting (question / benefit / note) requires a registered account (reuse the quiz-style
  register nudge for guests); reading is open to guests.
- Content-write gating: questions/benefits use their own RLS (asker/author = auth.uid) + the
  DEFINER RPCs; answering/deleting is is_moderator() (sheikh|admin); benefit moderation +
  author-identity is is_admin() only.
- RTL throughout; calm Islamic tone; NO public ranking; NO author names on anonymous content.
- No code comments unless the WHY is non-obvious.
- Migrations are APPEND-ONLY; never edit 0001–0026. New migrations start at 0027. New enum
  values ('sheikh', 'question_received', 'question_answered') need their OWN migration/
  transaction step (0027) before they're used (0028+). Re-create policies with drop-if-exists/
  create in NEW migrations — never edit old ones.
- Notifications ride the EXISTING pipeline (INSERT public.notifications → 0009 webhook →
  notify-on-publish → Expo Push). Do NOT change notify-on-publish for this; just insert rows
  of the new types inside the DEFINER RPCs (best-effort, swallow errors).
- To apply migrations live: Supabase project ref is prpyxnxgkpspjoxvcaro; POST the SQL to
  the Management API query endpoint (POST /v1/projects/{ref}/database/query) with the user's
  access token; regen types via GET /v1/projects/{ref}/types/typescript into
  src/types/database.generated.ts. Ask the user for the token — don't assume a prior one is valid.
- To redeploy the admin-users Edge Function (add 'sheikh'): multipart POST to
  /v1/projects/{ref}/functions/deploy?slug=admin-users with metadata
  {entrypoint_path:"index.ts", name:"admin-users", verify_jwt:true} + index.ts. Edge Functions
  are NOT part of the APK.
- Seed ONE sheikh account (email + password + role sheikh + profiles.role + a sheikhs row) via
  the admin-users createUser action (or Management API) and hand the credentials to the user,
  the way publisher@gmail.com was seeded.
- To build+install: set $env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10", PREPEND
  node to PATH ($env:PATH = "C:\Program Files\nodejs;" + $env:PATH), then run
  android\gradlew.bat -p android :app:assembleRelease, then install with the full adb path:
  & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s R5CX10P3BPL install -r
  android\app\build\outputs\apk\release\app-release.apk
  (If a Metro "ENOTEMPTY … metro-cache" error appears, delete %TEMP%\metro-cache and rebuild.)
- Package id: com.riwaqalilm.app · scheme: riwaqalilm. Demo admin: admin@gmail.com / test55%%.
  Device screenshots: adb ... shell screencap -p /sdcard/x.png then adb ... pull (piping
  screencap through PowerShell corrupts the PNG).

Do NOT touch the V4 app_config min_app_version (leave it 1.0.0 — a global gate that would lock
out real users). Do NOT weaken existing RLS.

Verify end-to-end on the device with the seeded sheikh + a registered student: ask (public &
sheikh-only, named & anonymous) → sheikh inbox + push → answer → asker push + appears publicly
(name hidden when anonymous) → admin can delete & sees the real author. Note autosaves & is
private. Benefit posts with no name → author deletes own → admin sees author, hides, bans.
Note what you verified vs what needs extra accounts.

Supabase access token: ask the user — do not assume the one from a prior session is still valid.
