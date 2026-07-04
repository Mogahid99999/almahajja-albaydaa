# Plan: V7 — التذكيرات النافعة (beneficial reminders) + notification reliability + streak nudges + closable mini-player

**Date drafted:** 2026-07-03
**Target:** Android standalone RELEASE, device R5CX10P3BPL (a Samsung/One UI phone),
`USE_MOCK=false`. Migrations continue after the latest existing one — **current
max is 0031, so new migrations start at 0032** (confirm at start).

**This plan is fully decided — the implementing agent must NOT ask the user
questions.** Every choice is locked to the best-recommended option; proceed
autonomously (the only thing to request if missing is the Supabase access token).
Keep the calm, non-competitive Islamic tone; no spammy over-notifying; Arabic UI
strings stay Arabic. All data-access via `src/api/*`; cross-user reads/fan-outs
are server-side SECURITY DEFINER RPCs. Append-only migrations — **never edit
0001–0031.** New enum values need their own migration/transaction step first.

---

## Architecture facts (verified in code — build on these)

- **Server push pipeline is healthy and type-agnostic:** migration 0009 puts a
  trigger on EVERY `public.notifications` INSERT → `net.http_post` to the
  `notify-on-publish` Edge Function → `push_tokens` → Expo Push → FCM. There is
  **no type filter** — so *any* row pushes. `new_lecture` working proves the
  whole path works; other server types push too **if their rows get inserted**.
- **The reminders that "never arrive" are DEVICE-scheduled**, not server:
  `scheduleResumeReminders` + `scheduleSeriesReminder` (from the save-progress
  seam, `src/api/progress.ts`), `scheduleDailyReminder` (app-open in
  `app/_layout.tsx` + the prefs toggle). They use `expo-notifications`
  TIME_INTERVAL triggers at **6h / 16h / 24h / 72h / 168h**. On Samsung/One UI,
  Doze + "sleeping apps" battery optimization **defers or drops** these
  AlarmManager alarms once the app is backgrounded → they effectively never fire.
- **The floating bubble genuinely no-ops:** `src/lib/bubble.ts` needs the native
  overlay module `native/floating-bubble` (prebuild + SYSTEM_ALERT_WINDOW), which
  isn't linked. It is experimental and OFF.
- **Weekly-goal is already server-cron** (migration 0013, `pg_cron` job
  `weekly-goal-nudges`, daily 16:00 UTC) → inserts `weekly_goal` rows → push.
  This is the reliable pattern to copy.
- **notify-on-publish (v5)** already sets a launcher `badge` for `new_lecture`.
  **Player store** has `reset()` (`src/stores/playerStore.ts`); the MiniPlayer
  (`src/components/MiniPlayer.tsx`) currently has next + play/pause but **no
  close**. Notification inbox renders per-type via
  `src/components/notifications/labels.ts` (label/desc/icon/order) — V6 already
  added the question types there.

---

## Locked diagnosis + strategy for "only new-lecture notifications work"

Two independent gaps, fixed two ways:

1. **Device-scheduled reminders are unreliable on Samsung.** → **Move the
   important time-based reminders to server-side `pg_cron` → `notifications`
   INSERT → push** (the proven path). Reliable even when the app is closed/killed.
   Keep only truly in-session presentations local (completion praise, goal
   congrats — they fire while the app is open, no delay, always work).
2. **Some server types were simply never triggered in testing (or pg_cron isn't
   firing).** → **Verify the pipeline live and per-type**, and fix whatever is
   actually broken (see Fix 1 steps). Do NOT assume — check `cron.job` +
   `cron.job_run_details`, confirm `push_tokens` rows exist for test users, and
   trigger one of each server type end-to-end.

**Floating bubble:** out of scope to make work (needs a native overlay module +
runtime consent). Leave it OFF and deliver the value through reliable push;
note native linking as a separate optional effort. Do NOT spend this batch on it.

---

## Fix 1 — Make every notification type actually work (reliability)

**Diagnose (do FIRST, live):**
- `select jobname, schedule, active from cron.job;` and
  `select * from cron.job_run_details order by start_time desc limit 20;` — is
  `pg_cron` enabled and is `weekly-goal-nudges` running without error? (If pg_cron
  isn't firing, weekly-goal + all future crons are dead — that alone is a bug.)
- Confirm `push_tokens` has a row for the test device's user (registration in
  `NotificationsBootstrap`), and that Android runtime notif permission is granted.
