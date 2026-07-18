# PLAN V19 — 10-item batch (owner request 2026-07-18)

Grounded in current code. Devices are connected with **data OFF** — I'll use them to verify
the offline items (9) and the on-device flows (1, 3, 5). Migrations are append-only; after any
RLS/policy/function migration run `node scripts/security-check.mjs`.

Order is by risk & dependency. Each phase is independently shippable & device-verifiable.

---

## TICKET IMAGE FIXES round 5 (render) (follow-up 2026-07-18)
Three separate bugs behind "image still not appearing":
1. AdminTicketThread never rendered images at all (upload-only) → added rendering.
2. Message bubbles collapsed to a 1-char-per-line thin strip: bubble had no width, so
   image `width:'100%'` = 100% of a sliver → added minWidth 140 + concrete width when
   an image is present (student bubble + admin bubble width 260).
3. (round 4) storage read-gate denied ticket images → 0101.
New shared src/components/tickets/TicketImage.tsx (resolves signed URL + placeholder
while loading/on failure) used by BOTH the student thread and the admin thread.

## TICKET IMAGE FIXES round 4 (follow-up 2026-07-18)
- **Image not showing (admin or student):** ticket-reply images upload under the
  `broadcasts/` R2 prefix (reuse uploadBroadcastImage), but can_read_storage_object's
  `broadcasts/` gate only allowed keys owned by a BROADCAST row → signed-URL read
  DENIED for ticket images. Fixed in 0101: the gate now also allows a key that is a
  feedback_messages.image_path, for the admin OR the ticket owner (privacy preserved).
  Verified live: student gets a signed URL for the ticket image.
- **Delete ticket → orphaned R2 images:** adminDeleteFeedback now collects the
  ticket's feedback_messages.image_path keys BEFORE the delete and deleteFromR2's them
  (best-effort), mirroring deleteBroadcast/deleteLecture cleanup.
- Added feedback_messages to database.generated.ts (proper types, no cast).

## TICKET FIXES round 3 (follow-up 2026-07-18)
- Reverted admin tabs to the original 5 (جديدة/قيد المراجعة/محلولة/متجاهلة/الكل);
  «قيد المراجعة» tab also includes any legacy awaiting_student rows.
- admin_reply_ticket now sets status = 'in_review' (was 'awaiting_student', 0100)
  so a ticket the admin replied to STAYS under «قيد المراجعة». Verified live.
- Added pull-to-refresh to the student ticket-thread page (Screen refreshing/onRefresh
  → refetch thread + tickets).

