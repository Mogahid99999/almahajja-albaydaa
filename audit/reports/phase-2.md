# Phase 2 — Backend: schema, RLS, RPCs, Edge Functions, storage

**Branch:** `audit/phase-2-backend` (from `audit/phase-0-baseline`).
**Method:** static analysis only. **All live verification is BLOCKED (F-002 —
no staging Supabase project; `.env` and `supabase/config` point at production
`prpyxnxgkpspjoxvcaro`).** No query, migration, RPC, edge-function invocation, or
CLI command was run against any project. Checked for a staging env first:
`.env.staging` absent, no `supabase/config.toml`, no `.env.*` besides
`.env`/`.env.example`, `.env` URL = production — so static-only, per the hard rule.

Companion: `audit/reports/rls-matrix.md` (full table matrix + DEFINER verdicts).

---

## Task 1 — RLS policy matrix
Done — see `rls-matrix.md`. Every `public` table replayed 0001→0087 to its final
effective policy, with defining migration cited. Key results: all personal tables
(progress, notes, notifications, quiz attempts, journey, daily_listening) are
own-rows-only — **a student cannot read another's**. Guests can write own-row
personal data but are blocked from account-gated content. `blocked_words` and
`question_answers` are intentionally RLS-on/policy-less (DEFINER-only access). No
table found RLS-disabled or enabled-but-unpoliciied by accident.

## Task 2 — SECURITY DEFINER audit
Every DEFINER function reviewed; verdict table in `rls-matrix.md`. Highlights:
- **Gender enforcement in `search_buddy_candidates`:** server-side, correct — but
  0082 had silently dropped the anonymous-account exclusion and the send/respond
  guest guards (regression from 0041). **F-201, fixed in migration 0088.**
- **Q&A anonymity:** solid end-to-end. `get_public_questions` returns null asker
  when anonymous; `get_question_inbox` returns `'سائل'` even to admins (0077),
  ships `asker_id` only to admins. `get_lecture_benefits` never selects `user_id`.
- **`submit_rating`:** bounded by `unique(user_id)` upsert — no abuse vector.
- **`report_content` / `submit_feedback`:** **no guest rate-limit** (F-204).
- **`set_own_profile`:** cannot escalate role (never touches the role column). ✅
- **`buddy_of`/`buddies_of`/`buddy_count`:** DEFINER over an arbitrary uid — returns
  any user's buddy UUIDs/count (F-207, low: opaque UUIDs, no PII).

## Task 3 — Edge functions
- **`admin-users`:** ✅ verifies caller JWT (gateway `verify_jwt`), then re-confirms
  `profiles.role='admin'` with the service role before any mutation; anti-lockout on
  ban/delete/setRole for self. Solid. Minor: `createUser`/`setPassword` accept 6-char
  passwords while Supabase min-length is 8 (F-203, P3, cosmetic/UX).
- **`delete-account`:** ✅ deletes only the caller's own `auth.users` row; relies on
  `on delete cascade`. **Cascade completeness enumerated** — every user-owned table
  references `auth.users(id) on delete cascade`: profiles, user_lecture_progress,
  section_follows, push_tokens, notification_prefs, notifications, daily_listening,
  weekly_goals, user_badges, weekly_goal_state, streak_recovery_state, buddy_requests
  (both FKs), quiz_attempts, quiz_attempt_answers (via attempts), lecture_notes,
  lecture_benefits, questions (asker_id), broadcast_views, app_ratings. Authored public
  content uses `on delete set null` (questions.answered_by, question_answers.answered_by,
  content_reports.reporter_id, feedback.user_id/resolved_by, broadcasts.created_by,
  featured_lectures.added_by, sheikhs.user_id) — deliberate (keeps public content, drops
  identity). **No user-owned table is missed by the wipe.** Gap: **R2 objects are NOT
  deleted** on account deletion — but users don't own R2 objects (only staff upload
  lectures/attachments/broadcasts; voice answers belong to sheikhs), so no orphaned
  personal data. Noted, not a finding.
- **`r2-upload-url`:** ✅ `is_content_manager` for lecture/attachment/broadcast,
  `is_moderator` for answer. Content-type allow-list re-checked (R2 has no bucket MIME
  enforcement). **Path traversal:** keys are server-constructed; `sanitize()` strips
  `/ \ : * ? " < > |` and caps length — user input never forms the prefix. ✅ TTL 600s.
