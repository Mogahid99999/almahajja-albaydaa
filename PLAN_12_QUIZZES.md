# Plan: Feature 12 — الاختبارات (Section Quizzes)

**Date:** 2026-07-02
**Target:** Android standalone RELEASE build, device R5CX10P3BPL, USE_MOCK=false
**Spec:** PRD §12 (الاختبارات). MCQ-only v1. Quizzes attach to a **section node**
(رئيسي or عنصر داخلي), never to a single lecture. Calm/non-competitive tone —
personal results only, no leaderboards, no student-visible comparison.

---

## Context: What's Already Built (reuse, don't reinvent)

- **Nested `sections` tree** — every "قسم رئيسي" and "عنصر داخلي" is a `sections`
  row. A quiz's owner is therefore always `section_id` (covers both). No lecture
  attachment in v1 (PRD §12.6).
- **`attachments` table (0002)** is the closest structural template: owner =
  section, `order`, admin-write / student-read-published RLS, `is_admin()` guard.
  Quizzes copy this shape (minus storage — no files).
- **`user_lecture_progress` (0001)** is the template for personal attempt rows
  (own-rows RLS, `user_id = auth.uid()`).
- **`new_quiz` notification type ALREADY EXISTS** in the enum + prefs + labels
  (shipped inert "so the pref + payload light up later with no migration"). The
  publish fan-out (Phase F) reuses it with **no enum migration**.
- **Notification fan-out pipeline** (0006 `followers_of_section` subtree walk →
  0007 insert `notifications` rows → 0009 webhook → `notify-on-publish` Edge
  Function → Expo Push). Phase F plugs into this unchanged.
- **Admin panel** `app/admin/*` inside `AdminShell` (nav = `NAV_ITEMS` in
  `src/components/admin/AdminShell.tsx`). Add a `quizzes` nav item.
- **Student section page** `app/(student)/section/[id].tsx` renders a section DTO
  (`SectionPageData`). Add a quizzes block to the DTO + page.
- **Server-side-logic precedent**: the 26.2 buddy feature put all sensitive /
  cross-cutting logic in `SECURITY DEFINER` RPCs (gender segregation in SQL,
  never client). Quizzes do the same — **answer keys never reach the student
  client** until submission.
- **Last migration: `0016_buddy_notifications.sql` → new migrations start at `0017`.**
- All data-access via `src/api/*`; rollups are server-side SQL; RTL throughout;
  Arabic strings verbatim; append-only migrations (never edit 0001–0016);
  `buildFromSource: ["expo-audio"]` stays in package.json.

### The one hard constraint: the answer key must stay server-side
A student solving a quiz must **never** be able to read `quiz_options.is_correct`
(a direct table SELECT would leak the key). Therefore:
- Student read/solve/submit flows go **only** through `SECURITY DEFINER` RPCs that
  strip `is_correct` before returning, and grade server-side on submit.
- Direct table RLS grants students **no** SELECT on quiz content tables (only
  admins read them directly). This is the inverse of `attachments`, and is the
  central design decision of this feature.

---

## Feature 12 — Data Model

### Phase A — Database (migration `0017_quizzes.sql`)

**Tables**

```sql
-- A quiz attached to a section node (رئيسي or داخلي). One section may have >1.
create table public.quizzes (
  id                    uuid primary key default gen_random_uuid(),
  section_id            uuid not null references public.sections(id) on delete cascade,
  title                 text not null,
  description           text,
  pass_score            integer not null default 0,   -- درجة النجاح (absolute points)
  time_limit_sec        integer,                       -- null = no limit
  max_attempts          integer,                       -- null = unlimited
  show_result           boolean not null default true, -- إظهار النتيجة بعد التسليم
  show_correct_answers  boolean not null default false,-- إظهار الإجابات الصحيحة
  status                text not null default 'draft'
                          check (status in ('draft','published')),
  "order"               integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.quiz_questions (
  id       uuid primary key default gen_random_uuid(),
  quiz_id  uuid not null references public.quizzes(id) on delete cascade,
  text     text not null,
  points   integer not null default 1,   -- درجة كل سؤال
  "order"  integer not null default 0
);

create table public.quiz_options (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.quiz_questions(id) on delete cascade,
  text         text not null,
  is_correct   boolean not null default false,  -- SERVER-SIDE ONLY, never sent to students
  "order"      integer not null default 0
);

-- One row per (user, quiz, attempt_no). submitted_at null = in progress.
create table public.quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempt_no   integer not null default 1,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  score        integer,      -- null until submitted
  passed       boolean,      -- null until submitted
  unique (user_id, quiz_id, attempt_no)
);

create table public.quiz_attempt_answers (
  attempt_id   uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id  uuid not null references public.quiz_questions(id) on delete cascade,
  option_id    uuid not null references public.quiz_options(id) on delete cascade,
  primary key (attempt_id, question_id)   -- one choice per question (MCQ single-answer)
);
```

