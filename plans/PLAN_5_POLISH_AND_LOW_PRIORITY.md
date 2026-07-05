# PLAN 5 — Polish & Low-Priority Items

Source: all five test agents. None of these block submission; pick these up
after Plans 1–4, or opportunistically whenever the relevant file is next
touched. Grouped by area.

---

## Web admin dashboard

1. **Console noise on every admin-web page** — a recurring
   `Invalid style property "direction"` console.error fires on every route
   (dev overlay + ships into prod bundle too). Some component passes a raw
   `direction` style property; replace with React Native's `writingDirection`
   style prop or the `dir` HTML attribute depending on where it's coming
   from. Also present: a require-cycle warning between `src/api/progress.ts`
   and `src/lib/outbox.ts` (fix by breaking the circular import, e.g. move
   the shared piece both depend on into a third module), deprecated
   `shadow*` style prop warnings, and `props.pointerEvents` deprecation
   warnings — all cosmetic console noise, no functional impact observed.
2. **Publishing a lecture or quiz gives no warning that it notifies every
   opted-in student immediately** — confirmed this fans out real
   notifications with no draft/send-later option and no confirmation
   dialog warning about the blast radius. Add a confirm step to the
   publish action stating something like "سيصل إشعار إلى جميع الدارسين" (a
   notification will reach all students) so an admin can't publish
   something by accident/typo and immediately notify everyone. Same
   applies to the reminders/broadcasts creation flow, which also sends
   immediately with no draft mode.
3. **`html`/`body` computed CSS direction is `ltr`** even though every
   individual element correctly uses right-alignment/RTL styling. Rendering
   was correct everywhere tested, but any future plain-HTML element
   (browser scrollbars, text selection, an input without an explicit
   `dir="auto"`) will default to LTR behavior. Consider setting `dir="rtl"`
   at the document/root level for defense-in-depth, matching the app's
   RTL-first identity, rather than relying on per-element overrides alone.
4. One wasted network call: `admin_dashboard_stats` fires once as a
   publisher before the redirect-away-from-/admin logic kicks in (server
   correctly denies with 403, no data leak — just a wasted request). Low
   priority — could guard the call behind a role check before firing it.

## Backend / data model

5. **`lecture_notes` allows anonymous (guest) writes** with no
   `is_anonymous` guard — unlike buddy requests, quiz attempts, and
   questions, which all explicitly block guests. This is consistent with
   how the migration was written (not a regression), but worth a deliberate
   product decision: should a guest be able to write a private note that
   effectively disappears if they never register? If notes should require a
   real account (matching the pattern for buddy/quiz/questions), add the
   same `is_anonymous` guard used elsewhere (see migration 0041 for the
   pattern) to whichever migration governs `lecture_notes` RLS.
6. **`save_activity` replay double-credits `seconds_listened` on a resent
   batch** (position/completion state stays correctly idempotent; only the
   raw "seconds listened" counter can double-count on a retried
   acknowledgment, bounded by the existing 6h/day clamp). This is already an
   explicitly-documented, accepted tradeoff in migration
   `0046_offline_activity_sync.sql`'s own header comment — not a bug to
   silently "fix," but if greater precision is ever desired, the clamp would
   need to move from per-(lecture, day) to per-(user, day) — e.g.
   `least(existing + delta, 86400)` at the user+day level. Low priority,
   documented tradeoff, only revisit if it becomes a real product complaint.
7. **`mailer_autoconfirm = true`** — new sign-ups get an active session
   immediately with no email-ownership verification. Not a security bug
   (every RLS rule keys off `auth.uid()`, valid either way), but means
   password-recovery and any future email-based communication trusts an
   unverified address. Likely an intentional low-friction-onboarding choice
   — just flagging so it's a conscious decision on record, not a default
   nobody looked at.

## Playback / offline

8. **Playback position can overrun the displayed duration** by ~30-40
   seconds before the player actually stops (observed: position ran to
   2:40:05 against a displayed/true duration of 2:39:27). Add a hard clamp
   so playback position never exceeds the known duration, and/or verify the
   duration label itself is accurate against the actual audio file length.
9. **Offline outbox has no queue growth cap** — see Plan 4, Phase 4.5 item 3
   (same finding, listed there since it's bundled with other quick
   dependency-hygiene wins).

## Test/process note (not a code fix — just context for whoever reads this)

During this validation run, publishing one test lecture on the live admin
dashboard did trigger real notification rows for ~19 real opted-in students
(the rows were deleted within minutes via direct database cleanup, but a
push notification banner may have briefly reached some devices before
cleanup). This was an unavoidable side effect of testing the real publish
flow against production and is the direct motivation for Plan 5 item 2
above (add a warning before publish) — flagging here so it isn't a mystery
if the owner notices it in analytics/logs from the test date.
