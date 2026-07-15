# Phase 2 — RLS Policy Matrix & SECURITY DEFINER verdicts

Derived by replaying all 87 migrations (`0001`–`0087`) in order and recording the
**final effective** policy per table. Live verification against the DB is
**BLOCKED (F-002 — no staging; `.env` points at production `prpyxnxgkpspjoxvcaro`)**;
everything below is static analysis of the migration source.

## Roles
- **anon** — no session at all (the PostgREST `anon` role). After `0039` every
  `public` function has EXECUTE revoked from `anon`/`public`; every table policy is
  `to authenticated`, so anon has **no table access and no RPC access**.
- **guest** — anonymous Supabase session (`auth.jwt()->>'is_anonymous' = true`).
  Holds the **`authenticated`** role, so all `authenticated` policies apply; extra
  server-side guards block guests from account-gated writes (quizzes, questions,
  benefits, notes, buddy).
- **student / publisher / sheikh / admin** — registered, `profiles.role` value.
  Role is resolved by the SECURITY DEFINER helpers `is_admin()`,
  `is_content_manager()` (admin+publisher), `is_moderator()` (admin+sheikh),
  `is_staff_viewer()` (admin+sheikh).

Legend: ✔ allowed · �“own” = only rows where `user_id/asker_id = auth.uid()` ·
✘ denied (no permissive policy) · **RPC** = table blocked directly, mutated only
through a SECURITY DEFINER function.

## Table matrix (final effective policies)

| Table | anon | guest | student | publisher | sheikh | admin | Defining migration(s) |
|---|---|---|---|---|---|---|---|
| profiles | ✘ | S own / U via RPC | **S** own · **U** only via `set_own_profile` (name/gender/oath); no direct update policy | same | same | S/I/U/D all | 0001; 0013/0015/0056 setter |
| sections | ✘ | S (gender-filtered via RPCs) | S ✔ · IUD ✘ | S+IUD ✔ | S ✔ · IUD ✘ | S+IUD ✔ | 0001; write→`is_content_manager` 0023 |
| sheikhs | ✘ | S ✔ | S ✔ · IUD ✘ | S+IUD ✔ | S ✔ | S+IUD ✔ | 0001; write 0023; bio 0054 |
| lectures | ✘ | S published only | S published only | S+IUD (drafts too) | S published only | S+IUD | 0001; select+write→`is_content_manager` 0023 |
| user_lecture_progress | ✘ | SIUD own | SIUD own | own | own | own | 0001 (`progress_own` FOR ALL) |
| attachments | ✘ | S (section: any; lecture: published) | same | S+IUD | S | S+IUD | 0002; write 0023 |
| section_follows | ✘ | SIUD own | own | own | own | own | 0003 (feature since dropped; table unused) |
| push_tokens | ✘ | SIUD own | own | own | own | own | 0003 |
| notification_prefs | ✘ | SIUD own | own | own | own | own | 0003 |
| notifications | ✘ | SIUD **own** (incl. self-INSERT → self-push, see F-210) | own | own | own | own | 0003 |
| daily_listening | ✘ | SIUD own | own | own | own | own | 0004 |
| weekly_goals | ✘ | SIUD own | own | own | own | own | 0004 |
| user_badges | ✘ | SIUD own | own | own | own | own | 0004 |
| weekly_goal_state | ✘ | SIU own | own | own | own | own | 0013 |
| streak_recovery_state | ✘ | SIU own | own | own | own | own | 0014 |
| buddy_requests | ✘ | S own-pair · I (from=me) · U (receiver, or sender-while-pending) — guest **blocked** at RPC layer (0041, restored 0088) | same | same | same | same | 0015; guards 0041/0088 |
| quizzes | ✘ | S published | S published | S+IUD (drafts) | S+IUD (drafts, 0081) | S+IUD | 0017; 0023; staff 0081 |
| quiz_questions | ✘ | ✘ (RPC only) | ✘ | IUD (staff) | IUD (staff) | IUD | 0017; 0023; 0081 |
| quiz_options | ✘ | ✘ (`is_correct` never reaches students) | ✘ | IUD (staff) | IUD | IUD | 0017; 0081 |
| quiz_attempts | ✘ | S own · write RPC-only | S own | S own | S own+staff | S own+staff | 0017; staff-select 0081 |
| quiz_attempt_answers | ✘ | S own · write RPC-only | own | own | own+staff | own+staff | 0017; 0081 |
| lecture_notes | ✘ | S/D own · I/U own **blocked for guest** (0048) | SIUD own | own | own | own | 0029; guard 0048 |
| lecture_benefits | ✘ | S own · I own (guest blocked at RPC) · D own | S own · I · D own | own | S all + D (staff mod) | S all + D | 0030; staff 0081 |
| questions | ✘ | S own · I own (guest blocked at RPC); UD RPC-only | S own+I own | own | S all (moderator) | S all | 0028; inbox via RPC |
| question_answers | ✘ | ✘ (RPC only, no grants) | ✘ | ✘ | RPC append | RPC append | 0086 (RLS on, zero policies) |
| content_reports | ✘ | S own · I (own or null) | S own · I | own | own | S all + status RPC | 0051 |
| feedback | ✘ | S own · I (own or null) | S own · I | own | own | S all + status RPC | 0061 |
| app_ratings | ✘ | S own · I via RPC (`submit_rating`) | S own | own | own | S all | 0065 |
| broadcasts | ✘ | S (non-deleted) · write RPC-only | S | S+write(RPC, `is_content_manager`) | S | S+write | 0034 |
| broadcast_views | ✘ | SI own | own | own | own | own+counts RPC | 0083 |
| featured_lectures | ✘ | S ✔ · write RPC-only | S · write(RPC, `is_content_manager`) | S | S+write | 0038 |
| app_config | ✘ | S ✔ (world-readable) · write RPC-only (`is_admin`) | S | S | S | S + `set_app_config` | 0021/0023 |
| blocked_words | ✘ | ✘ (RLS on, **zero policies, zero grants**) | ✘ | ✘ | ✘ | ✘ (only DEFINER `contains_blocked_word` reads it) | 0052 |
| storage.objects (Supabase buckets, legacy) | ✘ | S published-gated (0040) · write `is_content_manager` | same | write | S | write | 0001/0002/0023/0040 |