**Total score** (الدرجة الكلية) is **derived** = `sum(points)` over the quiz's
questions — never stored, so it can't drift from the questions. `pass_score` is
an absolute points threshold the admin sets.

**RLS**

| Table | Student | Admin |
|---|---|---|
| `quizzes` | SELECT only where `status='published'` (for the section card + intro) — **content-free columns are safe**, but see note | all |
| `quiz_questions` | **no direct select** | all |
| `quiz_options` | **no direct select** (would leak `is_correct`) | all |
| `quiz_attempts` | own rows (`user_id = auth.uid()`) | all (results dashboard) |
| `quiz_attempt_answers` | own rows via attempt ownership | all |

Note: students may directly read `quizzes` (published) for the pre-quiz card, but
**questions/options come only through the DEFINER RPC** below. Admin writes to all
content tables via `is_admin()` (copy `attachments_admin_write`).

**Student RPCs (all `SECURITY DEFINER`, answer key stripped):**

- `get_section_quizzes(p_section_id uuid)` → published quizzes for a section, each
  with `question_count`, `total_score`, and the caller's status fields
  (`attempts_used`, `attempts_left`, `best_score`, `passed`, `in_progress_attempt_id`).
- `get_quiz_intro(p_quiz_id uuid)` → title, section title, `question_count`,
  `total_score`, `pass_score`, `time_limit_sec`, `max_attempts`, `attempts_left`,
  student status (§12.2). Published-only.
- `start_quiz_attempt(p_quiz_id uuid)` → returns `attempt_id`. Enforces
  `max_attempts` (raise if exhausted), reuses an existing in-progress attempt
  instead of creating a duplicate, stamps `attempt_no`.
- `get_attempt_questions(p_attempt_id uuid)` → questions + options **without
  `is_correct`**, plus any already-saved answer per question (resume). Own attempt
  only.
- `save_quiz_answer(p_attempt_id uuid, p_question_id uuid, p_option_id uuid)` →
  upsert into `quiz_attempt_answers`. Own, still-in-progress attempt only.
- `submit_quiz_attempt(p_attempt_id uuid)` → grades server-side (`sum(points)`
  where the chosen option `is_correct`), sets `score`/`passed`/`submitted_at`,
  returns the result honoring `show_result` / `show_correct_answers`
  (score, passed, correct_count, wrong_count; correct-answer detail only if the
  admin enabled it). Enforces `time_limit_sec` (clamp/auto-submit if over).
- `get_attempt_result(p_attempt_id uuid)` → the result view for a submitted
  attempt (same visibility rules), for re-opening the result later.

**Admin RPCs (`SECURITY DEFINER` + `is_admin()` guard):**

- `get_quiz_results_summary(p_quiz_id uuid)` (§12.5) → entered count, passed,
  failed, incomplete, avg/max/min score, and `not_taken` = distinct followers of
  the quiz's section subtree (reuse `followers_of_section`) minus those who have
  an attempt.
- `list_quiz_result_rows(p_quiz_id uuid)` → per-student: display_name, status
  (اجتاز/لم يجتز/لم يكمل/استنفد), best score, attempts used, last attempt time.
- `get_attempt_detail(p_attempt_id uuid)` → a student's answers with per-question
  correct/wrong, completion time, attempt_no (§12.5 drill-down).

Grades/counts are **server-side rollups** (CLAUDE.md), never client tree-walking.

---

### Phase B — Types + API + Hooks