- **`r2-read-url`:** ✅ delegates to `can_read_storage_object` SQL — single source of
  truth. TTL 3600s. Inherits F-205 (lecture read gated on published-only, not gender).
- **`r2-delete`:** ✅ `is_content_manager`; key is opaque, delete is idempotent.
- **`notify-on-publish`:** worker fired by the DB webhook. **Not admin-gated** — but
  it only reads `push_tokens` for the `row.user_id` in the payload and POSTs to Expo;
  it performs no privileged mutation a caller could weaponize beyond sending a push to
  an arbitrary already-registered device (the webhook auth is the project anon key,
  F-210 context). Reviewed: no data-leak path. The Resend email leg is best-effort and
  de-duped to the first admin.

## Task 4 — Blocked-word filter & flooding
- **`contains_blocked_word` (0052/0053):** strips tashkeel (U+064B–U+0655), superscript
  alef, tatweel; whole-word `~*` match. **Bypasses (F-206, P2):** (a) **zero-width chars**
  (U+200C/U+200D/U+FEFF) inside a word are not stripped → `ك‌س` passes; (b) **letter-variant
  swaps** rely on hand-seeded spelling rows — any unseeded variant (e.g. Latin-lookalike
  `к`, digit-for-letter) passes; (c) whole-word anchoring means a blocked word glued to
  punctuation/emoji may not match `\m…\M`. Content is still moderatable after the fact
  (reports + hide/delete), so P2 not P1. The list is admin-uneditable (migration-only) —
  documented limitation.
- **Guest-writable flooding (F-204, P2):** `report_content`, `submit_feedback`, and
  `submit_rating` are all callable by guests (anon session). `submit_rating` is bounded
  (`unique(user_id)`). `report_content` dedups **only for identified reporters**
  (`v_me is not null`) — an anonymous session has a stable `auth.uid()` too, actually, so
  the dedup DOES apply to guests; the real gap is a guest can churn *new* anon sessions.
  `submit_feedback` has **no dedup at all** → a script can flood the admin inbox +
  fan-out a `feedback_received` notification to every admin per call. No rate limit
  anywhere. Recommend a per-user/day cap or a lightweight throttle table.

## Task 5 — Recursive rollup RPCs
- **Correctness:** `get_section_rollup` / `get_children_rollups` use `WITH RECURSIVE`
  descending from the target; published-only join; progress left-joined on `auth.uid()`.
  Draft filtering correct for students (join predicate `l.status='published'`).
  `admin_progress_analytics` rolls each root over its whole subtree correctly.
- **Orphaned nodes:** a lecture with `section_id = null` (unclassified) is simply not in
  any subtree → excluded from rollups. Correct.
- **Cycles (F-212, P3):** no `CYCLE` clause / depth cap on any of the 6 recursive CTEs.
  A malformed `sections.parent_id` cycle (creatable by any content manager via a plain
  `UPDATE`, which has no cycle guard — only `admin_reorder_sections` guards single-parent)
  would make these RPCs loop/error. Add `CYCLE` clauses or a `parent_id`-change guard.
- **Gender count leak (F-208, P2):** `get_section_rollup`/`get_children_rollups` count
  lectures across the *raw* subtree with no `section_visible_to_viewer` filter, so the
  "X دروس" header/badge on a parent section can include lectures from a gender-hidden
  child subtree — a count-only leak (titles/audio stay hidden). 0049 explicitly left
  these two functions out of the gender pass.
- **`EXPLAIN ANALYZE` on realistic volume: BLOCKED (F-002).** F-022 (`search_buddy_candidates`
  computing a per-candidate streak) remains unprofiled — see checklist.

## Task 6 — Migration hygiene (static)
- Numbering `0001`–`0087` contiguous, no gaps/dupes. Confirmed all 87 files present.
- **Enum-value-then-use split** correctly observed everywhere (0008/0012/0015/0019/0022/
  0027/0033/0050/0060 add a value in their own migration; first use is the next file) —
  matches Postgres' "can't use a new enum label in the same tx" rule. **A single-transaction
  replay per file is required**; a whole-chain single-transaction replay would fail on the
  enum adds (documented in each header).
