# PLAN 3 — High-Priority Functional Bugs

Source: on-device student journey testing (release build, live backend),
two-device رفيق pairing test, and admin-web browser testing. These are real,
reproduced bugs — not style/polish. Fix in the order listed; Phase 3.1 is the
most user-visible (core playback feature).

---

## Phase 3.1 — Resume position mismatch (guest sessions)

**Repro (3/3, fully reliable):** as a guest, play a lecture to a distinct
position (e.g. 2:45), pause, force-stop the app, relaunch, tap the Home
resume card ONCE.
- **Expected:** playback resumes at (or very near) the position shown on the
  resume card.
- **Actual:** the resume card correctly shows the advancing saved position
  each time (e.g. ١:٢٢, then ٣:٠١, then ٢:٤٥ across three separate runs), but
  actual playback ALWAYS restarts from a stale ~82 seconds regardless of what
  the card displayed. Confirmed via both the player UI and
  `logcat` (`MediaSession position=82011/82821ms`). `error=null` on every
  run — this is not a network/loading failure, it's two different parts of
  the app disagreeing about where the user actually stopped.

**Root cause direction:** the Home resume card's displayed position and the
player's actual resume-seek value read from two different sources that fall
out of sync. Investigate `src/lib/audioController.ts` (resume-seek logic —
where does it read the "start position" from when a lecture is opened via
the resume card?) versus wherever the Home resume card computes its
displayed position (likely `src/api/progress.ts` / `src/hooks/useJourney.ts`
or similar) — the card appears to read fresh, advancing data while the
player's actual seek-on-open uses a stale cached value.

**Important scoping note from testing:** this was reproduced specifically
for a **guest** (anonymous) session, where `user_lecture_progress` showed
**zero server writes** during the whole test even though the resume card
kept advancing — i.e. guest progress display is driven by something
client-local (likely a Zustand store or local cache) that isn't the same
value the player reads on resume-seek. A dedicated **signed-in** repro of
the exact same steps was NOT run during testing (economy constraints) —
signed-in progress IS confirmed to write to the server correctly elsewhere
in testing, so signed-in resume is *plausibly* fine, but this needs a
direct verification pass as part of this fix, not an assumption. Test both
guest and signed-in explicitly before closing this out.

**Fix + verify:**
1. Trace exactly what value populates the Home resume card (probably a
   query/local-store read) vs. what value `audioController`'s "open at
   resume position" path reads when the player mounts from a resume-card tap.
2. Make both read from the same single source of truth.
3. Re-test the exact repro above for BOTH a guest session and a signed-in
   session (qa-student-a or equivalent), 2-3 times each, confirming the
   played position always matches the card.

---

## Phase 3.2 — Admin web: role-change and account-suspend silently do nothing

**Page:** `/admin/user/[id]` (web admin dashboard).

**Repro:** as admin, open any user's detail page, click a role chip (e.g.
«ناشر» to promote to publisher) or the تعطيل/تفعيل الحساب (suspend/activate)
control. Nothing visibly happens — no confirmation dialog, no error, no
change. Verified server-side: `profiles.role` is unchanged after the click.

**Root cause (confirmed):** the confirm-gated callback uses
`Alert.alert(...)` imported from `react-native`. On `react-native-web`,
`Alert.alert` is a **no-op stub** (`static alert() {}`) — it silently does
nothing in a browser, so the confirmation dialog (and therefore the whole
role-change/suspend flow, which is presumably gated behind the user
confirming in that dialog) never fires on web. This is completely silent —
no console error either, which is why it wasn't caught earlier.

**Fix:** replace every `Alert.alert(...)` confirmation in the admin
user-management flow with the project's own `ConfirmDialog` component
(already used successfully elsewhere in the admin dashboard — lecture,
section, quiz, and featured-item deletes all use it and work correctly on
web). Likely file: `app/admin/user/[id].tsx` or a shared admin-users
component — search for `Alert.alert` across `app/admin/` to find every
instance (there may be more than the two confirmed: role-change and
suspend/activate).

**Verify:** on web, promote a throwaway test user's role, confirm the
`ConfirmDialog` appears, confirm it, and confirm `profiles.role` actually
changes server-side. Repeat for suspend/activate. Do NOT test this against
a real user account — create a temporary one and delete it after.

---

## Phase 3.3 — Admin web: sheikh dropdown clipped on the upload form

**Page:** `/admin/upload`.

**Repro:** pick an audio file, open the «اختر الشيخ...» (choose sheikh)
dropdown. Only the first 2 of 4 sheikhs are visible/clickable — the rest
render underneath the «المرفقات» (attachments) card, which intercepts
pointer/click events on top of them.

**Root cause:** the dropdown is likely an inline, absolutely-positioned
`View` that doesn't escape its parent's stacking context, so a sibling card
below it visually and interactively overlaps the lower dropdown items.

**Fix:** render the sheikh dropdown in a `Modal` or portal-based overlay
instead — the same pattern the codebase already uses successfully elsewhere
for a similar tree/list picker (look for `TreePicker` or similar in
`src/components/admin/` and mirror its approach).

**Verify:** on the upload form, open the sheikh dropdown and confirm all 4
seeded sheikhs are visible and clickable, and that selecting one actually
sets `sheikh_id` on the saved lecture (there's currently a documented
workaround of assigning the sheikh afterward via the lecture editor — after
this fix, direct selection during upload should also work and can replace
that workaround, but don't remove the editor's own sheikh-chip assignment,
just fix the upload-time picker).

---

## Phase 3.4 — Stale offline query cache can display deleted/unpublished content

