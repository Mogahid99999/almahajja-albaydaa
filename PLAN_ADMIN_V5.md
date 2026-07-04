# Plan: V5 — Admin Panel Enhancement (لوحة التحكم)

**Date drafted:** 2026-07-02
**Target:** Android standalone RELEASE, device R5CX10P3BPL, `USE_MOCK=false`.
Admin is reached **inside the native app** (AuthGate routes `role==='admin'` → `/admin`)
and on web. Most of this is JS + SQL + one new Edge Function — a native rebuild is
only needed to test on the device (JS is bundled into the release APK). The web
admin (`expo start --web`) is the faster dev loop.

Calm/non-competitive tone stays non-negotiable; **no public ranking of students**
(analytics are aggregate or private-to-admin, never shown student-vs-student in
the app). Arabic UI strings stay Arabic. All data-access via `src/api/*`; all
rollups/aggregates are **server-side SQL** (SECURITY DEFINER RPCs), never client
tree-walking. Append-only migrations — **0001–0021 are never edited; new ones
start at 0022.** A new enum value needs its own migration/transaction step before
it can be used (the 0015/0019 precedent).

---

## Architecture facts (already verified in code — build on these)

- **Roles:** `app_role` enum = `('student','admin')` (migration 0001). Role is read
  client-side from `auth.users.user_metadata.role` (fallback: `admin@gmail.com`→admin,
  see `roleForEmail` in `src/api/auth.ts`) **and** authoritatively from
  `profiles.role` (used by SQL). RLS admin gate is `public.is_admin()` =
  `profiles.role='admin'` (0001:129). All content writes (sections, sheikhs,
  lectures, quizzes, attachments, `lectures` storage bucket) gate on `is_admin()`.
- **profiles columns:** `id, display_name, gender, role, created_at, last_opened_at`.
  **No email/phone** (those live in `auth.users`; readable only via a DEFINER RPC
  or the service role). `last_opened_at` is stamped on every app open
  (`touch_last_opened`, 0013) → use it for "آخر دخول" / active-today.
- **Data for analytics:** `user_lecture_progress` (completed flag, position_sec),
  `daily_listening` (day, seconds_listened, lecture_ids[], meaningful),
  `quiz_attempts` (passed, score, submitted_at), `weekly_goals` (metric,target),
  `streak_for_user(uuid)` (0014), `sections`, `lectures`, `quizzes`.
- **AdminShell** (`src/components/admin/AdminShell.tsx`) is already responsive:
  fixed teal sidebar ≥900px, hamburger **drawer** <900px, single-column content.
  `NAV_ITEMS` is a hard-coded list (dashboard, lectures, upload, sections,
  sheikhs, quizzes, unclassified). Nav is **not** yet filtered by role.
