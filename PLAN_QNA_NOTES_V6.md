# Plan: V6 — أسئلة وأجوبة (Q&A) · ملاحظاتي (private notes) · فوائد الدارسين (anonymous benefits)

**Date drafted:** 2026-07-03
**Target:** Android standalone RELEASE, device R5CX10P3BPL, `USE_MOCK=false`.
Mostly JS + SQL + one Edge-Function tweak. A native rebuild is only needed to
test on the device (JS is bundled into the release APK).

**This plan is fully decided — the implementing agent must NOT ask the user
questions.** Every choice below is locked to the best-recommended option; proceed
autonomously. Keep the calm, non-competitive Islamic tone; **no public ranking**;
Arabic UI strings stay Arabic. All data-access via `src/api/*`; all
rollups/reads that cross users are **server-side SECURITY DEFINER RPCs**.
Append-only migrations — **0001–0026 are never edited; new ones start at 0027.**
New enum values need their own migration/transaction step before use (the
0015/0019/0022 precedent). Good UI/UX is a first-class requirement.

---

## Architecture facts (verified in code — build on these)

- **Roles:** `app_role` = `('student','admin','publisher')`. Add **`'sheikh'`**.
  Role read client-side from `auth.users.user_metadata.role` + authoritatively
  from `profiles.role`. RLS gate helpers live in SQL: `public.is_admin()`
  (role='admin'), `public.is_content_manager()` (admin|publisher, from 0023).
- **`admin-users` Edge Function** already supports `createUser` (with role) and
  `setRole`, with `VALID_ROLES = ["student","publisher","admin"]`. Add `"sheikh"`
  there + redeploy → admin can provision a sheikh account and the seed can too.
- **`sheikhs` table = metadata only** (id, name; `lectures.sheikh_id` → it, ON
  DELETE SET NULL). It is NOT a login. A sheikh **user** (auth account, role
  sheikh) is separate; we add a nullable `sheikhs.user_id` link so a metadata
  sheikh can be tied to a login (used for display, not required for routing).
- **notification_type** enum currently ends at `buddy_request`; the fan-out
  pipeline is: INSERT `public.notifications` → 0009 webhook →
  `notify-on-publish` → Expo Push. Reuse it — new types just need enum values +
  rows. `src/components/notifications/labels.ts` maps type → label/desc/icon.
  Deep-links resolve in `app/_layout.tsx` (`data.route` / `lectureId` / etc.).
- **Home** (`app/(student)/index.tsx`) is a vertical stack of calm cards
  (Continue, NewlyAdded, Streak, Buddy, Sections, Journey, Dua) — the natural
  place for a "ساحة الأسئلة" entry card.
- **Player** (`app/player/[id].tsx`) is a fixed (non-scroll) modal; its top-bar
  `more-vertical` overflow button is currently a **no-op** — repurpose it, and/or
  add a compact "أدوات الدرس" chip row above the utility bar.
- **Notes/sheets pattern:** existing slide-up `Modal` sheets (see
  `buddy-search.tsx`) are the reuse pattern for editors.

---

## Locked decisions (the "don't ask" contract)

1. **Anonymity = hidden from everyone except platform admin.** A question asked
   "بإخفاء الاسم", and every "فائدة", never shows the author to the public **or**
   to the sheikh. Only `is_admin()` can resolve the author (for moderation/ban).
2. **Question audience** = `public` (appears in the public Q&A list once
   answered) or `sheikh` (private: only asker + sheikh + admin ever see it).
3. **Public Q&A list shows ANSWERED public questions** (Q + A). A user always
   sees **their own** questions in any state ("سؤالك قيد المراجعة").
4. **Sheikh routing = all sheikh-role users see all questions** (grouped by
   عامة / الدروس, filterable بانتظار الرد / تمت الإجابة). New-question push goes
   to every sheikh user. (Per-lecture routing via `sheikhs.user_id` is a future
   refinement, not now.)
5. **Answering is the sheikh's job; deletion is sheikh OR admin.** Admins get a
   moderation surface (delete questions, hide/delete benefits, ban authors) but
   don't answer.
6. **Notes are strictly private** (own-RLS), one editable note per (user,
   lecture), autosaved.
7. **"فوائد الدارسين"** are visible to all **without any name**; the author may
   delete their **own**; admin may hide/delete **any** + ban the author (reuse
   `admin-users` ban).
8. **Guests** may read everything; **posting** a question / benefit / note
   requires a registered account (same calm register-nudge used for quizzes).
9. **Notifications:** sheikh ← new question (`question_received`); asker ← answer
   (`question_answered`). Both ride the existing push pipeline + inbox.

---

## Feature A — أسئلة وأجوبة (Q&A) + sheikh role + sheikh interface

### A.1 Data (migrations 0027 enums → 0028 schema)
- **0027_qna_enums.sql:** `alter type app_role add value 'sheikh'`;
  `alter type notification_type add value 'question_received'`;
  `add value 'question_answered'`. (Own transaction — used from 0028.)