**Observed directly during rafiq two-device testing:** a test lecture
("درس اختبار الإصدار النهائي") created and later fully deleted (verified gone
server-side via direct database query) continued to appear on a student
device's Home screen — both in the "أضيف حديثاً" (recently added) rail and
the section's lecture list — while the device was online (wifi + mobile data
both on). A force-stop + relaunch on a *different* device did NOT show the
stale entry, suggesting the first device's issue was specifically a
persisted cache that hadn't been invalidated/reconciled, not a live server
read.

**Root cause direction:** `app/_layout.tsx`'s `PersistQueryClientProvider`
persists several query roots to `AsyncStorage` with a 30-day `maxAge`,
including `'lectures'` and `'home'` (see `PERSISTED_QUERY_ROOTS` around
`app/_layout.tsx:58-73`). The persistence mechanism appears to only ever
*add/update* cached entries, with no equivalent "this item no longer exists,
remove it from the persisted cache" (tombstone) handling — so a deleted
lecture that was cached before deletion can survive indefinitely in a
device's local cache even while the app is online and other data is
visibly fresh.

**Fix direction (needs investigation, not a one-line patch):**
1. Confirm the theory: check whether `get_home_page` / `get_section_page`
   RPCs return a full replacement list each call (they should, per the
   V10/V11 offline-perf work) — if so, TanStack Query's normal behavior on
   a successful refetch is to replace the cached data for that query key
   entirely, which *should* drop a deleted item. Investigate why that
   didn't happen here: was the specific query never actually refetched
   (still within its `staleTime` window even after a force-stop, because
   `PersistQueryClientProvider`'s `maxAge` restore treats it as fresh), or
   is there a merge/dedup step somewhere that only adds and never fully
   replaces?
2. Check `staleTime` configuration for the `'home'` / `'lectures'` /
   `'section'` query roots — if it's long enough that a cold relaunch still
   serves the persisted snapshot without a background refetch, that would
   explain indefinite staleness for exactly the kind of "removed by admin"
   case this app needs to handle (unpublish/delete are core admin actions
   per the MVP spec).
3. Fix so that a background refetch reliably reconciles (adds AND removes)
   stale entries within a reasonable window while online — this doesn't
   need to be instant, but "indefinitely" is too long for admin-deleted
   content to keep appearing to students.

**Verify:** publish a test lecture, confirm it appears on a student device,
delete it via admin, then on the student device do a normal cold relaunch
(force-stop + reopen, online) and confirm it disappears within one relaunch
— not requiring an app reinstall or cache-clear.

---

## Phase 3.5 — Intermittent audio-load hang ("Source error")

**Repro (intermittent, not 100%):** opening a specific lecture
(المجلس السابع عشر, though likely not file-specific — see below) sometimes
shows a perpetual buffering spinner that never advances, for ~2 minutes
observed. `logcat`: `PlaybackState state=ERROR(7) error="Source error"`.
Re-tapping did not recover; the user would be stuck until leaving the screen
or restarting the app. The SAME lecture played fine later in the same
session via auto-advance from the previous track — so the audio file itself
is not corrupt; this is a transient load failure in the player, not a
content problem.

**Fix direction:** add a recovery path in the player for a `Source error`
/ load-failure state — at minimum, detect the error state and show a retry
affordance (button or automatic retry with backoff) instead of leaving the
user on an indefinite spinner. Investigate `src/lib/audioController.ts`'s
`onStatus` handler / error callback wiring to see whether error states from
`expo-audio` are currently surfaced anywhere or silently swallowed.

**Verify:** hard to reliably reproduce (intermittent) — at minimum, confirm
that if this state is manually triggered (e.g. by simulating a load error or
testing on a throttled/flaky network), the app now shows a recoverable state
instead of an indefinite silent spinner.

---

## Phase 3.6 — Guest → registered account: partial progress loss

**Repro:** as a guest, complete enough listening that a section shows 67% (2
of 3 lectures done). Register a new account through the in-app flow.
Immediately after, the same section shows 33% (1 of 3) — one guest
completion was lost during the guest-to-registered transition.

**Root cause:** consistent with Phase 3.1's finding that guest progress is
local-only (no `user_lecture_progress` server writes during a guest
session) — registration presumably carries over *some* local state but not
all of it reliably.

**Fix direction:** when a guest registers, ensure ALL locally-tracked
progress (not just some of it) is migrated to the newly-created account's
server-side `user_lecture_progress` rows before/immediately after the
account is created — this is likely the same underlying local-vs-server
data source split identified in Phase 3.1, so fixing that root cause first
may resolve this too. Treat as a related but separately-verifiable bug:
after fixing 3.1, re-run this exact guest→register repro (get a section to
a known %, note exactly which lectures are marked complete, register, and
confirm the same lectures are still marked complete afterward — not just
the same percentage, since two different lectures each contributing 33%
would look identical in the percentage but be a different bug).

---

## Phase 3.7 — Offline: opening a non-downloaded lecture gives no feedback

**Repro:** while offline (wifi + data both off), tap a lecture that was
never downloaded. The player screen opens with blank title/metadata and a
perpetual spinner — no crash, but also no calm message explaining why
playback can't start.

**Fix:** detect this case (offline + lecture not in the local downloads
store) and show the same calm "لا يمكن التشغيل بدون اتصال" (or similar,
matching the app's established tone per `CLAUDE.md`'s "calm, non-competitive
tone" guidance) messaging pattern already used elsewhere for offline states,
instead of opening a blank/spinning player.

**Verify:** offline, tap a non-downloaded lecture → calm message, no blank
player. Tap a downloaded lecture while still offline → plays normally
(already confirmed working).