- Trigger one of each **server** type and confirm the push + inbox row:
  new_attachment (publish an attachment to a followed section), new_quiz (publish
  a quiz), buddy_request/buddy_activity (two accounts), weekly_goal (invoke
  `dispatch_weekly_goal_nudges()` directly).

**Fix — convert time-based reminders to server cron** (new migration(s)):
- **Resume/continue nudges:** a `dispatch_resume_nudges()` DEFINER function +
  `pg_cron` (e.g. daily ~10:00 local) that finds students with an in-progress
  lecture (`user_lecture_progress` not completed, position>0, not touched in
  >~1 day), pref `resume_reminder` ON, and inserts a `resume_reminder`
  notification deep-linking to the lecture at its saved second (dedup per
  lecture/day). Replaces the unreliable device ladder as the primary path;
  the local ladder may stay as a best-effort backup but is no longer relied upon.
- Keep **completion_praise** + **goal congrats** local (in-session).
- After moving to cron, the reminder types push reliably via FCM.

*(Android hardening for any remaining local notifications is secondary: add
SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM + a one-time battery-optimization exemption
prompt. Prefer server cron over relying on this.)*

**Files:** new migration `00NN_reminder_crons.sql`; verification only for the
client (no client change needed for delivery — tokens already register).

---

## Fix 2 — Daily streak (المداومة) keep-alive reminders (server cron)

Add a gentle evening reminder so a student doesn't lose their streak.

- **Enum:** add `streak_reminder` to `notification_type` (own migration step).
  Default ON (`defaultNotificationEnabled`), labelled in `labels.ts`
  (e.g. label «تذكير المداومة», icon `zap`/`sunrise`, desc «تنبيه لطيف كي لا
  تفقد مداومتك اليوم»).
- **Cron:** `dispatch_streak_reminders()` DEFINER + `pg_cron` at ~**17:00 local**
  (14:00 UTC): for each student whose pref is ON, who has a **current streak ≥ 1**
  (via `streak_for_user`) **and has NOT done meaningful activity today**
  (`daily_listening` for today, `meaningful`), and (optionally) students inside
  the **recovery window** who can still save it — insert a `streak_reminder`
  notification, deep-link `route:'/(student)'` (Home streak card). Dedup once per
  user per day (reuse a small state table or a `notifications` existence check for
  today, like 0016 does). Quiet-hours safe (skip 23:00–05:00 — the 17:00 slot is).
- **Copy (rotate, calm — pick 4–6):**
  - «أنجز ولو اليسير اليوم حتى لا تفقد مداومتك»
  - «حافظ على مداومتك، ولو بدرسٍ قصير»
  - «بقيت خطوةٌ صغيرة لتُبقي مداومتك اليوم»
  - «مداومتك أمانة، أكمل اليوم ولو قليلاً، ولك الأجر»
  - «لا تدع مداومتك تنقطع، يسيرٌ يكفي»
  - (recovery) «يمكنك استعادة مداومتك اليوم، فبادر قبل أن تفوت»

**Files:** enum migration + `00NN_reminder_crons.sql` (same file as Fix 1 is
fine), `src/api/types.ts`, `src/components/notifications/labels.ts`.

---

## Fix 3 — Closable mini-player

The bottom MiniPlayer can't be dismissed while browsing.

- **audioController:** add `stop()` — pause, persist the final position, release
  the player (`player.pause()`; drop the lock-screen via
  `setActiveForLockScreen(false)`), and `usePlayerStore.getState().reset()` so
  `currentLectureId` becomes null and the MiniPlayer unmounts.