- **`create-or-replace` return-type changes** correctly `drop function` first where the
  OUT columns/args changed (0056/0059/0064/0070/0074/0075/0077/0078/0084 etc.), and
  re-assert 0039 EXECUTE hygiene after each drop (Postgres resets grants to PUBLIC on
  drop+create — several migrations call this out and fix it).
- **IF EXISTS / IF NOT EXISTS discipline:** consistent on tables, columns, indexes,
  policies (drop-if-exists before create), enum adds (`add value if not exists`).
- **Forward references:** none found — no migration references an object created in a
  later file (the notify fan-out deferred in 0003 is created in 0006, both earlier-than-use).
- **F-015 risk:** the CLI `schema_migrations` table only records 0001–0006 (0007–0087
  applied via Management API), so `supabase db push` and a clean empty-DB replay are
  **unverified — BLOCKED (F-002).** Static replay reads clean; live replay is the staging
  checklist's headline item.
- **Live replay on empty DB: BLOCKED (F-002).**

## Task 7 — `scripts/security-check.mjs` audit
- **Connects to:** `EXPO_PUBLIC_SUPABASE_URL` from `.env` = **production**. It **creates
  and deletes real users, a real draft lecture, and a real notification row** via the
  service key. **NOT RUN** (hard rule — it would mutate production). Must only ever run
  against staging.