**RLS-disabled / missing-policy audit:** every `public` table has `enable row level
security`. `blocked_words` and `question_answers` are RLS-on with **zero policies**
by design (owner-run DEFINER functions are the only readers/writers; the table-owner
RLS exemption + no client grants makes direct access impossible). No table was found
RLS-enabled-but-accidentally-open, and no user table was found with RLS left disabled.

### Explicit answers to the Phase-2 questions
- **Can a student read another student's notes / progress / quiz attempts?** No.
  `user_lecture_progress`, `lecture_notes`, `quiz_attempts`, `quiz_attempt_answers`,
  `notifications`, `daily_listening`, journey tables are all own-rows-only
  (`user_id = auth.uid()`). Confirmed by the migration policies and mirrored by
  `scripts/security-check.mjs` cases B (though that script itself is production-bound —
  F-211).
- **Can a guest write?** To *own-row personal* tables yes (progress, prefs, tokens,
  ratings, reports, feedback). To *account-gated* content — quizzes, questions,
  benefits, lecture notes, buddy — **no**: each RPC/policy blocks `is_anonymous`
  (0017/0028/0030/0048/0041). **Regression found & fixed:** 0082 dropped the buddy
  guards; F-201 / migration 0088 restores them.
- **Which tables have RLS disabled or missing policies for enabled RLS?** None
  disabled. `blocked_words` and `question_answers` are intentionally policy-less
  (locked down); all others carry complete policies for their intended verbs.

---

## SECURITY DEFINER function verdicts