- **MiniPlayer:** add a small **×** (close) control on the leading edge that calls
  `stop()` (with `e.stopPropagation()` so it doesn't open the full player).
  Calm styling, `accessibilityLabel="إغلاق المشغل"`.

**Files:** `src/lib/audioController.ts`, `src/components/MiniPlayer.tsx`.
Verify on device: playing → tap × → audio stops, bar disappears, lock-screen
controls clear.

---

## Feature — التذكيرات النافعة (beneficial reminders broadcast)

Admin/publisher broadcast messages to ALL users about virtuous seasons/sunan
(عاشوراء، عرفة، سنن الجمعة …). Distinct from activity notifications.

### Data (migrations 0032 enum → 00NN schema)
- **Enum:** add `beneficial_reminder` to `notification_type` (own migration step,
  with `streak_reminder` above). Label «تذكير نافع», icon `star`/`sunrise`, desc
  «تذكيرات نافعة من إدارة المنصة».
- **`public.broadcasts`:** `id uuid pk, title text not null, body text not null,
  show_on_home bool default false, created_by uuid references auth.users,
  created_at, updated_at, published_at timestamptz null, deleted_at timestamptz
  null`. RLS: read `to authenticated using (deleted_at is null)`; **write via
  DEFINER RPCs gated on `is_content_manager()`** (admin OR publisher — they may
  create/edit/delete, per the ask), NOT raw table writes.
- **RPCs:**
  - `create_broadcast(title, body, show_on_home) → id` (is_content_manager);
    sets `published_at = now()` and **fans out**: inserts one `notifications` row
    (type `beneficial_reminder`, `data.route='/(student)/reminder/'||id`) per
    `profiles.role='student'` → the 0009 webhook pushes each. (Reuse the 0007
    fan-out pattern.)
  - `update_broadcast(id, title, body, show_on_home)` (is_content_manager) —
    edits the record (existing inbox rows already sent; the detail page reflects
    edits).
  - `delete_broadcast(id)` (is_content_manager) — soft-delete (`deleted_at`);
    optionally also delete its `notifications` rows.
  - `get_home_broadcasts()` — active home cards: `show_on_home` AND
    `published_at > now() - interval '1 day'` AND not deleted. (The 1-day home
    window.)
  - `get_broadcast(id)` — the full reminder for the detail page.

### Client
- **NotificationType** += `beneficial_reminder` (+ `NOTIFICATION_TYPES`,
  `defaultNotificationEnabled` ON, labels.ts). Deep-link in `app/_layout.tsx`:
  `beneficial_reminder` → the carried `route` (`/(student)/reminder/[id]`).
- **Detail screen:** `app/(student)/reminder/[id].tsx` — a calm page with the
  title + full body (motif styling like the About page). Opened from the shade,
  the in-app inbox row, or the home card.
- **Home card:** a `BroadcastCard` on Home (`app/(student)/index.tsx`) rendered
  from `get_home_broadcasts()` — a short, calm brass-accented card ("تذكير نافع"
  eyebrow + title + a line of the body) that opens the detail; auto-disappears
  after 24h (server window). Add a small × to dismiss locally (AsyncStorage set
  of dismissed ids) for good UX.
- **Inbox distinction:** give `beneficial_reminder` its own icon + a subtle
  «تذكير نافع» tag/accent in the notifications list so it reads apart from
  progress/lecture/quiz rows (don't fully separate — just distinguish).
- **Admin/publisher screen:** `app/admin/reminders.tsx` («التذكيرات النافعة») —
  list + create (title, body, toggle «إظهار كبطاقة في الرئيسية») + edit + delete,
  with a confirm on delete. Add a nav item in `AdminShell` visible to **admin AND
  publisher** (it's content). `src/api/broadcasts.ts` + `src/hooks/useBroadcasts.ts`
  (+ queryKeys). Reuse the responsive admin patterns.

---

## Build order

```
Step 0   (No AskUserQuestion — decisions are locked.)
Step 1   DIAGNOSE live (pg_cron health, push_tokens, per-type trigger test) — Fix 1.
Step 2   DB enums (00NN): notification_type += 'streak_reminder', 'beneficial_reminder' → apply live.
Step 3   DB (00NN): broadcasts table + create/update/delete/get_home/get RPCs → apply live.
Step 4   DB (00NN): dispatch_streak_reminders() + dispatch_resume_nudges() + pg_cron jobs → apply live; regen types.
Step 5   Client notifs: NotificationType + labels + defaults + deep-links (reminder route).
Step 6   Mini-player close: audioController.stop() + MiniPlayer × (Fix 3).
Step 7   Beneficial reminders: api/hooks + detail screen + Home BroadcastCard + inbox distinction.
Step 8   Admin/publisher reminders screen + nav item.
Step 9   Notification prefs: expose the new toggles (streak_reminder, beneficial_reminder default ON).
Step 10  typecheck → release build → install on R5CX10P3BPL.
Step 11  Device-verify: each server type pushes; streak reminder fires (invoke the dispatcher
             manually to test now); broadcast → push + shade tap → detail + home card (24h);
             mini-player × closes playback. Note what needs a 2nd account / a waiting period.
```

**Verification note:** to test the crons without waiting, invoke
`dispatch_streak_reminders()` / `dispatch_resume_nudges()` directly via the
Management API and confirm the push + inbox row on the device. Beneficial-reminder
fan-out is immediate on create — verify the push, the shade-tap → detail, the home
card presence (and that it's gone after 24h / when dismissed).
