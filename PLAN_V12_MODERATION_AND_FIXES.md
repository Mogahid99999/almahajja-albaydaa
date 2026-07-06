# Plan: V12 — Section gender scoping, playback-resume bugs, Q&A/benefits moderation, sheikh bio, forced updates, registration oath

**Date drafted:** 2026-07-06
**Target:** live Supabase (`USE_MOCK=false`).
Migrations continue after the latest existing one — **current max is 0048
(lecture_notes_block_anonymous), so new migrations start at 0049** (confirm at
start).

**This plan is fully decided for 9 of the 10 items below — the implementing
agent must NOT ask the user questions about those.** Every choice is locked;
proceed autonomously. Keep the calm, non-competitive Islamic tone; Arabic UI
strings stay Arabic. All data-access via `src/api/*`; cross-user reads/fan-outs
are server-side SECURITY DEFINER RPCs. Append-only migrations — never edit
0001–0048.

**Item 6 has one real external dependency (an email-sending provider account)
that only the human owner can supply — see Item 6 for the one question that
genuinely needs to go back to them.** Everything else proceeds without asking.

---

## Item 1 — Section gender scope (الكل / رجال / نساء)

### Data (`0049_section_visibility.sql`)
- `sections` gets `visibility text not null default 'all' check (visibility in ('all','male','female'))`.
- Effective visibility is **inherited**: a section is only shown to a student
  if it AND every one of its ancestors resolve to `'all'` or match the
  student's own `profiles.gender`. Compute this inside the existing recursive
  section CTEs (`get_section_page`, `get_home_page`, the plain sections list
  in `src/api/sections.ts`) as a `least-restrictive-wins` walk up the ancestor
  chain, rather than trusting each row's own column in isolation — so an admin
  who scopes a parent section doesn't also have to manually re-scope every
  child.
- A student with `gender is null` (never registered / guest) sees only
  `'all'` — same safe-default posture as the existing buddy-matching gender
  filter (migration 0015).
- Admin reads (sections/lectures management) are unaffected — admins always
  see everything regardless of `visibility` (existing RLS posture).

### Client
- `app/admin/sections.tsx`: add a 3-way segmented control (الكل / رجال /
  نساء) per section row/edit form, defaulting to الكل on create, editable any
  time after.
- Student-facing section/home fetches already flow through the RPCs above —
  no separate client-side filtering needed (never filter recursive content
  client-side per the stack conventions in CLAUDE.md).

---

## Items 2 & 3 — Playback resume breaks after a force-kill / after closing the mini player

### Diagnosis (do this FIRST, before changing code)
Working theory from reading `src/lib/audioController.ts` and
`src/lib/queryClient.ts`:

- Position IS saved at least every ~5s while playing, and immediately on
  pause/stop (`persist()` in `audioController.ts`), so a plain force-kill
  should lose at most a few seconds — the code looks correct in isolation.