**`src/api/types.ts`** — add:
`QuizStatus` (`'not_started' | 'in_progress' | 'submitted' | 'passed' | 'failed' | 'exhausted'`),
`QuizCard`, `QuizIntro`, `QuizQuestion` (options without `isCorrect`),
`QuizResult`, `AdminQuizResultRow`, `AdminQuizSummary`, `AdminAttemptDetail`,
plus admin editor input types (`QuizInput`, `QuizQuestionInput`, `QuizOptionInput`).

**`src/api/quizzes.ts`** — student:
`getSectionQuizzes`, `getQuizIntro`, `startAttempt`, `getAttemptQuestions`,
`saveAnswer`, `submitAttempt`, `getAttemptResult`.
Admin: `adminListQuizzes(sectionId)`, `createQuiz`, `updateQuiz`, `deleteQuiz`,
`setQuizStatus`, `upsertQuestions`/`reorder`, `getQuizResultsSummary`,
`listQuizResultRows`, `getAttemptDetail`. All branch on `USE_MOCK` (return inert
empty shapes in mock, matching the buddy/notification pattern).

**`src/constants/queryKeys.ts`** — add:
`sectionQuizzes(sectionId)`, `quizIntro(quizId)`, `quizAttempt(attemptId)`,
`adminQuizzes(sectionId)`, `adminQuizResults(quizId)`, `adminAttempt(attemptId)`.

**`src/hooks/useQuizzes.ts`** — query hooks (`useSectionQuizzes`, `useQuizIntro`,
`useAttemptQuestions`, `useAttemptResult`) + mutations (`useStartAttempt`,
`useSaveAnswer`, `useSubmitAttempt`). Student hooks disabled for... actually
quizzes are open to any signed-in user (guests included, since browsing is open) —
**decide with the user**: does taking a quiz require registration? Default
assumption: **yes, gate quiz-taking behind registration** (results are personal &
synced), showing the intro card to guests with a register nudge. Confirm in Q&A.

---

### Phase C — Student UI

**A. Quiz card on the section page** (`app/(student)/section/[id].tsx`)
Add `quizzes: QuizCard[]` to `SectionPageData` (fetched via `get_section_quizzes`
inside `getSectionPage`), and render a **quiz block above the attachments block,
below the lectures** — a clear standalone card per PRD §12.2, not crowding the
lectures:

- Card title: `اختبار هذا القسم` (or `اختبار هذا العنصر` when the node is a child).
- Shows: quiz title, question count, pass score, time limit (if any), attempts
  allowed + remaining, and a status pill (لم يبدأ / قيد الحل / مكتمل / ناجح / غير مجتاز).
- Tap → quiz intro screen.

**B. Quiz intro screen** (`app/(student)/quiz/[id].tsx`)
Pre-quiz summary (§12.2): title, section name, عدد الأسئلة, زمن الاختبار,
درجة النجاح, المحاولات المسموح/المتبقية, current status. Primary button:
`ابدأ الاختبار` (or `تابع الاختبار` when an attempt is in progress; disabled +
`استنفدت المحاولات` when exhausted). Calls `startAttempt` → routes to the solver.

**C. Quiz solver screen** (`app/(student)/quiz/[id]/attempt.tsx` or
`app/(student)/quiz-attempt/[attemptId].tsx`)
§12.3: one question with its options below, next/prev navigation, remaining-count
indicator, answers saved as you go (`saveAnswer` on each pick), a clear
`تسليم الاختبار` button, and a **confirmation sheet before final submit**
(`هل أنت متأكد من تسليم إجاباتك؟`). If `time_limit_sec` set, a calm countdown that
auto-submits on expiry. On submit → result screen.

**D. Quiz result screen** (reuse solver route in a `submitted` mode, or
`app/(student)/quiz-result/[attemptId].tsx`)
§12.3: if `show_result` — الدرجة, اجتاز/لم يجتز, عدد الصحيحة, عدد الخاطئة, and a
calm message:
- pass: `نفعك الله بما تعلمت.`
- fail: `أعد المحاولة، ونسأل الله لك التوفيق.`
If `show_correct_answers` — per-question correct answer shown; otherwise result
only, no detailed correction. Offer `إعادة المحاولة` when attempts remain.

**E. Journey page (optional, §12.4)** — a quiet "اختباراتك" summary line on
`app/(student)/journey.tsx` (count passed / attempted). No comparison.

