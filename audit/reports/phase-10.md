# Phase 10 report — Admin web dashboard + sheikh surface

**Method:** static code review only — no browser/Playwright available in this
environment, so every "needs-live-check" item below is a genuine gap in this
pass, not a formality. `npm run typecheck` is clean after the fixes.

**Scope** `app/admin/*` (22 screens), `src/components/admin/*`, `app/sheikh/*`,
`src/hooks/useAdminGuard.ts`, `src/components/admin/AdminShell.tsx`.
**Findings** F-1000…F-1005 (new) + F-012/F-016/F-017 (pre-seeded leads,
reassessed and updated in place).

---

## 1. Upload pipeline (the content lifeline)

| Check | Verdict |
|---|---|
| Huge files | Not size-capped client-side; relies on the R2 signed-URL PUT and browser/OS limits. No finding raised — no evidence of a broken path, just unverified live (network tab needed for a real large-file timing test). |
| Transcode path (`audioTranscode.web.ts` vs native) | Web always transcodes to MP3 via ffmpeg.wasm regardless of source format (ogg/wav/etc. all normalize to MP3 before upload). Native (`upload.tsx`) explicitly skips transcode ("Issue 6" comment) and uploads the picked file as-is. |
| Interrupt mid-upload | `busy = createLecture.isPending || converting` disables both submit buttons for the full duration; a killed tab/app mid-`uploadToR2` simply leaves no DB row (see R2-orphan below) — no half-written lecture row is possible since the R2 upload happens *before* the insert. |
| Duplicate submission | Guarded — `busy` disables the button through the whole mutate lifecycle, both the sticky-rail and top-bar submit buttons. |
| R2 orphan on failed metadata write | **Confirmed, fixed (F-1000).** `createLecture` uploaded to R2 then inserted; any insert failure after a successful upload orphaned the object. Now cleans up via the existing best-effort `deleteFromR2` on insert failure. |
| draft→publish→notify-on-publish chain | Publishing (`status='published'` with a section) requires an explicit confirm dialog first (typo/misclick guard against blasting every opted-in student); the fan-out itself is server-side (0018, out of this phase's diff) — not re-verified here, no evidence of drift. |
| ogg/opus on iOS (F-016) | **Confirmed the exact mechanism, fixed.** Native upload had no format gate; web's transcode makes it a non-issue there. Native now rejects `.ogg/.oga/.opus` at pick time with an Arabic message. Physical-device decode confirmation remains a Phase 5/11 device-pass item (unchanged, was already flagged there). |

## 2. Section tree editing

- **Reorder** (drag-and-drop): same-parent siblings only, persisted via
  `reorderSections` — cannot reparent, so no cycle risk from this path.
- **Reparent ("move", the `TreePicker` in the inline editor)**: **cycle gap
  found and fixed (F-1001)** — only self-parenting was actually guarded
  despite a comment claiming "self or a descendant"; `TreePicker` has no
  descendant-exclusion. Fixed using the existing `subtreeIds()` helper
  (already used for the delete-cascade warning) to fall back to the current
  parent when the chosen one is inside the node's own subtree.
- **Delete-with-children**: `pendingDelete` confirm dialog already computes
  and shows the full descendant count via `subtreeIds()` before the cascading
  delete — this path was already correct, no finding.
- Residual SQL-side gap (F-212, Phase 2, still open): the recursive CTEs
  themselves have no `CYCLE` clause — the client fix above prevents the UI
  from creating a cycle, but a cycle introduced any other way (direct SQL,
  future tooling) would still spin/error those functions. Unchanged this
  phase, cross-referenced.

## 3. Role boundaries (publisher/sheikh screen hiding vs direct-URL access)

`useAdminGuard.ts` has two guards: `useAdminOnly()` (admin-only screens,
bounces publisher→lectures, sheikh→dashboard) and `useStaffOnly()`
(admin+sheikh screens, bounces publisher→lectures). **Audited whether every
screen flagged `adminOnly`/`sheikh` in `AdminShell`'s `NAV_ITEMS` actually
calls the matching guard, i.e. whether nav-hiding is real enforcement or
cosmetic:**

- Already correct: `buddies`, `users`, `settings`, `user/[id]`, `questions`
  (all `useAdminOnly`); `analytics`, `index`/dashboard (both `useStaffOnly`).
- **Gap found (F-1004, fixed):** `feedback`, `reports`, `ratings` are flagged
  `adminOnly` in the nav but called no guard at all. The RPCs behind them
  (`admin_list_feedback`/`admin_list_reports`/`admin_list_ratings`) are
  `is_admin()`-only at the RLS/RPC layer, so **no data ever leaked** to a
  publisher — but a direct-URL/deep-link publisher got a raw RPC-error or
  empty state instead of the calm redirect every other adminOnly screen
  gives. Added `useAdminOnly()` to all three.
- **Correctly unguarded:** `contributions.tsx` — flagged both `adminOnly` and
  `sheikh` in nav (shared screen); its RPCs gate on `is_staff_viewer()`
  (admin OR sheikh), so no guard call is right — adding `useAdminOnly()`
  there would have wrongly bounced a legitimate sheikh.
- **Lower-severity leftover (F-1005, open):** `quiz-attempt.tsx` /
  `quiz-results.tsx` are drill-down-only (not in `NAV_ITEMS`, so never
  claimed to be nav-hidden) but their RPCs are also `is_staff_viewer()`-gated
  — a publisher direct-navigating gets the same raw-error UX. Left open as
  cosmetic-only; not fixed this pass to keep the diff scoped to confirmed,
  nav-contradicting gaps.
- **`AdminLayout` (`app/admin/_layout.tsx`)** gate (`isStaff` = admin/
  publisher/sheikh, else render nothing) is a first line of defense against
  guest/student direct access — confirmed present and correct; RLS is the
  real backstop either way (per CLAUDE.md convention).
- **Not verifiable statically:** whether the *bounce itself* actually fires
  before any sensitive UI paints for a real publisher/sheikh session, and
  whether role changes propagate to an already-open admin tab without a
  reload (the guard reads `useCurrentUser()`, which should reflect a fresh
  profile fetch, but this needs a live two-tab test). **Needs live
  verification.**

## 4. User management

- Role changes (`setRole`) write `profiles.role` (the live RLS source of
  truth) synchronously; RLS effect is immediate on the next query regardless
  of the target's stale JWT claims. No finding.
- Ban (`ban` case in `admin-users` edge function) sets a 100-year
  `ban_duration` **and** proactively kills the banned user's active sessions
  — already closes the "still logged in after ban" gap. No finding.
- Anti-lockout (`isSelf` checks on ban/delete/setRole) present and correct.
- Not verifiable statically: actual session-kill latency / whether a banned
  user's already-cached TanStack Query data keeps rendering until their next
  network call. **Needs live verification** (kill a session, watch a second
  device).

## 5. Quiz editor — delete question with existing attempts

**Gap found, left open (F-1003):** `writeQuestions`'s diff-upsert is a
deliberate, good design (existing student answers survive *unrelated* edits
via preserved ids) — but removing a question outright cascades
`quiz_answers` deletion for **every** attempt against that question,
including already-submitted/graded ones, with **no recompute** of the
stored `score`/`passed` on those attempts and **no confirmation dialog**
warning the admin this touches historical, already-graded data. This is a
product-policy question (block delete once attempts exist? warn + recompute?
accept as-is?), not a safe inline patch — logged for an owner decision.

## 6. Moderation queues (contributions/reports/feedback) — pagination & races

- All three list via `limit(500)`-style admin RPCs (no infinite scroll/
  cursor pagination) — same shape as F-012's lectures list but at a size
  where 500 is far less likely to be hit soon; not raised as a new finding,
  same class of debt as F-012.
- Status-change mutations (`admin_set_*_status`) are simple RPC calls without
  optimistic-locking; two admins actioning the same report/feedback/benefit
  simultaneously would just have the second write win — no crash, silent
  last-write-wins. Not raised as a finding (matches the calm-tone,
  low-traffic admin surface; a real race requires two admins acting on the
  same row within seconds) but **worth a live two-tab check** if the owner
  wants to confirm the UX doesn't show a stale "pending" row after the other
  admin already resolved it.

## 7. Analytics vs raw SQL

Not spot-checked against raw SQL this phase (time-boxed; `is_staff_viewer()`
gating on `admin_dashboard_stats`/`admin_progress_analytics` was already
verified in Phase 2/9 context reads). **Needs a live pass**: compare a tile
number (e.g. active users this week) against a manual `count(*)` query on
staging.

## 8. Unclassified queue readiness for future Telegram bot ingestion

Verified the schema, not just the manual form: `lectures.section_id IS NULL`
+ `status='draft'` is a pure data-shape convention with no admin-form-only
plumbing in the way — `getUnclassifiedLectures()`/the unclassified screen
read straight off `section_id is null`, and `createLecture` is not the only
possible producer of that shape (any INSERT with `section_id: null` — e.g. a
future bot writing via a service key — lands in the same queue with no
schema change). No finding; matches the CLAUDE.md design goal.

## 9. Per-screen status

| Screen | Status |
|---|---|
| dashboard (index) | audited (guard ✓ `useStaffOnly`) |
| upload | audited, 2 fixes (F-1000, F-1002/F-016) |
| lectures | audited — no guard needed (publisher-visible); `.limit(1000)` = F-012 (open, unchanged) |
| sections | audited, 1 fix (F-1001) |
| sheikhs | audited — no issues found |
| quizzes (list) | audited — no issues found |
| quiz-edit | audited, 1 finding logged (F-1003, open) |
| quiz-attempt, quiz-results | audited, cosmetic gap logged (F-1005, open) |
| questions | audited — guard already correct |
| contributions | audited — correctly unguarded (RLS-appropriate) |
| ratings | audited, 1 fix (F-1004) |
| reports | audited, 1 fix (F-1004) |
| feedback | audited, 1 fix (F-1004) |
| reminders | audited — no issues found |
| featured | audited — no issues found |
| buddies | audited — guard already correct |
| users, user/[id] | audited — guard already correct, ban/session-kill verified in code |
| analytics | audited (guard ✓); tile-vs-SQL correctness **needs live check** |
| settings | audited — guard already correct |
| unclassified | audited — schema-level bot-readiness confirmed |
| sheikh/index | read for the shared-nav/drawer path; not deep-audited beyond that (out of the "22 admin screens" core count) |
| AdminShell, useAdminGuard | audited directly — this phase's main subject |

## 10. Summary

- **6 new findings** (F-1000…F-1005): **4 fixed** (F-1000 R2 orphan,
  F-1001 section-reparent cycle, F-1002/F-016 ogg-on-iOS, F-1004
  unguarded-adminOnly-screens), **2 open** (F-1003 quiz-question-delete
  data-integrity policy decision, F-1005 cosmetic staff-only-drill-down
  guard gap).
- **3 pre-seeded leads resolved/updated**: F-016 fixed (folded into F-1002),
  F-017 narrowed from "never audited" to "shell is correct, per-screen
  narrow-width content still needs a live pass", F-012 reconfirmed open
  (architectural, no live symptom yet).
- **Key risks needing live verification** (browser/Playwright pass): (1)
  narrow-viewport table overflow on users/lectures/quiz-results/reports —
  F-017; (2) the admin-guard bounce actually firing before sensitive UI
  paints for a real publisher/sheikh session, and role-change/ban
  propagation to an already-open tab; (3) analytics tile numbers vs raw SQL;
  (4) two-admin moderation-action races on the same row.