## TICKET SYSTEM FIXES round 2 (follow-up 2026-07-18)
- **ROOT BUG (student couldn't see admin reply):** get_ticket_thread (0097) threw
  «column reference "id" is ambiguous» (42702) — RETURNS TABLE OUT col `id` vs
  feedback_messages.id — so the RPC failed for everyone and the thread rendered
  empty. Fixed in 0099 with `#variable_conflict use_column`. Verified live: student
  now gets both their message + the admin reply.
- 0098: student_reply_ticket now notifies all admins (route /admin/feedback).
- Thread/list hooks: staleTime 0 + refetchOnMount 'always' (offline-first cache was
  serving a stale thread) so opening a ticket always pulls the latest conversation.
- Keyboard: ticket thread wrapped in KeyboardAvoidingView behavior="padding" so the
  reply box isn't covered.
- Admin tabs regrouped by lifecycle: «قيد المراجعة» now shows all OPEN tickets
  (new + in_review + awaiting_student) — a just-created ticket appears there.
- Admin actions «تم الحل / تجاهل / حذف» now stay available for awaiting_student too
  (i.e. after the admin has replied), and the status badge always shows.

## NAV + CREATE-TICKET FIXES (follow-up 2026-07-18)
- Bottom nav sluggishness/invisible-Home: icon color now snaps INSTANTLY off the
  current route (isActive) instead of interpolating over the pill spring. Active
  icon = primaryTealDeep (dark on the gold pill); the pill is correctly positioned
  from frame 1 (activeIndex seeded, not animated on mount). Fixes both (a) Home
  icon invisible on first open (was dark-on-dark before the pill slid under it) and
  (b) white→green flash on every tap. Removed unused interpolateColor.
  File: src/components/navigation/BottomNavBar.tsx.
- تذاكري create-ticket: added «إنشاء تذكرة جديدة» button in app/(student)/tickets/
  index.tsx that opens the existing FeedbackSheet (submit_feedback seeds the ticket
  thread, 0097). Refetches on close. Notification chain already complete: create→all
  admins (0061/0097), admin reply→student, close→student.

## PULL-TO-REFRESH FIX (follow-up 2026-07-18)
Bug: each screen's pull-to-refresh invalidated only a curated key subset; shared
app-config (support link, About/Q&A/share copy, «ابدأ من هنا») — 30-min staleTime —
was in NO screen's list, so admin edits appeared only after a full app restart.
Fix: new `useRefreshAll()` (invalidateQueries with no key + refetchType:'all' →
refetches every query incl. unmounted). Wired into Home, profile, section,
sheikh-info, journey, notifications, QuestionsBoard (added RefreshControl), tickets.
Offline-safe: onlineManager pauses refetches → invalidate still resolves the spinner.
Typecheck clean, 161 tests pass.

## FINAL STATUS 2026-07-18 — ALL 8 PHASES DONE (code + migrations live)
Migrations 0093–0097 APPLIED to prod (prpyxnxgkpspjoxvcaro), security-check green,
161 tests pass, typecheck clean. Device verification pending on connected phones.
- P1 email: code hardened; ROOT CAUSE = old build shipped OTP path → **cut a new release**.
- P2 offline boot: bootReady 5s timeout + bounded anon calls.
- P3 auto-advance: tools follow playing track id + prefetch.
- P4 buddy requests page: /(student)/buddy-requests + 0093 route re-point.
- P5 Q&A: clearer hide-name copy + admin audience flip + reveal name (0094).
- P6 answer reports: report_content 'answer' → sheikh + admin (0095).
- P7 reminder audio: R2 upload + inline player w/ speed + RTL seekbar (0096).
- P8 tickets: feedback→ticket thread, admin reply+image+CTA+close, student page (0097).
Temporary `as never` casts on new RPCs until database.generated.ts is regenerated
(broadcasts.audio_path was added manually). Permission rule added: curl→api.supabase.com.

## STATUS 2026-07-18
- **Phase 1 (email) — DONE (code) + ROOT CAUSE FOUND.** See findings below.
- **Phase 2 (offline boot) — DONE (code), pending device verify.** Hard 5s boot timeout + bounded anon-session network calls. New `src/lib/bootReady.ts` + test.
- **Phase 3 (auto-advance tools) — DONE (code), pending device verify.** Lesson tools now keyed off the playing track id; prefetch next lecture's note/benefits/questions in the near-end warm-ahead. New `src/lib/activeLecture.ts` + test.
- All three typecheck clean; new regression tests (11) pass.

### Phase 1 ROOT CAUSE (verified against live project prpyxnxgkpspjoxvcaro)
- `register-set-email` edge function IS deployed, ACTIVE, verify_jwt=true; all secrets present.
- **Live end-to-end test PASSED**: created anon session → invoked function → email landed in `auth.users.email`, `email_confirmed_at` set, **NO OTP sent**. The current code path is correct and OTP-free.
- Live data: 902 registered users have phone but NO email; only 12 have both. → Those 902 registered with an **OLDER app build** that still ran the OTP-triggering `updateUser({email})` (now commented out). The fix is in source but must SHIP in a new release to reach users.
- Code hardening applied: retry the invoke once on transient failure + `console.warn` instead of silent swallow (src/api/auth.ts ~482).
- **ACTION FOR OWNER: cut a new release** — the fix only reaches users via an updated build.

---

## Phase 1 — Registration email actually saves (item 2) [DONE — investigation-first]
**Symptom:** email not appearing in admin user management after registration.
**Findings:** the code path is correct in principle — `register()` (src/api/auth.ts:436) calls the
`register-set-email` edge function (service-role `updateUserById(..., email_confirm:true)`), and it's
**best-effort with a swallowed catch** (auth.ts:482–486). So a silent failure here loses the email
with no error surfaced. No OTP is involved (confirmed — the direct `updateUser({email})` OTP path is
commented out). Registration uses **phone** as the identifier; email is optional.

**Steps**
1. Verify on the live project whether `register-set-email` is actually **deployed** and `verify_jwt=true`
   (query the functions list / invoke with a test token). Most likely root cause: not deployed, or
   deployed with wrong verify flag, or CORS/anon-key env missing → invoke fails → swallowed.
2. If not deployed: deploy it (multipart deploy, mirrors delete-account).
3. Make the failure **observable**: keep it best-effort for the user, but log the invoke error and
   surface a soft note on the profile ("لم يتم حفظ البريد، يمكنك إضافته من الملف الشخصي") when
   `savedEmail` came back empty despite a non-empty input.
4. Confirm email lands in `auth.users.email` and shows in admin `users.tsx`.

**Verify:** register a new account on-device (needs data ON briefly), confirm the email appears in
admin panel. Regression test for the "email input non-empty but unsaved → no false email claim" invariant.

---

## Phase 2 — Offline cold-start no longer hangs on splash (item 9) [highest value]
**Symptom:** app opens fine if it goes offline *after* launch, but a *cold* launch after a long offline
period (or connected-but-no-data) hangs forever on the splash/loader.
**Findings:** `SessionGate` (app/_layout.tsx:214–266) holds behind `BootLoader` until
`sessionReady`. Offline readiness relies on `ensure.isError` (fall-through). The hang comes from
two places: (a) `useCurrentUser`/`getSession` or the anon `ensure.mutate()` network call has **no
fast timeout** offline — it stays `isLoading` / pending instead of erroring, so neither `!!user` nor
`ensure.isError` ever becomes true; (b) query-cache hydration / GoTrue lock contention can stall.

**Steps**
1. Add a **hard boot timeout** (e.g. 4–6s): if neither session nor error resolves within it, fall
   through to the app with whatever persisted session/cache exists (mirror the existing
   `withAuthTimeout` used for sign-in hang — see memory `v17-auth-signin-hang`).
2. Ensure `getSession` (offline, reads persisted tokens) is the readiness signal, not a network call.
   The persisted anon session must make the app usable with the persisted query cache.
3. Keep the existing `onReconnect` retry so it converges once data returns.
4. Handle **connected-but-no-internet** (socket opens, no data): the timeout covers it; verify the
   audio/download reads don't block boot.

**Verify (device, data OFF):** cold-launch after long offline + airplane-mode + wifi-no-data; app
must reach Home with cached content and play a downloaded lecture. This is the primary acceptance test.

---

## Phase 3 — Notes/questions/benefits refresh on auto-advance (item 3)
**Symptom:** on auto-advance to the next lecture the player updates but the lesson tools
(notes / questions / benefits) keep showing the *previous* lecture until a manual refresh.
**Findings:** player reads `useLecturePlayback(id)` (player/[id].tsx:114); the lesson tools
(`LessonToolsRow`, `PlayerUtilityBar`, and the notes/questions/benefits sub-screens) are keyed off
`lectureId`. On auto-advance the store's current track id changes but the route param `id` (and thus
the tool hooks) isn't re-driven, so stale data persists.