- **Admin mutations that need the service role** (client can't hold it) → a NEW
  Edge Function: set another user's password (no old), ban/unban, edit another
  user's email. `notify-on-publish` is the only existing function; mirror its
  deploy path.
- **About page** (`app/(student)/about.tsx`) is fully hard-coded paragraphs — no
  data source. `app_config` (key/value, world-readable, migration 0021) already
  exists and is the natural home for editable About text + the Telegram link.

---

## Feature 1 — Responsive / consistent admin on phones

**Symptom:** the admin panel is inconsistent and overflows on a phone screen.

**Root cause:** `AdminShell` itself adapts, but individual admin screens use
web-centric layouts that don't degrade: fixed-width stat cards (`width:160`),
`position:'sticky'` right rails (`upload.tsx`), multi-column grids, and wide
tables (lectures / quiz-results) with no horizontal scroll. On a ~400px native
width these clip or push content off-screen.

**Fix — audit every `app/admin/*` screen at ≤400px width and:**
- Stat/quick cards: `flexWrap` with a `minWidth`/`flexBasis` (e.g. 2-up on phone),
  not a fixed `width`. Prefer `flex-basis: 47%` style.
- Any wide **table** (lectures, quiz-results, users) → wrap in a horizontal
  `ScrollView` (so the page body never scrolls sideways — the row 2 rule) OR
  render as stacked cards on narrow widths.
- Drop `position:'sticky'` on native (it's a web-only value; guard with
  `Platform.OS==='web'`), and let the right rail stack under the form on narrow.
- Verify the drawer, topbar, and content padding on the device with the 3-button
  nav bar visible.

**Files:** `AdminShell.tsx` (minor), `app/admin/index.tsx`, `upload.tsx`,
`lectures.tsx`, `sections.tsx`, `quizzes.tsx`, `quiz-results.tsx`,
`unclassified.tsx`, `sheikhs.tsx`. **Verify:** each screen on the device, no
horizontal body scroll, no clipped controls.

---

## Feature 2 — Dashboard (لوحة المعلومات) overview stats

Add to the dashboard, calm number tiles (no charts / no competitive framing):
- إجمالي المستخدمين · الجدد هذا الشهر · الجدد هذا الأسبوع · النشطون اليوم
- عدد الأقسام · عدد الاختبارات المنشورة
- أكثر الأقسام استماعًا (top N) · أكثر الاختبارات حلًّا (top N)
- إجمالي ساعات الاستماع · ساعات الاستماع هذا الشهر

**Approach:** one SECURITY DEFINER RPC `admin_dashboard_stats()` gated on
`is_admin()`, returning a single row (scalars) + small JSON arrays for the two
"top" lists. Definitions:
- total_users = `count(*) from profiles where role='student'` (exclude admins).
- new_users_month/week = profiles.created_at within the calendar month / rolling 7d.
- active_today = profiles with `last_opened_at::date = current_date` (local UTC+3;
  reuse the 0016 offset). *(open Q: app-open vs meaningful-listening definition.)*
- sections_count = `count(*) from sections`.
- published_quizzes = `count(*) from quizzes where status='published'`.
- listen hours = `sum(seconds_listened)/3600` from `daily_listening` (all-time /
  this-month by `day`).
- top_sections = group `daily_listening.lecture_ids` → `lectures.section_id` →
  sum seconds, top 5 (title + hours). top_quizzes = `quiz_attempts` grouped by
  quiz, top 5 by attempt count (title + count).

**Files:** migration `0024_admin_analytics.sql`, `src/api/adminStats.ts`,
`src/hooks/useAdminStats.ts`, `app/admin/index.tsx`.

---

## Feature 3 — تحليلات التقدم العلمي (progress analytics)

A new admin section (no public student-vs-student comparison). Shows:
- عدد الطلاب الذين أكملوا: أول درس / ٥ دروس / ١٠ دروس / قسمًا كاملًا.
- متوسط التقدم داخل كل قسم (per-section avg completion %).
- أكثر الأقسام إكمالًا · أكثر الأقسام التي يتوقف فيها الطلاب.
- الطلاب ذوو التقدم الجيد · الطلاب الذين بدأوا ثم توقفوا.

**Approach:** SECURITY DEFINER RPC(s) gated on `is_admin()`:
- `admin_progress_analytics()` — the aggregate scalars + per-section arrays,
  computed from `user_lecture_progress` (completed) joined to `lectures.section_id`
  and the existing subtree-rollup logic for "full section completed".
- The two student lists ("good progress" / "started then stopped") are **private
  to admin** (names visible to admin only, never surfaced to other students).
  Thresholds are an open question (propose: good = ≥5 completed AND active in 7d;
  stopped = has ≥1 in-progress lecture AND no `last_opened_at`/listening in 14d).

**Files:** `0024_admin_analytics.sql` (same migration), `src/api/adminAnalytics.ts`,
`src/hooks/useAdminAnalytics.ts`, `app/admin/analytics.tsx` (new route + nav item).

---

## Feature 4 — إدارة المستخدمين (user management)

A new admin section listing students with: الاسم · البريد/الهاتف · الجنس ·
تاريخ التسجيل · آخر دخول · الحالة (نشط/محظور/غير نشط) · الدروس المكتملة ·
الاختبارات المجتازة · المداومة الحالية · الهدف الأسبوعي. Plus a per-user detail
view (progress + quiz results). Admin actions: **إيقاف / تفعيل الحساب**،
**تعديل البيانات وكلمة السر بدون معرفة القديمة**، **عرض التقدم**، **عرض النتائج**.

**Reads (no service role needed):** DEFINER RPCs gated on `is_admin()` that join
`profiles` + `auth.users` (a DEFINER function owned by postgres may read
`auth.users`):
- `admin_user_list(p_search text, p_limit, p_offset)` → id, display_name, email,
  phone, gender, created_at, last_opened_at, `last_sign_in_at`, `banned_until`,
  completed_lectures, passed_quizzes, current_streak (`streak_for_user`),
  weekly goal. **Status derived:** banned = `banned_until > now()`; inactive = no
  activity in 30d; else active.
- `admin_user_detail(p_user_id uuid)` → progress rollup + quiz-attempt results
  for one user (reuses the student-side shapes, admin-scoped).

**Mutations (service role → NEW Edge Function `admin-users`):** the function
runs with `verify_jwt=true`, reads the caller's JWT, confirms the caller is admin
(`profiles.role='admin'`), then uses a **service-role client** for
`auth.admin.updateUserById`:
- ban → `{ ban_duration: '87600h' }`; unban → `{ ban_duration: 'none' }`.
- set password → `{ password }` (no old password required — this is the ask).
- edit email/name → `{ email, user_metadata:{ display_name } }`.
Never expose the service key client-side. `src/api/adminUsers.ts` calls the
function via `supabase.functions.invoke('admin-users', …)`.

**Files:** `0025_admin_users.sql` (read RPCs), `supabase/functions/admin-users/`
(new), `src/api/adminUsers.ts`, `src/hooks/useAdminUsers.ts`,
`app/admin/users.tsx` + `app/admin/user/[id].tsx` (new routes + nav item).

---

## Feature 5 — Publisher role (ناشر)

A limited admin: content only, **no** user data / settings. Sidebar shows only:
**المحاضرات · رفع محاضرة · الأقسام والشجرة · المشايخ · الاختبارات**. Seed a test
publisher account.

**DB (two migrations — enum value then use):**
- `0022_publisher_role.sql`: `alter type public.app_role add value if not exists 'publisher';`
- `0023_publisher_policies.sql`: add `public.is_content_manager()` =
  `role in ('admin','publisher')`; **redefine the content-table write policies**
  (sections, sheikhs, lectures, quizzes + quiz_questions/quiz_options, attachments,
  and the `lectures` storage bucket policy) from `is_admin()` → `is_content_manager()`
  via `drop policy if exists … / create policy …` (append-only: we re-create, never
  edit 0001/0002/0017). **profiles + analytics + user + config writes stay
  `is_admin()`** so publishers can't touch users/settings.

**Client:**
- `AppRole` → `'admin' | 'student' | 'publisher'` (`src/api/auth.ts`, `types.ts`).
- `AuthGate` (`app/_layout.tsx`): route `admin || publisher` → `/admin`; but a
  publisher's landing is `/admin/lectures` (no dashboard); redirect a publisher
  away from dashboard/analytics/users/settings routes.
- `AdminShell`: filter `NAV_ITEMS` by role — publisher sees only the 5 content
  items. Add the new dashboard sub-sections (analytics/users/settings) as
  admin-only nav.
- Guard each admin-only screen: if `role==='publisher'` → redirect to
  `/admin/lectures`. (RLS already blocks the data, this is UX.)

**Seed the test publisher:** create an auth user with password, set
`user_metadata.role='publisher'` and `profiles.role='publisher'` (Management API
`auth/v1/admin/users`, or a small seed script mirroring `scripts/seed-auth.mjs`).
Provide the credentials to the user.

**Files:** `0022_*.sql`, `0023_*.sql`, `src/api/auth.ts`, `src/api/types.ts`,
`app/_layout.tsx`, `AdminShell.tsx`, each admin screen guard, a seed step.

---

## Feature 6 — Editable «عن المنصة» + Telegram live link

Make the About page content editable from the admin panel, and add a paragraph
that lectures are broadcast live on the Telegram channel with a button to open it
(channel URL editable from admin).

**Approach (reuse `app_config`):** add keys `about_intro`, `about_dua`,
`about_thanks`, `about_closing` (or a single `about_body`), `telegram_intro`,
`telegram_url`, `telegram_label`. Seed them with the current hard-coded copy so
nothing changes visually until edited.
- **Read:** the student `about.tsx` reads these via a new `getAboutContent()`
  api (fallback to the current constants when a key is empty), and renders the
  Telegram button (`Linking.openURL(telegram_url)`) only when a URL is set.
- **Write:** a DEFINER `set_app_config(p_key text, p_value text)` gated on
  `is_admin()` (app_config has no write policy today — this setter is the only
  write path). New admin **Settings** screen (`app/admin/settings.tsx`) edits the
  About fields + Telegram link (+ optionally surface the V4 `min_app_version` /
  `app_download_url` here). Admin-only nav item.

**Files:** `0023_publisher_policies.sql` (add `set_app_config` + seed keys, same
migration is fine), `src/api/appContent.ts`, `src/hooks/useAboutContent.ts`,
`app/(student)/about.tsx`, `app/admin/settings.tsx` (new).

---

## Open questions to confirm BEFORE starting (AskUserQuestion)

1. **Account status model** — derive status from `banned_until` + inactivity
   (recommended, no schema churn) vs a stored `profiles.status` column? And is
   "غير نشط" = no app-open in 30 days (confirm the window)?
2. **"Active today" + "good/stopped" thresholds** — active = app-open today
   (recommended) vs meaningful listening today? good-progress / started-stopped
   cutoffs (propose ≥5 completed & active ≤7d / in-progress & idle ≥14d)?
3. **Password edit** — admin sets a new password directly via the service role
   (the literal ask, recommended) vs sends the student a reset link? Any other
   fields admin may edit (email, name — and may they **change roles**, e.g.
   promote a student to publisher, from the panel)?
4. **Publisher scope** — the 5 listed items only, or also **المحاضرات الواردة**
   (unclassified queue — it's content, publishers would classify incoming)?
5. **About editing shape** — a few fixed editable fields (intro / du'a / thanks /
   closing / telegram — recommended, keeps the current design) vs a single
   free-text body? And is the Telegram URL the only new outward link?

---

## Build order

```
Step 0   Confirm the open questions (AskUserQuestion).
Step 1   DB 0022: add 'publisher' enum value → apply live (own transaction).
Step 2   DB 0023: is_content_manager() + redefine content write policies +
             set_app_config() + seed about/telegram app_config keys → apply live.
Step 3   DB 0024: admin_dashboard_stats() + admin_progress_analytics() → apply live.
Step 4   DB 0025: admin_user_list() + admin_user_detail() → apply live;
             regen src/types/database.generated.ts.
Step 5   Edge Function admin-users (ban/unban/set-password/edit) → deploy
             (verify_jwt=true; caller-is-admin check inside).
Step 6   Seed the test publisher account → hand creds to the user.
Step 7   Client roles: AppRole + AuthGate routing + AdminShell nav filter + guards.
Step 8   Dashboard stats tiles (Feature 2).
Step 9   Analytics screen (Feature 3).
Step 10  Users list + detail + actions wired to the Edge Function (Feature 4).
Step 11  Settings screen + editable About + Telegram button (Feature 6).
Step 12  Responsive audit pass across every admin screen (Feature 1).
Step 13  typecheck → release build → install on R5CX10P3BPL (test admin + publisher).
Step 14  Device-verify each area; note anything needing extra accounts.
```

**Verification note:** the publisher gate, analytics, and user actions are best
tested with (a) the seeded publisher account and (b) at least one real student
account with progress + quiz attempts. Ban/unban and set-password should be
verified end-to-end (sign in as the affected student afterward).
