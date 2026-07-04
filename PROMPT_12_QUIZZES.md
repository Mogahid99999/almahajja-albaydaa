Project: المَحجّة البَيْضَاء — Expo SDK 56 (React Native + TypeScript), Supabase backend,
Zustand + TanStack Query, Expo Router file-based routing, RTL Arabic-first app.
Working directory: D:\Projects\Al-Mahajjah\App\almahajja-albaydaa
Build target: Android standalone RELEASE (test device R5CX10P3BPL). USE_MOCK=false.
Plan file: @PLAN_12_QUIZZES.md   (read it fully — it is the complete spec for this session.)

TASK: Implement Feature 12 — الاختبارات (section quizzes), MCQ-only v1, exactly as
described in PLAN_12_QUIZZES.md, following the "Build Order" section. Quizzes attach
to a SECTION node (رئيسي or عنصر داخلي), never to a single lecture. Calm/non-competitive
tone: personal results only, no leaderboards, no student-visible comparison.

BEFORE CODING — read these first and confirm your understanding of the patterns you'll copy:
  - supabase/migrations/0002_attachments.sql        (section-owned content: table + order + admin/student RLS)
  - supabase/migrations/0015_study_buddy.sql         (SECURITY DEFINER RPC pattern — sensitive logic stays server-side)
  - supabase/migrations/0006_notify_fanout.sql       (followers_of_section subtree walk, for the optional publish push)
  - src/api/attachments.ts                            (data-access layer style; USE_MOCK branching)
  - app/(student)/section/[id].tsx                    (where the student quiz card goes)
  - src/api/sections.ts  (getSectionPage)             (add quizzes[] to the section DTO)
  - src/components/admin/AdminShell.tsx  (NAV_ITEMS)  (add the الاختبارات admin nav item)
  - app/admin/upload.tsx                              (admin form conventions to mirror in the quiz editor)
  - src/api/types.ts, src/constants/queryKeys.ts      (where the new DTOs + query keys go)

Then CONFIRM the 5 open questions in the plan's "Open questions" section before Step 1:
  1. Must a student REGISTER to take a quiz, or can guests take them? (plan default: register-to-take)
  2. Single-correct MCQ acceptable for v1? (plan default: yes)
  3. Total score = sum(question points), pass_score = absolute points? (plan default: yes)
  4. Once passed, stays passed; best_score drives status? (plan default: yes)
  5. Time limit = client countdown + server clamp on submit is enough? (plan default: yes)
Use AskUserQuestion for these, then start with Step 1 (migration 0017).

THE ONE HARD CONSTRAINT (do not violate):
  A student solving a quiz must NEVER be able to read quiz_options.is_correct. Students get
  NO direct SELECT on quiz_questions / quiz_options. All student read/solve/submit flows go
  ONLY through SECURITY DEFINER RPCs that strip the answer key and grade server-side on submit.
  This is the inverse of attachments RLS and the central design decision of the feature.

RULES:
- All data-access via src/api/*; components never call supabase directly.
- Grading, counts, "not-taken" = server-side SQL rollups, never client tree-walking.
- RTL throughout; calm Islamic tone; no competitive framing, no leaderboards, results are
  personal and never shown to other students (only the admin dashboard sees them).
- Arabic UI strings stay in Arabic exactly as written in the plan.
- No code comments unless the WHY is non-obvious.
- Migrations are append-only; never edit 0001–0016. New migrations start at 0017.
- buildFromSource: ["expo-audio"] in package.json is intentional — do not remove it.
- To apply migrations live: the Supabase project ref is prpyxnxgkpspjoxvcaro; migrations
  can be applied via the Management API query endpoint with the user's access token
  (POST /v1/projects/{ref}/database/query), and types regenerated via
  GET /v1/projects/{ref}/types/typescript. (Ask the user for the token if not provided.)
- To build+install: set $env:JAVA_HOME = "C:\Users\Dafa-Alla\.jdks\jdk-17.0.19+10", run
  android\gradlew.bat :app:assembleRelease, then
  adb -s R5CX10P3BPL install -r android\app\build\outputs\apk\release\app-release.apk.

You may enhance the plan if you find a cleaner approach — but keep the answer-key
server-side constraint and the calm/non-competitive tone non-negotiable.