- The TanStack Query cache is persisted to disk and survives a force-kill.
  `queryClient.ts` deliberately **excludes** the singular `lecture` query root
  (a single lecture's playback metadata + signed URL + resume position) from
  the cold-launch reconciliation list, with a comment saying it's "staled /
  invalidated on its own schedule elsewhere."
- That "own schedule" is an in-memory `invalidateQueries` call inside
  `audioController.ts` on pause/stop/finish. An in-memory invalidation flag is
  **not guaranteed to have been flushed to the on-disk persisted cache** before
  a force-kill happens milliseconds later.
- Net effect: on the next cold launch, `playLecture()`'s `ensureQueryData`
  can serve the **stale pre-kill cache entry** for that lecture (old resume
  position, and — for a streamed, never-downloaded lecture — a signed URL that
  may already be stale/expired), because nothing forced that specific entry to
  be treated as invalidated across the restart. This matches both symptoms:
  streaming playback silently failing to start (#2), and a downloaded/renewed
  session appearing to restart from zero (#3, if the stale entry predates the
  real progress).
- **Before writing the fix**, reproduce once with logging: pause a lecture
  that is NOT downloaded, force-kill, wait >5s, relaunch, and log what
  `ensureQueryData` actually returns (`positionSec`, `audioUrl`, cache
  `dataUpdatedAt`) versus the true row in the `lecture_progress` table. This
  confirms the theory before committing to the fix below.

### Fix
1. **New always-fresh local resume cache for every lecture (not just
   downloaded ones).** Today `src/lib/downloads.ts`'s JSON sidecar
   (`updateDownloadPosition` / `readDownloadMeta`) only exists for a
   downloaded lecture — a streamed lecture has no local record of its own
   position at all, so it's fully dependent on the TanStack persisted cache,
   which is the piece proven stale-prone above. Add a small parallel cache
   (same file-per-lecture-id convention as `downloads.ts`, or a single
   AsyncStorage JSON blob keyed by lecture id) written every time `persist()`
   runs in `audioController.ts` (the 5s tick, pause, stop, finish — already
   called this often, just also write here) for **every** lecture, downloaded
   or not. In `playLecture()`, when resolving the resume position, compare
   this local value against whatever the query cache/server returned and take
   the larger one (mirroring the existing "adopt if ahead, never rewind"
   comparison already used for the background server-refresh in the
   downloaded-fast-path branch) — so a stale query-cache entry can no longer
   silently win.
2. In `app/_layout.tsx`'s post-hydration hook (same place
   `reconcileContentListsAfterHydration` is wired), always invalidate
   `queryKeys.lecture(id)` for whatever lecture the local resume cache above
   says was most recently active — so the very first `playLecture` after a
   restart is guaranteed to hit the network for a fresh signed URL, never
   trusting a possibly-stale signed URL serialized to disk before the kill.
3. Keep everything else (the 5s tick, pause/stop persistence) as is — it's
   already correct; the bug is specifically the cold-launch cache trust, not
   the save cadence.

---

## Items 4 & 6 — Report button on Q&A + benefits, with admin review + push + email

Both items describe the same underlying mechanism (a student flags a piece of
content for admin attention) applied to two content types — questions (item 4)
and lecture "benefits"/فوائد posts (item 6) — plus item 6 additionally wants a
management screen and push+email delivery. Building one shared reporting
pipeline for both content types, rather than two separate ones, is the
simpler and more consistent design; this plan does that.

### Data — 4 migrations in this exact order (enum values can't be used in the
same transaction they're added in, per the existing `0012` convention):
1. `0050_notify_content_reported_type.sql`: `alter type notification_type add
   value if not exists 'content_reported';` — standalone, nothing else in
   this file.
2. `0051_content_reports.sql`: table `content_reports` (`id`, `content_type
   text check (in ('question','benefit'))`, `content_id uuid`, `reporter_id
   uuid null` — nullable, an anonymous/guest session can still report,
   `reason text null`, `status text check (in ('open','reviewed','dismissed'))
   default 'open'`, `created_at`); RPC `report_content(p_type, p_id,
   p_reason)` (SECURITY DEFINER insert, one open report per (reporter,
   content) pair to prevent spam-tapping, fans out a `content_reported`
   notification to every `role='admin'` profile — same fan-out convention
   `ask_question` uses for the sheikh role, 0028); RPC `admin_list_reports
   (p_status)` / `admin_set_report_status(p_id, p_status)` mirroring
   `admin_list_benefits` / `admin_set_benefit_status` (0030) — admin-only.
3. `0052_blocked_words.sql` — see Item 5 below (moved here since 4/6 and 5
   share this migration sequence).
4. `0053_wire_moderation_checks.sql` — see Item 5 below.

The push side rides the existing `notify-on-publish` webhook — no new
dependency there.

### Client
- Small flag/report icon on each question card
  (`src/components/questions/*`) and each benefit card
  (`src/components/.../BenefitCard` or equivalent), opening a tiny bottom
  sheet with an optional reason field → calls the new `reportContent()` in
  `src/api/questions.ts` / `src/api/benefits.ts` (or a shared
  `src/api/reports.ts`).
- New admin screen `app/admin/reports.tsx`: list of open reports (content
  type, a preview of the flagged text, reporter — if not anonymous, reported
  date), each row with quick actions "إخفاء المحتوى" (calls the existing
  `set_question_hidden` / `admin_set_benefit_status` RPCs), "تجاهل البلاغ"
  (dismiss), matching the calm/non-punitive tone used elsewhere.

### Email (the one item needing something from you)
Push notifications ride the existing `notify-on-publish` Edge Function — no
new dependency there. Email does not exist anywhere in this codebase yet, so
this needs a provider. **Recommendation: Resend** — a small REST call from a
new Edge Function (`supabase/functions/notify-email/`), triggered by the same
webhook row as the push notification, sent only for `content_reported` (not
every notification type, to avoid inbox noise). **This needs a Resend account
and an API key from you** (free tier is enough for this volume), stored as an
Edge Function secret (`RESEND_API_KEY`) — nothing else in this plan is
blocked by it, so implementation of everything else can start immediately and
the email leg is wired in whenever the key is available.

---

## Item 5 — Offensive-word filter on student-submitted text

Applies to every free-text field a student submits that later becomes visible
to the sheikh or the public: question text, benefit ("فائدة") text, and the
new report-reason field from item 4/6 (so the report flow itself can't be
abused to inject abuse).

**Revised per owner feedback:** no admin-panel UI for this at all. The list is
authored directly (owner reviews/edits it before it ships) rather than left
empty for an admin screen to populate.

### Data (`0052_blocked_words.sql`)
- New table `blocked_words (id, word text unique, created_at)`, **seeded with
  a real starter list** in the migration itself — a categorized draft
  (profanity/vulgarity, sexual/obscene terms, religious insults or
  blasphemy, slurs), Arabic, including common letter-substitution spellings
  (ه/ة, ا/أ/إ/آ, ى/ي) people use to dodge simple filters. The list is written
  out plainly in the migration (one word per seed row, grouped/commented by
  category) so it's easy to read and revise; future changes are a follow-up
  migration, never an in-app screen.
- A shared SQL check function `contains_blocked_word(p_text)` (diacritic- and
  case-insensitive whole-word match against the table).
- `0053_wire_moderation_checks.sql`: `create or replace` on `ask_question`
  (0028), `add_lecture_benefit` (0030), and `report_content` (0051) to call
  `contains_blocked_word` before inserting — a separate migration since it
  depends on both 0051 (report_content must already exist) and 0052 (the
  check function must already exist).

### Behavior
**Reject at submission, don't silently mangle the text.** If a blocked word is
found, the RPC raises and the client shows a calm inline message: "الرجاء
إعادة صياغة النص، فهو يحتوي على كلمات غير لائقة" — asking the student to
rephrase, rather than silently replacing words with `***` (which would look
broken/garbled for religious content and could still leak the offensive word
partially).

---

## Item 7 — "Answers may take a little while" notice on Q&A pages

No data model change beyond one more `app_config` string (consistent with the
existing about/support-contact convention, so wording is editable without a
redeploy): key `qna_notice_text`, default seed —

> "سيتم الإجابة عن جميع الأسئلة بإذن الله من قِبل الشيخ خلال فترة قصيرة"

Rendered as a small muted banner directly under the existing subtitle in
`app/(student)/questions.tsx` and the per-lecture equivalent in
`app/(student)/lecture-questions/[id].tsx`.

---

## Item 8 — Sheikh bio / "التعريف بالشيخ" page

### Data (`0054_sheikh_bio.sql`)
- `sheikhs` gets `bio text null`, `photo_path text null` (storage path,
  same convention as lecture attachments — signed URL resolved on read).

### Client
- Extend `app/admin/sheikhs.tsx` with a bio textarea + photo upload per
  sheikh (reuse the existing attachment upload component/pattern).
- New student-facing entry point (e.g. a "التعريف بالشيخ" row on
  `app/(student)/about.tsx` or the profile menu) → a simple detail screen
  showing photo + name + bio. Works whether the platform ends up with one
  sheikh or several: single sheikh shows directly, more than one lists first.

---

## Item 9 — Force update within 30 days of a release (not indefinite manual control)

Today's gate (`src/components/UpdateGate.tsx`, `src/api/appVersion.ts`) is a
manual switch: an admin bumps `min_app_version` in `app_config` and every
older install is immediately hard-blocked, with no automatic timing. This item
wants a **time-boxed grace period** instead: once a new version ships, older
installs get up to 30 days before being forced to update.

### Data (`0055_release_tracking.sql`)
- New `app_config` keys: `latest_app_version`, `latest_released_at`
  (ISO timestamp) — an admin sets both the moment a new build is actually
  published (small addition to `app/admin/settings.tsx`, same
  declarative-field pattern used for `support_whatsapp_url` etc.).
- `min_app_version` / `app_download_url` stay as-is and keep working as an
  **emergency manual override** for a critical/security forced update —
  the two mechanisms are independent, whichever demands the update wins.

### Client (`UpdateGate.tsx`)
- Hard block when: installed version < `latest_app_version` **and**
  `now - latest_released_at > 30 days` (in addition to the existing
  `min_app_version` manual check).
- Soft, dismissible nudge (not blocking) when installed version <
  `latest_app_version` but still inside the 30-day window — a small banner
  "يتوفر إصدار جديد، يفضّل التحديث قريبًا" with the same download link, so
  users aren't surprised by a sudden hard wall on day 31.

---

## Item 10 — Gender oath modal at registration

On `app/(auth)/register.tsx`, right when the user has picked a gender (before
the final "إنشاء الحساب" submit goes through), show a modal that must be
explicitly confirmed:

> بمجرد إنشاء الحساب، سيتم اعتماد البيانات التي أدخلتها (الاسم والجنس) بشكل
> نهائي ولا يمكن تعديلها لاحقًا. بالمتابعة، أنت تُقسم بالله أن ما أدخلته صحيح
> وأنك مسؤول عن ذلك أمام الله.
>
> [ ] أقسم بالله أن هذه البيانات صحيحة
> (متابعة) / (رجوع)

The checkbox must be ticked for "متابعة" to enable; "رجوع" closes the modal
and returns to the form untouched — registration is not submitted either way
until the checkbox is confirmed.

### Data (`0056_identity_oath.sql`)
- `profiles` gets `identity_oath_accepted_at timestamptz null`, set by the
  same RPC the register flow already calls (`set_own_profile` /
  the register mutation), the moment the modal is confirmed.
- **Lock gender (and name) after registration**: `app/(student)/edit-profile.tsx`
  currently needs checking for whether these fields are editable post-signup —
  remove/disable editing of `gender` and `name` there going forward, for every
  account (not just new ones), since a silently-editable field after an oath
  defeats the point. Admins keep the ability to correct a profile from
  `app/admin/users.tsx` for legitimate correction requests (support path, not
  self-service).

---

## Build order
1. Item 1 (section visibility) — self-contained, no dependencies.
2. Items 2/3 (resume bugs) — diagnose first, then fix; highest user-visible pain.
3. Item 10 (oath modal) — small, self-contained, high "get it right before more
   users register" urgency.
4. Item 9 (forced update timing) — self-contained.
5. Item 7 (Q&A notice) — trivial, do anytime.
6. Item 8 (sheikh bio) — self-contained.
7. Items 4/5/6 (reports + word filter) together, since 5 and 6 both build on
   the same new report/moderation surface as 4 — email leg of item 6 wired in
   once a Resend key is available.