**Steps**
1. Make the lesson-tools hooks subscribe to the **playing track id from the player store**, not just
   the route `id`, so an in-place auto-advance re-queries notes/questions/benefits for the new lecture.
2. **Prefetch** the next lecture's notes/questions/benefits before the current one ends (near the 95%
   completion threshold) via `queryClient.prefetchQuery`, so the swap is instant.
3. **Offline suggestion (documented + implemented):** for downloaded lectures, notes/questions/benefits
   are the offline-cached copies from the persisted query cache; on auto-advance read straight from that
   cache (no network). Where a lecture was never opened online, show the calm "متاح دون اتصال بعد فتحه
   مرة" empty state rather than stale data.

**Verify (device):** queue two lectures, let the first auto-advance, confirm tools swap without refresh,
online and offline.

---

## Phase 4 — Companionship requests page + notification routing (items 1) [dedicated page]
**Findings:** buddy request/accept notifications route to `/` (0020 migration → Home BuddyCard).
Owner wants a dedicated requests-management page.

**Steps**
1. New screen `app/(student)/buddy-requests.tsx`: lists **incoming** (with profile preview +
   قبول/اعتذار via `respond_buddy_request`) and **outgoing** pending requests (0087). Reuse
   `BuddyCard`/buddy hooks; RTL, 12px stack spacing (memory `twelve-px-element-spacing`).
2. New migration: re-point the `data.route` in `send_buddy_request` **and** `respond_buddy_request`
   (and any accepted-notification) from `/` → `/(student)/buddy-requests`. Append-only; then run
   security-check.
3. Deep-link handler in `_layout.tsx` already forwards `data.route` (line 410) — verify the new route
   resolves. Also make tapping a request row in the list open the management view.