---

### Phase D — Admin UI

**A. Nav + list** — add `{ key:'quizzes', label:'الاختبارات', href:'/admin/quizzes', icon:'check-square' }`
to `NAV_ITEMS` (`AdminShell.tsx`) and a dashboard quick-link/stat. New screen
`app/admin/quizzes.tsx`: quizzes grouped by section (uses `getSectionsFlat` for
the picker), status pills, create button.

**B. Quiz editor** `app/admin/quiz-edit.tsx` (create + edit; mirrors
`app/admin/upload.tsx` form conventions):
- Fields (§12.1): title, section picker (flat tree), description, pass_score,
  time_limit (optional), max_attempts (optional = ∞), show_result toggle,
  show_correct_answers toggle, status (draft/published), order.
- Questions builder: add/remove questions; per question text + points + 2–n
  options with a single "correct" selector; reorder. Total score shown live
  (`sum(points)`).

**C. Results dashboard** `app/admin/quiz-results.tsx` (§12.5):
summary tiles (entered / passed / failed / incomplete / not-taken / avg / max /
min) + a per-student table (status, score, attempts, last attempt). Row tap →

**D. Attempt detail** `app/admin/quiz-attempt.tsx` (§12.5 drill-down):
the student's answers, right/wrong per question, completion time, prior attempts.
Admin-only; students never see each other's results (§12.6).

---

### Phase E — Publish notification (optional, migration `0018_quiz_publish_notify.sql`)

On a quiz flipping to `published`, fan out a `new_quiz` notification to followers
of the quiz's section subtree (reuse `followers_of_section` + the 0007 insert
pattern + 0009 webhook). **No enum migration** — `new_quiz` already exists.
Phrase e.g. `اختبار جديد في {القسم} — قِس ما تعلمت`. Gated by each follower's
`new_quiz` pref (missing row = ON) and quiet hours, same as other content pushes.
Ship this only after A–D are device-verified.

---

## Open questions to confirm BEFORE Step 1 (ask the user)

1. **Guest gating** — must a student register to *take* a quiz (results are
   personal & synced), or can guests take quizzes too? (Default: register to take;
   guests see the intro + a register nudge.)
2. **Multiple correct answers** — v1 is single-correct MCQ (spec says "الإجابة
   الصحيحة", singular). Confirm single-correct is acceptable for v1.
3. **Total score & pass score** — derive total from `sum(points)` (recommended) and
   let admin set `pass_score` as absolute points? Or pass as a percentage?
4. **Retake policy** — on retake, keep `best_score` as the quiz status driver
   (recommended), and does a later lower score ever "un-pass"? (Default: once
   passed, stays passed.)
5. **Time-limit enforcement** — client countdown + server clamp on submit is
   enough for v1? (No hard server-side kick-out mid-attempt.)

---

## Build Order

```
Step 1   migration 0017  — quizzes/questions/options/attempts/answers + RLS
                            + student DEFINER RPCs (answer key stripped) + grading
Step 2   migration 0017  — admin results RPCs (summary/rows/detail, is_admin guard)
                            [same file, second section]
Step 3   regen types     — src/types/database.generated.ts (Management API/CLI)
Step 4   types.ts        — Quiz* DTOs + admin input types
Step 5   quizzes.ts      — full api layer (student + admin), USE_MOCK inert
Step 6   queryKeys + useQuizzes.ts — hooks + mutations
Step 7   section DTO     — add quizzes[] to SectionPageData + getSectionPage
Step 8   Section card    — QuizSectionCard on the student section page
Step 9   quiz intro      — app/(student)/quiz/[id].tsx
Step 10  quiz solver     — questions/nav/save/submit + confirm sheet + timer
Step 11  quiz result     — result view (respects show_result/show_correct_answers)
Step 12  admin nav+list  — AdminShell nav item + app/admin/quizzes.tsx
Step 13  admin editor    — app/admin/quiz-edit.tsx (quiz + questions + options)
Step 14  admin results   — app/admin/quiz-results.tsx + quiz-attempt.tsx
Step 15  Journey (opt)   — اختباراتك summary line
Step 16  migration 0018  — new_quiz publish fan-out (optional, after verify)
Step 17  typecheck + apply migrations + regen types + release build + install
```

---
```
```