- **0028_questions.sql:**
  - `sheikhs` gets `user_id uuid null references auth.users on delete set null`.
  - `public.questions`:
    `id, scope text check in ('general','lecture'), lecture_id uuid null
     references lectures on delete cascade, asker_id uuid references auth.users,
     is_anonymous bool default false, audience text check in ('public','sheikh')
     default 'public', body text not null, status text check in
     ('pending','answered','hidden') default 'pending', answer_body text null,
     answered_by uuid null references auth.users, answered_at timestamptz null,
     created_at timestamptz default now()`. Indexes on (scope,status,created_at),
     (lecture_id,status), (asker_id).
  - Helpers: `is_sheikh()` (role='sheikh'), `is_moderator()` (sheikh|admin).
  - RLS: enable; `insert` with check `asker_id = auth.uid()`; `select` using
    `asker_id = auth.uid() or is_moderator()` (public reads go through the RPC
    below, not raw table select); no direct update/delete (RPCs only).
  - **DEFINER RPCs** (all `set search_path=public`):
    - `ask_question(p_scope, p_lecture_id, p_is_anonymous, p_audience, p_body)`
      → validates, inserts (asker=auth.uid), then inserts a `notifications` row
      `question_received` for **every** sheikh-role user (best-effort, swallowed),
      `data.route='/sheikh'`.
    - `answer_question(p_question_id, p_answer_body)` → `is_moderator()` only;
      sets answer + `status='answered'` + answered_by/at; inserts a
      `question_answered` notification to the asker, `data` deep-linking to the
      relevant Q&A screen (general → `/(student)/questions`; lesson →
      `/(student)/lecture-questions/{lecture_id}`).
    - `delete_question(p_question_id)` → `is_moderator()`; hard-delete (or set
      `status='hidden'` — use delete; it's the ask).
    - Reads: `get_public_questions(p_scope, p_lecture_id)` → answered public
      questions with `asker_display` = null when anonymous else display_name;
      `get_my_questions(p_scope, p_lecture_id)` → the caller's own (any status);
      `get_question_inbox(p_scope, p_status)` → `is_moderator()`; all matching
      questions incl. asker_display (admins get the real name even if anonymous;
      sheikh sees "سائل" when anonymous — enforce in the RPC).
  - Grants to `authenticated`; revoke from `anon`.

### A.2 Sheikh account
- Add `"sheikh"` to `VALID_ROLES` in `supabase/functions/admin-users/index.ts`;
  redeploy. Admin's **"إضافة حساب شيخ"** (on `/admin/sheikhs`) calls
  `admin-users` `createUser` with `role:'sheikh'`, and optionally links the new
  user to a `sheikhs` metadata row (set `sheikhs.user_id`) or creates one.
- **Seed ONE sheikh account** (email + password + role sheikh + profiles.role +
  a `sheikhs` row) and hand the credentials to the user (mirror how
  `publisher@gmail.com` was seeded).

### A.3 Sheikh interface (`app/sheikh/`)
- `AuthGate` (`app/_layout.tsx`): route `role==='sheikh'` → `/sheikh` (and keep
  sheikhs out of `/admin` and the student tabs). Web: allow a real sheikh login
  to reach `/sheikh` too.
- `app/sheikh/index.tsx` — a clean, calm **inbox**: segmented filter (عامة /
  الدروس) × (بانتظار الرد / تمت الإجابة), question cards (body, lecture chip when
  lesson-scoped, "سائل" when anonymous, audience badge عام/للشيخ), an inline
  **answer composer**, and a delete action. Uses `get_question_inbox`,
  `answer_question`, `delete_question`. Reuse a light shell (a `SheikhShell` or a
  role-aware AdminShell) — keep it visually distinct but on-brand.

### A.4 Student-facing Q&A
- **General:** Home card "ساحة الأسئلة" → `app/(student)/questions.tsx`: the
  public answered general questions (Q + A, asker name or "سائل"), a compose
  entry (body + toggle إخفاء الاسم + segmented عام/للشيخ فقط) gated on registration,
  and a "أسئلتي" filter for the caller's own. `get_public_questions('general')`
  + `get_my_questions` + `ask_question`.
- **Lesson:** on the player, an **"أسئلة الدرس"** tool (see UX below) →
  `app/(student)/lecture-questions/[id].tsx`: same as general but scoped to the
  lecture (`scope='lecture', lecture_id`).

### A.5 Client wiring
- `AppRole` += `'sheikh'` (`src/api/auth.ts`); `NotificationType` +=
  `'question_received' | 'question_answered'` (+ `NOTIFICATION_TYPES`,
  `defaultNotificationEnabled`, and `labels.ts` label/desc/icon/order).
- `app/_layout.tsx` deep-link handler: `question_received` → `/sheikh`;
  `question_answered` → carried `route`.
- `src/api/questions.ts` + `src/hooks/useQuestions.ts`; `queryKeys` additions.

---

## Feature B — ملاحظاتي (private per-lesson notes)

- **0029_lecture_notes.sql:** `public.lecture_notes (user_id uuid references
  auth.users on delete cascade, lecture_id uuid references lectures on delete
  cascade, body text not null default '', updated_at timestamptz default now(),
  primary key (user_id, lecture_id))`. RLS: `for all using/with check
  (user_id = auth.uid())` — strictly private. Grant to authenticated.
- **API:** `src/api/notes.ts` — `getMyNote(lectureId)`,
  `saveMyNote(lectureId, body)` (upsert on the PK). Hook `useLectureNote`.
- **UX:** a player tool **"ملاحظاتي"** → a slide-up editor sheet (or
  `app/(student)/lecture-note/[id].tsx`) with a multiline TextInput, **debounced
  autosave** + a "تُحفظ تلقائيًا · خاصة بك" hint. Registered-only (guests see the
  register nudge). A subtle "•" dot on the tool when a note exists.

---

## Feature C — فوائد الدارسين (anonymous shared benefits per lesson)

- **0030_lecture_benefits.sql:** `public.lecture_benefits (id uuid pk, lecture_id
  uuid references lectures on delete cascade, user_id uuid references auth.users
  on delete cascade, body text not null, status text check in
  ('visible','hidden') default 'visible', created_at timestamptz default now())`.
  Indexes (lecture_id,status,created_at).
  - RLS: `insert` with check `user_id=auth.uid()`; `select` own or moderator;
    `delete` own or moderator. **Public list via a DEFINER RPC that never
    returns `user_id`.**
  - RPCs: `get_lecture_benefits(p_lecture_id)` → `id, body, created_at, is_mine
    bool` (NO author identity); `add_lecture_benefit(p_lecture_id, p_body)`;
    `delete_own_benefit(p_id)`; admin moderation
    `admin_list_benefits(p_lecture_id)` (`is_admin()`) → body + author
    display_name/email + status; `admin_set_benefit_status(p_id, p_status)`.
- **UX (student):** a player tool **"فوائد الدارسين"** (icon e.g. `award` /
  `feather`) → `app/(student)/lecture-benefits/[id].tsx`: a calm list of
  benefit cards (**no names**, quiet timestamp, delete-mine on own ones) + a
  compose box "شارك فائدة استفدتها من الدرس" (registered-only). Emphasize it's
  anonymous: "تُنشر دون اسمك".
- **Moderation (admin):** a new admin screen `app/admin/contributions.tsx` (nav
  item, admin-only) with tabs **فوائد الدارسين** + **الأسئلة**: recent items with
  the resolved author, and actions إخفاء / حذف / حظر الكاتب (ban via the existing
  `admin-users` function). Also reachable inline.

---

## Lesson tools UX (where A-lesson / B / C attach to the player)

The player modal is fixed. Add a compact **"أدوات الدرس"** chip row (3 pills)
just above `PlayerUtilityBar` (respect the V4 safe-area inset), each opening a
full screen (roomy for reading/writing), not a cramped sheet:
`ملاحظاتي` (lock/edit icon) · `فوائد الدارسين` (award icon) · `أسئلة الدرس`
(help-circle icon). Alternatively wire the existing top-bar `more-vertical`
overflow to the same three. Keep it calm and uncluttered — icons + short labels,
brass-on-teal, consistent with the utility bar. Each screen uses `SectionNavBar`
+ `Screen` for a normal scrollable surface.

---

## Build order

```
Step 0   (No AskUserQuestion — decisions are locked above.)
Step 1   DB 0027: enums (app_role 'sheikh'; notif 'question_received','question_answered') → apply live.
Step 2   DB 0028: questions (sheikhs.user_id, table, helpers, RLS, RPCs + notifs) → apply live.
Step 3   DB 0029: lecture_notes (table, RLS, upsert) → apply live.
Step 4   DB 0030: lecture_benefits (table, RLS, public + admin RPCs) → apply live; regen types.
Step 5   Edge Function: add 'sheikh' to admin-users VALID_ROLES → redeploy.
Step 6   Seed one sheikh account → hand creds to the user.
Step 7   Client roles/notifs: AppRole + NotificationType + labels + AuthGate('/sheikh') + deep-links.
Step 8   API + hooks: questions.ts, notes.ts, benefits.ts (+ queryKeys).
Step 9   Sheikh inbox (app/sheikh) — answer + delete.
Step 10  Student Q&A: Home "ساحة الأسئلة" card + general screen + lesson-questions screen.
Step 11  Player "أدوات الدرس" chip row → note editor + benefits screen + lesson-questions.
Step 12  Admin: "إضافة حساب شيخ" on /admin/sheikhs + moderation screen (contributions).
Step 13  typecheck → release build → install on R5CX10P3BPL.
Step 14  Device-verify each flow end-to-end (student asks → sheikh answers → asker notified;
             note autosave; benefit posts anonymously; admin moderation + ban).
```

**Verification note:** full Q&A + notifications need (a) the seeded sheikh
account and (b) a registered student account — verify: ask (public + sheikh-only,
named + anonymous) → sheikh inbox receives + push → answer → asker push + it
appears in the public list (name hidden when anonymous) → admin can delete +
sees the real author. Notes: type → leave → return → persists, private. Benefits:
post → shows with no name → author deletes own → admin sees author + hides + bans.
