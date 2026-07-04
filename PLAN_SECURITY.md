# PLAN_SECURITY — deep security scan findings + phased fix plan

**Written by:** Fable 5 (planning session, 2026-07-04), after a full read of all 38
migrations, both edge functions, the auth/guest flow, env handling, and git history.
**Executor:** Sonnet 5, phase by phase, **in order**. Finish + verify each phase
before starting the next. Do not start PLAN_PERFORMANCE until this plan is done.

## Ground rules for the executor

- Read `CLAUDE.md` first. All data access via `src/api/*`; components never touch
  `supabase` directly. Recursive rollups stay server-side.
- New migrations continue the sequence: next is **`0039_*.sql`**. One concern per
  migration file, header comment explaining WHY (match the style of `0023`/`0034`).
- Migrations are applied to the live project "Almahajjah" (ref `prpyxnxgkpspjoxvcaro`)
  the same way earlier ones were — check `supabase/migrations` workflow the owner
  used previously (Supabase MCP / SQL editor). **Never** run destructive SQL without
  the migration file existing in the repo first.
- 🛑 **STOP gates**: steps marked 🛑 touch live accounts/keys. Present the exact
  action to the owner and wait for explicit "yes" before executing.
- Log anything unexpected in `GLITCH_LOG.md` (append, don't rewrite).

## Verdict from the scan (context for the executor)

The backend is in very good shape: RLS is enabled on all 27 tables, every admin
RPC has an internal `is_admin()`/`is_content_manager()`/`is_moderator()` guard,
quiz RPCs check ownership + block anonymous users, dangerous fan-out functions are
revoked from clients, buckets are private, no secrets in git history, only the anon
key ships in the app. The findings below are the remaining gaps, ordered by risk.

| # | Finding | Severity | Phase |
|---|---------|----------|-------|
| 1 | Seeded demo accounts with hardcoded password `test55%%` in repo (`admin@`, `user@`, `publisher@`, `sheikh@` gmail.com) — likely live in production auth | **Critical (verify)** | S0 |
| 2 | Supabase PAT (`SUPABASE_ACCESS_TOKEN`) in `.env` grants full account access; flagged for rotation long ago, still pending | High (local-only exposure) | S0 |
| 3 | Postgres default `EXECUTE` for `PUBLIC` on functions: most RPCs only `grant ... to authenticated` without `revoke ... from public, anon` — every SECURITY DEFINER function is internally guarded (verified), but anon-key callers can still invoke e.g. `get_public_questions()` without a session | Medium | S1 |
| 4 | Storage read policies are bucket-wide: any signed-in user (including guests) can read **draft** lecture audio / attachments if they know the object path | Medium-Low (UUID paths, low guessability) | S2 |
| 5 | Guest (anonymous) accounts are blocked from quizzes/questions/benefits but **not** from the study-buddy system: a guest can set gender+name via `set_own_profile` and then appear in `search_buddy_candidates`, send/accept requests → ghost buddies | Medium-Low | S3 |
| 6 | Buckets have no `file_size_limit` / `allowed_mime_types` (writes are staff-only, so hardening not blocking) | Low | S2 |
| 7 | Auth project settings unverified: leaked-password protection, min password length, anonymous sign-in abuse limits | Low-Medium | S4 |
| 8 | No automated RLS regression test — every past invariant is hand-verified only | Hardening | S5 |

Explicitly checked and **NOT** a problem (do not "fix" these):
- `profiles.role` cannot be self-escalated (no self-write policy; `set_own_profile`
  only touches `gender`/`display_name`; role changes only via the `admin-users`
  edge function which verifies the caller is admin and blocks self-role-change).
- `streak_for_user` / `week_progress_for_user` are SECURITY INVOKER — direct calls
  for another user return empty under RLS; cross-user reads only happen inside the
  deliberate buddy DEFINER RPCs.
- The JWT hardcoded in `0009_notifications_webhook.sql` is the **anon** key
  (public by design), not a secret.
- The `admin-users` edge function: JWT verified at gateway, admin role re-checked
  server-side, anti-lockout (no self-ban/self-role-change). CORS `*` is acceptable
  because auth is bearer-token, not cookies.

---

## Phase S0 — Live credentials cleanup (🛑 owner actions, do this first)

**Goal:** no guessable/known credentials or over-broad tokens exist for the live project.

1. 🛑 **Demo accounts.** Check in the live project whether these users exist:
   `admin@gmail.com`, `user@gmail.com`, `publisher@gmail.com`, `sheikh@gmail.com`
   (seeded by `scripts/seed-auth.mjs`, `seed-publisher.mjs`, `seed-sheikh.mjs`,
   all with password `test55%%` — the password is written in the repo).
   For each that exists, ask the owner per account: **delete** it, or **set a strong
   random password** (owner may still need the admin account — then rotate its
   password and email it to the owner verbally/securely, never into a repo file).
   The `admin-users` edge function or the service key can perform this.
2. **De-hardcode the seed scripts.** Edit all three `scripts/seed-*.mjs`: read the
   password from `SEED_PASSWORD` env var; abort with a clear message if unset.
   Remove the literal `test55%%` everywhere including the header comments.
3. 🛑 **Rotate the Supabase PAT** (`SUPABASE_ACCESS_TOKEN` in `.env`) — generate a
   new token in the Supabase dashboard (Account → Access Tokens), revoke the old
   one, update `.env`. This was flagged months ago and is still pending.
4. 🛑 **Move secrets out of the project tree**: `almahajjah-e3c12-firebase-adminsdk-*.json`
   and `riwaq-release.jks` → suggest `~/secrets/almahajjah/`. Update any script/EAS
   config referencing them. (Both are gitignored and history-clean — this is
   belt-and-suspenders against folder sharing.)

**Done when:** no account with a repo-known password exists live; seed scripts have
no literal passwords; old PAT revoked; secret files live outside the repo folder.

## Phase S1 — Function EXECUTE hygiene (migration `0039_function_execute_hygiene.sql`)

**Goal:** the `anon` role (no session) can execute **zero** application functions.

1. In the migration, first do a blanket sweep, then re-grant:
   - `revoke execute on all functions in schema public from public, anon;`
   - Re-`grant execute ... to authenticated` for every function the app calls from
     the client. Build the list by grepping `grant execute` across existing
     migrations (0001→0038) and `supabase.rpc(` across `src/api/*` — the union is
     the re-grant list. Keep trigger-only/cron-only functions (e.g.
     `fanout_to_followers`, `fanout_to_all`, `dispatch_weekly_goal_nudges`,
     `notify_*`) revoked from `authenticated` as well, exactly as their original
     migrations intended.
   - Also add `alter default privileges in schema public revoke execute on functions from public, anon;`
     so future functions are private by default.
2. Careful with `is_admin()` / `is_content_manager()` / `is_moderator()` — they are
   referenced inside RLS policies; keep `authenticated` execute on them.
3. **Verify:** with the raw anon key (no session), `POST /rest/v1/rpc/get_public_questions`
   and `rpc/get_sections_flat` must return 401/permission-denied, not data. With a
   signed-in student the app must behave exactly as before — click through Home,
   a section, the player, quizzes, questions, journey, buddy search, notifications.

**Done when:** anon-key RPC probes fail; full student + admin click-through works.

## Phase S2 — Storage: stop draft audio/attachment reads (migration `0040_storage_draft_scope.sql`)

**Goal:** a student/guest can only read storage objects belonging to **published** content.

1. **First inspect the path convention** — read the upload code (`src/api/admin.ts`,
   `src/api/attachments.ts`) and confirm how `lectures.audio_path` and
   `attachments.file_path` map to `storage.objects.name`. Do not write the policy
   until the mapping is confirmed by an actual live row (select one via MCP).
2. Replace `lectures_objects_read` with a policy that allows a read only when
   `public.is_content_manager()` OR a **published** lecture row references that
   object path (`exists (select 1 from public.lectures l where l.audio_path = storage.objects.name and l.status = 'published')`
   — adjust to the real column/path format found in step 1). Mirror the same
   approach for `attachments_objects_read` via the `attachments` → parent lecture
   join (section-level attachments: allow when `section_id is not null`, matching
   the existing `attachments_select` table policy).
3. Bucket hardening in the same migration:
   `update storage.buckets set file_size_limit = <sensible cap, e.g. 200MB lectures / 25MB attachments>, allowed_mime_types = <audio/* for lectures; pdf/images/audio for attachments>`
   — check what MIME types the admin upload flow actually produces before locking
   the list (see `src/lib/documentPicker.ts`, `audioTranscode.ts`).
4. **Verify:** signed-in **student** session: signed URL for a published lecture
   plays; creating a signed URL for a **draft** lecture's path fails or the URL
   404s. Admin/publisher can still play drafts in the admin panel. Offline
   downloads of published lectures still work.

**Done when:** draft object reads are denied for students/guests, published playback
and admin flows are unchanged.

## Phase S3 — Guest hardening for the buddy system (migration `0041_buddy_block_anonymous.sql`)

**Goal:** anonymous (guest) accounts cannot participate in the study-buddy feature.

1. Add the same guard already used in `start_quiz_attempt` (0017 line ~292) to:
   `send_buddy_request`, `respond_buddy_request` (recreate the 0020 versions —
   note 0020, not 0015, holds the current bodies). Error text in Arabic, matching
   existing style: `'يلزم إنشاء حساب لاستخدام رفيق الدرب'`.
2. Exclude anonymous users from `search_buddy_candidates` results: inside the
   (DEFINER) function add `and not coalesce((select u.is_anonymous from auth.users u where u.id = p.id), false)`.
3. Client UX (small, optional but preferred): in the buddy screens, if
   `user.isGuest`, show the existing "create an account" prompt pattern used by
   quizzes instead of the search UI (find it via `isGuest` usages in `app/(student)/`).
4. **Verify:** as a guest — buddy search hidden/blocked, RPCs reject; as a real
   student — buddy flow unchanged end-to-end (search, invite, accept, weekly
   progress card).

**Done when:** guest cannot appear in, send, or accept buddy requests; students unaffected.

## Phase S4 — Auth project settings (dashboard/management API; some 🛑)

**Goal:** project-level auth protections enabled.

1. Check + enable **leaked password protection** (HaveIBeenPwned check) —
   Auth → Settings. 🛑 confirm with owner (it can reject some sign-ups).
2. Minimum password length ≥ 8 (currently the edge function enforces only ≥ 6 for
   admin-created users — raise that constant in `supabase/functions/admin-users/index.ts`
   to match, and redeploy the function the same way it was deployed before, see its
   header comment).
3. Review anonymous sign-in settings: confirm rate limits are on defaults or
   stricter; consider enabling CAPTCHA only if the owner reports abuse (🛑 ask —
   CAPTCHA adds friction to the guest-first flow, likely **no** for now).
4. Run the **Supabase security advisor** (dashboard → Advisors) and fix anything
   it flags that overlaps this plan; append anything new to `GLITCH_LOG.md`.

**Done when:** settings confirmed + advisor list is clean or triaged into the log.

## Phase S5 — RLS regression test script (`scripts/security-check.mjs`)

**Goal:** the invariants this plan establishes stay true in future sessions.

1. Write a node script (same style as `scripts/seed-auth.mjs`, env-driven, no new
   deps) that uses the **anon key only** plus two throwaway test users (create via
   service key at start, delete at end) and asserts:
   - anon (no session): cannot call any RPC (expect permission denied), cannot
     select from `lectures`, cannot read a storage object.
   - student A: sees only published lectures; cannot read student B's progress,
     notes, notifications, quiz attempts; cannot call `admin_dashboard_stats`,
     `admin_user_list`, `set_app_config`, `create_broadcast` (expect Arabic/`not allowed` errors);
     cannot read a draft lecture's audio object; cannot write to `sections`/`lectures`.
   - guest (anonymous session): cannot `start_quiz_attempt`, `ask_question`,
     `add_lecture_benefit`, `send_buddy_request`.
   - Print a ✅/❌ table; exit non-zero on any ❌.
2. Run it against live. All green.
3. Add a one-line note to `CLAUDE.md` under conventions: "after any migration
   touching RLS/policies/functions, run `node scripts/security-check.mjs`".

**Done when:** script exists, runs green against live, documented in CLAUDE.md.

---

## Final acceptance for the whole plan

- All 🛑 items explicitly resolved with the owner (done or consciously deferred).
- `security-check.mjs` green.
- Full manual click-through as student, guest, publisher, admin — no regressions.
- `GLITCH_LOG.md` updated with anything discovered along the way.