- **What it checks (good):** anon has no access (4 cases); student sees only published +
  cannot read B's progress/notes/notifications/quiz-attempts; admin RPCs reject students;
  student cannot write sections/lectures or read draft audio; guest blocked from
  quiz/question/benefit/**buddy**. The buddy case (`send_buddy_request` guest-rejected)
  is exactly what would have caught F-201 — but it's never run because there's no staging.
- **What it misses:** (a) does not cover `submit_feedback`/`report_content`/`submit_rating`
  guest paths; (b) no cross-gender leak checks (would catch F-202/F-205/F-208); (c) no
  publisher/sheikh role-boundary cases (e.g. publisher must not reach `admin_user_list`,
  sheikh must not see benefit emails); (d) no anonymity-at-the-wire check on
  `get_question_inbox`/`get_public_questions`; (e) tears down by user-id only — a crash
  before teardown leaves fixtures (it does call teardown in `.catch`). Recommend adding
  these once staging exists.

## Task 8 — `database.generated.ts` drift
- **Regeneration BLOCKED (F-002)** (needs a live project). Instead cross-checked the
  committed `src/types/database.generated.ts` against the final migration schema and
  every `supabase.rpc(...)` call in `src/api/*`.
- **Result: no drift found.** All 33 tables present incl. `question_answers` (0086);
  all RPCs called from `src/api` exist in the generated `Functions` block with matching
  signatures — spot-checked `cancel_buddy` (overloaded no-arg + `p_buddy_id`),
  `save_activity`, `get_streak_status`, `submit_rating`, `submit_feedback`,
  `lecture_visible_to_viewer`, `update_own_question`, `set_own_profile` (3-arg with
  `p_oath_accepted`), `answer_question` (3-arg with `p_answer_audio_path`),
  `get_public_questions` (returns `answer_audio_path`), `admin_user_list` (5-arg +
  `is_anonymous`/`total_count`). **`npm run typecheck` passes clean** on the committed
  types. No finding.

---

## Findings logged (this phase)
| ID | Sev | Summary | Status |
|---|---|---|---|
| F-201 | **P1** | 0082 dropped the guest/anonymous guards on buddy send/respond/search (regressed 0041 S3) — a guest can join buddy pairs | **fixed** (0088) |
| F-202 | **P1** | `get_featured_lectures` (→ Home مختارات rail) not gender-filtered — leaks رجال/نساء-only lectures + their audio key across gender | **fixed** (0089) |
| F-204 | P2 | No rate-limit on guest-writable `submit_feedback` (and churned-session `report_content`) — admin-inbox flooding + per-call notification fan-out | open |
| F-205 | P2 | `can_read_storage_object` gates lecture audio on published-only, not gender — a leaked/guessed key of a gender-restricted lecture is served to the other gender | open |
| F-206 | P2 | `contains_blocked_word` bypassable via zero-width chars / unseeded letter-variants / word-boundary gluing | open |
| F-208 | P2 | `get_section_rollup`/`get_children_rollups` count lectures over the raw subtree with no gender filter — count-only leak in section headers | open |
| F-203 | P3 | `admin-users` accepts 6-char passwords vs Supabase 8-char min — opaque failure | open |
| F-207 | P3 | `buddy_of`/`buddies_of`/`buddy_count` DEFINER over arbitrary uid — buddy-graph UUID enumeration (no PII) | open |
| F-209 | P3 | `web_prefix_tsquery` (0068) missing `set search_path` (only INVOKER function lacking it; advisor parity with F-042/0042) | open |
| F-210 | P3 | Notification-push webhook (0009) hardcodes the anon JWT in SQL + `notify-on-publish` isn't role-gated — a caller can push to an arbitrary registered device (no data leak, no fan-out control) | open |
| F-211 | P2 | `scripts/security-check.mjs` runs against **production** (`.env` URL) and mutates it (creates/deletes users+lecture) — must be staging-only; cannot run today (F-002) | open |
| F-212 | P3 | No `CYCLE` clause / depth cap on the 6 recursive section CTEs, and no cycle guard on generic `sections.parent_id` UPDATE — a content-manager-created cycle spins/errors the rollup RPCs | open |

## New migrations created
- `0088_restore_buddy_anonymous_guard.sql` — F-201. Reproduces 0082's current
  send/respond/search bodies verbatim + re-adds the 0041 `is_anonymous` guards and the
  anonymous-account exclusion. Re-asserts 0039 EXECUTE hygiene.
- `0089_featured_lectures_gender_scope.sql` — F-202. Reproduces 0069's
  `get_featured_lectures` body + adds the `section_visible_to_viewer` predicate the other
  browse RPCs use (content-manager bypass + unclassified passthrough preserved).

Both are static-safe (create-or-replace, no schema change). **`security-check.mjs` after a
migration is REQUIRED by CLAUDE.md but BLOCKED (F-002/F-211)** — must be run against staging
once it exists.

---

## BLOCKED-on-staging checklist (execute once a staging project with 0001–0089 exists)
1. **Migration replay:** apply 0001–0089 to an empty staging DB, file-by-file (per-file
   single tx — the enum-add files must land before their first-use file). Confirms F-015
   and Task 6.
2. **Backfill `schema_migrations`** so `supabase db push` becomes usable (F-015).
3. **Run `scripts/security-check.mjs`** against staging (never production) — expect all
   checks green; confirms Task 1/2 statics and that 0088 restored the buddy guest guard.
4. **Verify F-201 fix live:** guest session → `send_buddy_request`/`respond_buddy_request`
   raise; guest does not appear in `search_buddy_candidates`.
5. **Verify F-202 fix live:** female-gender student's Home `get_home_page().featured` and
   `get_featured_lectures()` exclude a رجال-only curated lecture; then confirm
   `can_read_storage_object` still serves it to the right gender (and note F-205 is a
   separate gap on direct-key reads).
6. **Reproduce F-205:** as a female student, call `r2-read-url` with the R2 key of a
   رجال-only published lecture → currently returns a signed URL. Decide fix
   (add gender to `can_read_storage_object`) vs accept.
7. **Reproduce F-208:** create a parent with a نساء-only child holding lectures; confirm
   the parent's rollup count differs by gender viewer.
8. **F-206 bypass corpus:** run the blocked-word list against zero-width-injected and
   variant-spelled inputs to size the gap.
9. **F-204 flooding:** hammer `submit_feedback` from one guest session; confirm no cap and
   N admin notifications.
10. **`EXPLAIN ANALYZE`** on realistic volume: `search_buddy_candidates` (F-022),
    `get_home_page`, `get_section_page`, `search_content`, `admin_progress_analytics`.
11. **Regenerate `database.generated.ts`** from staging and diff against committed (Task 8
    confirmation).
12. **Cascade wipe live-check:** delete a staging user via `delete-account`; confirm every
    user-owned table row is gone and public content is anonymized (set null).
13. **F-016 audio-format inventory:** query `lectures.audio_path` extensions for any `.ogg`
    (silent on iOS).