All 87 migrations define DEFINER functions with `set search_path = public` (the one
exception, `web_prefix_tsquery` 0068, is INVOKER but omits `search_path` → F-209).
Every admin/staff-scoped DEFINER re-checks the role **inside** the body
(`is_admin()` / `is_content_manager()` / `is_moderator()` / `is_staff_viewer()`),
not only via grants. Verdicts:

| Function (latest def) | Role gate | Verdict |
|---|---|---|
| `is_admin` / `is_content_manager` / `is_moderator` / `is_sheikh` / `is_staff_viewer` | — | ✅ read-only role probes; safe |
| `handle_new_user` (trigger) | — | ✅ inserts only `display_name`; role always defaults `student` (no metadata-driven escalation) |
| `set_updated_at` (trigger) | — | ✅ pinned 0042 |
| `get_section_rollup` / `get_children_rollups` (INVOKER) | RLS | ⚠️ correct per-caller, but **not gender-filtered** → count leak F-208 |
| `get_sections_flat` / `get_section_page` / `get_home_page` / `search_content` (INVOKER) | RLS + `section_visible_to_viewer` | ✅ gender + published filtered |
| `get_featured_lectures` (INVOKER) | RLS | ❌→✅ **F-202** gender leak — fixed in 0089 |
| `section_visible_to_viewer` / `lecture_visible_to_viewer` (INVOKER) | — | ✅ own gender via own-profile RLS |
| `streak_for_user` / `week_progress_for_user` (INVOKER) | RLS | ✅ arbitrary uid returns own-RLS-empty (0s), no leak |
| `record_meaningful_activity` / `apply_meaningful_activity` / `save_activity` / `record_daily_listening` (INVOKER) | RLS + explicit `auth.uid()` | ✅ own-row writes only |
| `get_current_streak` / `get_week_progress` / `get_journey_summary` / `get_streak_status` / `try_claim_goal_congrats` / `touch_last_opened` | INVOKER/own | ✅ scoped to `auth.uid()` |
| `buddy_of` / `buddies_of` / `buddy_count` (DEFINER, arbitrary uid) | — | ⚠️ **F-207** — returns any user's buddy UUIDs/count (buddy-graph enumeration; UUIDs only) |
| `get_my_buddy_id` / `get_buddy_status` / `get_buddies_status` / `get_incoming_/outgoing_buddy_requests` | DEFINER, `auth.uid()` | ✅ scoped to caller |
| `search_buddy_candidates` | DEFINER, gender enforced server-side | ✅ gender-segregated; anon exclusion **restored** 0088 (was F-201) |
| `send_buddy_request` / `respond_buddy_request` / `cancel_buddy` / `cancel_buddy_request` | DEFINER, gender + cap + ownership | ✅ after 0088 (guest guard restored) |
| `set_own_profile` | DEFINER | ✅ writes only own name/gender/oath; **cannot** set role (no role column touched) — no escalation. (No `is_anonymous` guard, but buddy guards are the enforcement layer — see F-201 note) |
| `fanout_to_all` / `fanout_to_all_for_section` / `fanout_to_followers` / `followers_of_section` | DEFINER, EXECUTE revoked | ✅ trigger/cron-only |
| `notify_*` triggers, `dispatch_*` crons | DEFINER, revoked | ✅ not client-callable |
| `get_section_quizzes` / `get_quiz_intro` | DEFINER | ✅ strips answer key; published-only |
| `start_quiz_attempt` | DEFINER | ✅ registration gate (`is_anonymous`) + `max_attempts` server-side |
| `get_attempt_questions` / `save_quiz_answer` | DEFINER, ownership | ✅ strips `is_correct`; deadline clamp server clock |
| `submit_quiz_attempt` / `get_attempt_result` | DEFINER, ownership + `FOR UPDATE` | ✅ server-graded, idempotent |
| `quiz_result_payload` | DEFINER, EXECUTE revoked | ✅ internal; honors show_result/show_correct_answers |
| `get_quiz_results_summary` / `list_quiz_result_rows` / `get_attempt_detail` | DEFINER + `is_staff_viewer` | ✅ staff-only |
| `get_my_quiz_stats` | DEFINER, `auth.uid()` | ✅ |
| `ask_question` | DEFINER | ✅ registration gate + blocked-word (restored 0080) + length |
| `answer_question` (0086) | DEFINER + `is_moderator` | ✅ append + mirror |
| `get_public_questions` | DEFINER | ✅ **anonymity**: null asker when anonymous; published+public only |
| `get_my_questions` | DEFINER, `auth.uid()` | ✅ |
| `get_question_inbox` (0084) | DEFINER + `is_moderator` | ✅ **anonymity**: `'سائل'` even to admin (0077); `asker_id` only to admin |
| `get_question_answers` | DEFINER | ✅ asker/moderator/public-answered gate |
| `delete_question` / `set_question_hidden` | DEFINER + `is_moderator` | ✅ |
| `delete_own_question` / `update_own_question` | DEFINER, `asker_id = auth.uid()` | ✅ hidden-stays-hidden on edit |
| `get_lecture_benefits` | DEFINER | ✅ **anonymity**: never selects `user_id` |
| `add_lecture_benefit` | DEFINER | ✅ registration gate + blocked-word |
| `delete_own_benefit` | DEFINER, own | ✅ |
| `admin_list_benefits` / `admin_set_benefit_status` (0081) | DEFINER + `is_staff_viewer` | ✅ email nulled for non-admin staff |
| `report_content` | DEFINER | ⚠️ **F-204** — no guest dedup / rate-limit; fans to every admin |
| `admin_list_reports` / `admin_set_report_status` | DEFINER + `is_admin` | ✅ |
| `submit_feedback` | DEFINER | ⚠️ **F-204** — unlimited guest submissions, fans to every admin |
| `admin_list_feedback` / `admin_set_feedback_status` / `admin_delete_feedback` | DEFINER + `is_admin` | ✅ |
| `submit_rating` | DEFINER | ✅ upsert unique(user) → bounded |
| `admin_ratings_summary` / `admin_list_ratings` / `admin_delete_rating` | DEFINER + `is_admin` | ✅ |
| `contains_blocked_word` | DEFINER | ⚠️ **F-206** — bypassable (zero-width chars, concatenation) |
| `admin_dashboard_stats` / `admin_progress_analytics` (0081) | DEFINER + `is_staff_viewer` | ✅ no email exposed to sheikh |
| `admin_user_list` / `admin_user_detail` | DEFINER + `is_admin` | ✅ reads `auth.users` (email/phone/ban) admin-only |
| `admin_buddy_overview` | DEFINER + `is_admin` | ✅ |
| `create_/update_/delete_broadcast` (0064) | DEFINER + `is_content_manager` | ✅ |
| `get_home_broadcasts` / `get_broadcast` | INVOKER | ✅ RLS non-deleted |
| `record_broadcast_view` / `get_broadcast_view_counts` | DEFINER (+ `is_content_manager` for counts) | ✅ |
| `add_/remove_/reorder_featured_lecture(s)` / `get_featured_lectures_admin` | DEFINER + `is_content_manager` | ✅ |
| `admin_reorder_sections` / `admin_reorder_lectures` | DEFINER + `is_content_manager` | ✅ single-parent guard prevents re-parent |
| `set_app_config` | DEFINER + `is_admin` | ✅ |
| `can_read_storage_object` (0086) | DEFINER | ⚠️ **F-205** — lectures gated on *published only*, not gender |
| `web_prefix_tsquery` | INVOKER | ⚠️ **F-209** — missing `set search_path` |

**Cycle-safety note (F-212):** none of the 6 recursive section CTEs
(`get_section_rollup`, `get_children_rollups`, `get_sections_flat`,
`followers_of_section`, `section_visible_to_viewer`, `admin_progress_analytics`,
plus `get_home_page`'s ancestor walks) carry a `CYCLE` clause or depth cap. A
content-manager `UPDATE sections SET parent_id = <descendant>` (no server guard on
generic updates — `admin_reorder_sections` only guards reorder) would create a cycle
that makes these RPCs spin/error. Robustness finding, P3.