4. Add an entry point to the page from Home BuddyCard ("إدارة الطلبات") and/or journey.

**Verify (device):** send a request between the two connected devices, tap the notification → lands on
requests page → accept → sender gets the accepted notification that also lands there.

---

## Phase 5 — Q&A privacy clarity + admin controls (items 6, 7, 8)
Grouped: all touch the questions board + admin questions screen.

**6 — hide-name clarification (client only):** when the "إخفاء الاسم" toggle is on at ask time, show
an inline note that the name is hidden from the sheikh **and** everyone (anonymity is end-to-end).
Edit copy on the ask sheet in `QuestionsBoard.tsx`.

**7 — admin flip private→public:** add an admin action in `app/admin/questions.tsx` to change a
question's visibility. Migration: RPC (DEFINER, admin-only) `set_question_visibility(question_id, public)`.

**8 — admin reveal questioner name:** by default names stay hidden even from admin (0077 full
anonymity). Add an admin-only RPC + button `reveal_question_author(question_id)` that returns the
display name for admin review **without** making it public to students. Respect the existing
anonymity guard — this is a deliberate, logged admin override.

**Verify (admin web + device):** ask an anonymous question, confirm the clearer copy; as admin flip it
public and reveal the name.

---

## Phase 6 — Report an error in the sheikh's answer (item 4)
**Findings:** answers live in `question_answers` (multi-answer thread, V18). Reports infra + blocked-word
moderation already exist (`ReportSheet.tsx`, content reports).

**Steps**
1. Add a "الإبلاغ عن خطأ في الإجابة" action on a sheikh answer (reuse `ReportSheet` pattern).
2. Migration: `report_answer(answer_id, note)` RPC → inserts a report row + notifications to **both**
   the answering sheikh and admins (type reuse or a new `answer_report` enum value; honour prefs +
   best-effort insert like 0016/0020).
3. Surface in admin moderation queue for review/modification.

**Verify:** student reports an answer → sheikh + admin both receive the notification.

---

## Phase 7 — Audio clips in helpful reminders / التذكيرات (item 5) [R2 upload]
**Findings:** reminders/broadcasts already carry image + link button (memory
`v13-r2-storage`). R2 upload pipeline exists (`r2-upload-url`).

**Steps**
1. Admin reminders composer (`app/admin/reminders.tsx`): add an **audio attachment** field that uploads
   to R2 via the existing signed-URL flow; store the R2 key on the broadcast/reminder row (new column,
   append-only migration).
2. Client: inline audio player in the reminder detail / inbox item with **play/pause, speed control,
   and a seekbar** (reuse player rate + seek primitives; a small controller, not the full player).
3. Signed read URL via `r2-read-url` on demand.

**Verify (device):** admin attaches an audio reminder → student plays it inline with speed + seek.

---

## Phase 8 — Notes → support-ticket system (item 10) [extend feedback; largest]
Confirmed: build on the existing student **feedback inbox** (0060/0061), not lesson notes.

**Steps (migrations, append-only, then security-check)**
1. Schema: extend feedback into `tickets` with `status` enum (`open`, `under_review`,
   `awaiting_student`, `closed`), plus a `ticket_messages` thread table (student + admin turns),
   optional `image_url` (R2) on admin replies, and an optional CTA (`cta_label`, `cta_route/url`) on
   admin replies. RLS: student sees own tickets/messages; admin sees all + can reply/close.
2. Auto-create a ticket when a student submits a note/feedback (status `open`).
3. Admin (`app/admin/feedback.tsx` → ticket detail): reply, attach image (R2), add CTA button,
   change status / close.
4. Student side: new `app/(student)/tickets.tsx` (list) + ticket detail (thread, reply, tap CTA);
   entry point from profile. Notifications to the student on admin reply (existing pipeline;
   deep-link route → the ticket).
5. Statuses drive calm badges/labels; RTL + 12px spacing.

**Verify (admin web + device):** submit a note → ticket appears for student & admin → admin replies
with image + CTA + status change → student gets notification, opens ticket, taps CTA, replies →
admin closes it.

---

## Cross-cutting
- Every fixed item that lives in testable logic gets a regression test (Jest), asserting Arabic copy.
- Arabic-first throughout; no English leakage; calm non-gamified tone.
- Device verification on the connected phones (data OFF) is the acceptance gate for 1, 3, 5, 9.
- Record deployed-beyond-repo state (edge functions, live migrations, live-only columns) in memory.
