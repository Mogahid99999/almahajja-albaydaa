# PLAN V3 — Notifications Revamp (المَحجّة البَيْضَاء)

> Expo SDK 56 + Supabase (USE_MOCK=false). Student = Android standalone build (NOT Expo Go).
> Supabase ref `prpyxnxgkpspjoxvcaro` · Android package `com.riwaqalilm.app` · EAS projectId `bd220e01-9d37-428a-9155-02c8b8e67e72`.
> **Plan only — no code changes yet.** This revises the EXISTING notification system (local + in-app fanout + FCM push, all already live and device-verified).
> Out of scope (do NOT touch): streak system, quiz notifications.

---

## 0. Current state (verified against the code, not assumed)

**Local layer** — `src/lib/notifications.ts` (real-build only; no-ops on web/Expo Go):
- `scheduleResumeReminder(lectureId,title)` — single variant, 24h, title `"لا تنسى درس اليوم، بارك الله فيك"`, deterministic id `resume-<id>`.
- `presentCompletionPraise(title)` — immediate, `"أكملت الدرس، نفعك الله بما سمعت"`.
- `scheduleSeriesReminder(sectionId,title)` / `cancelSeriesReminder` — 24h, `"تابع سلسلتك العلمية، بارك الله فيك"`, id `series-<id>`.
- `scheduleDailyReminder()` / `cancelDailyReminder()` — DAILY trigger at hour 19, id `daily-reminder`, single fixed phrase.
- `presentCompletionPraise` etc. all `sound:false`, channel `default` (calm, no badge).
- `getInitialDeepLink()` (cold-start) + `addResponseListener()` → `data.lectureId` → `/player/<id>`, `data.sectionId` → section. **No position carried.**

**Driver** — `src/api/progress.ts` `saveLectureProgress()` → `maybeUpdateReminders(lectureId, completed, justCompleted)`:
- in-progress → schedule resume; completed → cancel resume.
- justCompleted → completion praise (pref `completion_praise`); series reminder if a next lecture exists (pref `resume_series`), else cancel.
- All gated on `notification_prefs` (missing row = ON, except `daily_reminder` = OFF). All single-phrase.

**Types / prefs** — `src/api/types.ts` `NOTIFICATION_TYPES` (7): `new_lecture`, `new_attachment`, `new_quiz`(deferred), `resume_reminder`, `resume_series`, `completion_praise`, `daily_reminder`. Enum mirrored in DB (`0008`) + `database.generated.ts`. Prefs UI: `src/components/notifications/PrefsToggles.tsx` + `labels.ts`.

**Push / FCM (server)** — LIVE & verified:
- `fanout_to_all` (migration `0007`) inserts one `notifications` row per **all** students (pref-gated) on lecture publish / attachment add.
- Edge Function `notify-on-publish` deployed, `verify_jwt=true`. Single webhook trigger `notifications_push_webhook` (migration `0009`, pg_net → function, anon Bearer). FCM wired natively via app.json `googleServicesFile` + gms gradle plugin.
- `push_tokens` registers on sign-in (`app/_layout.tsx` bootstrap).

**Weekly goals** — `weekly_goals` table + `get_week_progress()` / `get_journey_summary()` RPCs (Sat→Fri week). Completion is **computed (current≥target), never stored**. No goal reminders exist.

**Player** — `app/player/[id].tsx`: `playLecture(id)` resumes from saved DB position. No `?t=` position param.

**Visual identity** — `expo-notifications` plugin has **no `icon`/`color` config** → default OS small icon + white. **No floating overlay anywhere** (no `SYSTEM_ALERT_WINDOW`, no overlay native module).

---

## 1. Diff-style summary (exists → change/add)

| Area | Today | Target |
|---|---|---|
| Resume reminder | 1 variant, 24h, wrong generic wording | 3 sub-variants (general / >70% near-completion / >3-day inactivity), correct banks, escalating schedule |
| Completion praise | 1 phrase, immediate ✅ | keep mechanism; swap to 4-phrase bank |
| Non-completion gentle | ❌ missing | NEW local type, soft "no-shame" bank |
| Daily general | DAILY@19:00, pref-OFF, 1 phrase, no reset rule | once/day **indefinitely while app unopened**, **reset on app open**, no cap, quiet-hours-aware, 3-phrase bank |
| Unfinished series | exists; only on completion if next exists; generic phrase | fire for any started-but-unfinished section; phrases with `[اسم السلسلة]` + `[عدد]` remaining |
| Weekly goal | ❌ no reminders | NEW: midweek nudge + 2-days-before nudge + completion congrats (stop after complete) |
| New content | broadcast to ALL students | broadcast to **everyone who has the app** (all users, pref-gated) — see §10 note (supersedes the earlier "progressed-only" idea) |
| Phrasing | one literal sentence/type | 3–4 variant bank/type, random or round-robin |
| Visual identity | default OS styling | brand small-icon + accent color (achievable); full brand styling on the bubble |
| Floating bubble | ❌ none | NEW Android overlay, resume-only, usage-gated, capped, quiet hours |
| Priority/conflict | none (each fires independently) | dispatcher: resume > weekly-goal > daily; lower deferred to next day |
| Deep-link | lectureId/sectionId only → resumes saved pos | carry `lessonId + positionSec + pausedAt`; open player **at exact second** |

---

## 2. Notification catalog (mechanism · trigger · bank · pref · deep-link)

| # | Type (key) | Mechanism | Trigger / rule | Phrase bank | Deep-link |
|---|---|---|---|---|---|
| 1a | resume_general | **Local** | paused in-progress, ≤70% → +T1 (e.g. 6h) | استئناف عام (4) | player@pos |
| 1b | resume_near (>70%) | **Local** | paused, >70% & not complete → +T1 | استئناف قريب (4) | player@pos |
| 1c | resume_longgap (>3d) | **Local** | still unfinished 3 days after last touch | استئناف انقطاع (3) | player@pos |
| 2 | completion_praise | **Local** (immediate) | crosses ≥90% | إكمال (4) | — |
| 3 | noncompletion_gentle | **Local** | abandoned mid-lesson, soft fallback after resume attempts | عدم الإكمال (3) | player@pos |
| 4 | daily_reminder | **Local** (repeating, reset-on-open) | once/day while app not opened | تذكير يومي (3) | home (or last lesson) |
| 5 | resume_series | **Local** | started section, lessons remain | متابعة سلسلة (2, with `[اسم]`/`[عدد]`) | section |
| 6a | goal_midweek | **Push (cron)** | mid-week & goal not met | هدف منتصف (2) | journey |
| 6b | goal_2days | **Push (cron)** | 2 days before week end & not met | هدف قبل يومين (2) | journey |
| 6c | goal_done | **Local** immediate (or push) | week current crosses target | هدف إكمال (1) | journey |
| 7a | new_lecture | **Push** | publish (any section) → **all app users** | محتوى جديد (1) | player |
| 7b | new_attachment | **Push** | attachment on published lecture → **all app users** | محتوى جديد (1) | lecture/attachment |
| — | bubble (resume) | **Local + native overlay** | usage-gated resume nudge | resume banks | player@pos |

(See §11 for the verbatim Arabic phrase bank.)

---

## 3. Local vs Push/FCM — confirmation

- **Local** (on-device, depend on the user's own playback/state, work offline, privacy-preserving): all resume variants, completion praise, non-completion, daily, unfinished series, goal completion-congrats, the bubble. ✅ correct to keep local.
- **Push/FCM** (server decides, cross-user, content events): new_lecture / new_attachment — correct mechanism, **targeting must change** (progressed-only). Weekly-goal *time-based* nudges (midweek, 2-days) are best **push via a scheduled cron** because they must fire on a weekly clock independent of app opens and depend on server-side aggregate progress. (Goal completion-congrats can be local-immediate on the save path since the crossing happens while the app is open.)
- **Decision to lock in the next session:** weekly-goal midweek/2-days = cron-push (recommended, reliable) vs all-local (no new infra but only re-evaluated on app open). Recommended: cron-push.

---

## 4. Phrasing variants (bank module + selection)

- New module `src/lib/notificationPhrases.ts`: export each bank as a typed `Record<event, string[]>` (verbatim from §11), with `[اسم السلسلة]`/`[عدد]`/`[اسم القسم]`/`[اسم الدرس]` placeholders interpolated at call time.
- Selection: `pickPhrase(event, key)` — **round-robin per event** (persisted index in AsyncStorage so consecutive notifications differ), falling back to random. Avoids the same literal sentence repeating.
- Refactor every existing local call (`scheduleResumeReminder`, `presentCompletionPraise`, series, daily) to pull from the bank instead of hard-coded strings. Push types (new_lecture/new_attachment) interpolate the bank in the Edge Function (or store the resolved title/body when the `notifications` row is inserted by the DB trigger — simplest: resolve in `fanout_*` SQL or the function).

---

## 5. Visual identity (system notifications + bubble)

**Reality check (important — manage expectations):**
- **System notifications cannot use a custom font.** Android renders notification text with the system font; the only way to override is fully-custom `RemoteViews`, and even then custom/embedded fonts are not reliably supported across OEMs/Android versions. **Custom-font system notifications are effectively not feasible** — do not promise this.
- **Achievable brand identity for system notifications** (via the `expo-notifications` config plugin, no native code): brand **small icon** (monochrome silhouette of the logo, white-on-transparent), brand **accent color** (`#1f4a42` teal or brass `#C9A463`), **large icon** = app icon, app name. Configure in app.json: `["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#1f4a42" }]`. Requires a rebuild.
- **Optional custom `RemoteViews`** (native, big effort) could give a branded background/colors + logo layout (still system font). Treat as a stretch; the icon+color route covers ~90% of perceived identity.
- **Floating bubble = our own View** → full freedom: app font (IBM Plex Arabic / Amiri), brand colors, logo, RTL. This is where true brand styling lives.

**Plan:** (a) add brand notification icon + accent color via the plugin (cheap win, do early); (b) build the bubble with full brand styling; (c) flag custom-font system notifications as not-feasible and out of realistic scope.

---

## 6. Floating overlay (bubble) — scheduling logic

**Purpose:** resume-lesson nudges only (dhikr-reminder style). Android-only (iOS has no equivalent; degrade to a normal local notification on iOS if ever needed).

**Rules:**
- **Usage-gated, never blind clock-scheduled:** only show while the device is actively in use — detect `ACTION_USER_PRESENT` (unlock) and app→foreground. Maintain a small native foreground/started service or a JS-side AppState + a native USER_PRESENT receiver.
- **Max 3 / day**, **≥ 2h gap** between bubbles, **quiet hours 21:00–07:00** (no bubbles).
- **Defer, don't fall back:** if a bubble's trigger time arrives while locked/inactive, queue it for the next real usage moment **the same day**; if the day ends, drop it (do NOT convert to a system notification).
- Eligibility: there is an in-progress, not-completed lesson (the resume target). Carries deep-link (lessonId + positionSec).
- Tap → open player at the exact position. A dismiss/✕ affordance; auto-dismiss after N seconds.

**Permission:** `SYSTEM_ALERT_WINDOW` (draw over other apps) — **cannot be silently granted**; Android opens a dedicated settings toggle. Needs an in-app consent/education screen + deep link to the overlay-permission setting; feature must degrade gracefully if denied.

**Implementation options (decide next session):**
1. Custom native module (Android `Service` + `WindowManager` `TYPE_APPLICATION_OVERLAY` + `USER_PRESENT` receiver) wrapped as an Expo config plugin — most control, most work.
2. An existing RN overlay lib (most are stale/Android-version-fragile) — faster but risky.
Recommended: option 1, gated behind a feature flag, shipped last.

---

## 7. Priority / conflict resolution (same-day)

Order: **paused-lesson resume > weekly goal > daily general.** At most ONE of these per day; lower-priority eligible ones **defer to the next day** (not stacked).
- Implement a single **"daily dispatcher"** that runs on every app→foreground: recompute eligibility, then (re)schedule the next day's single highest-priority reminder (cancel/replace lower ones), honoring quiet hours + per-type last-shown.
- Cross-mechanism caveat: resume+daily are local, goal nudges may be cron-push. To keep one source of truth, EITHER (a) make goal nudges local too (dispatcher owns everything), OR (b) the cron checks the same per-user state table before sending and respects the priority/last-shown. Recommended: dispatcher-owned local for resume+daily; cron consults `user_notification_state` for goal sends. Lock this in next session.
- The bubble is a separate channel (resume-only, own cap) and is NOT part of this once-per-day system reminder budget.

---

## 8. Deep-link with position (resume types + bubble)

- Notification/bubble `data`: `{ lessonId: string, positionSec: number, pausedAt: string }`.
- Player route: accept `t` (seconds) — e.g. `/player/<id>?t=<sec>`. On open: `playLecture(id)` then `seekTo(positionSec)` (guard: only override saved position if `t` provided & > saved). Extend `getInitialDeepLink()` + `addResponseListener` payload to include `positionSec`; the bootstrap pushes `/player/${lessonId}?t=${positionSec}`.
- Verifies the §6 "tap opens full player at exact position, not home" requirement (today it lands on home for cold-start; already partially fixed via `getInitialDeepLink`, extend with position).

---

## 9. DB / state fields needed

**Server (Postgres) — needed for push/cron + targeting:**
- **Last app open:** add `profiles.last_opened_at timestamptz` (or `user_engagement(user_id pk, last_opened_at)`); set via a tiny `src/api` call on app→foreground. Used by cron (goal nudges) and optionally to seed daily logic.
- **Weekly goal completion state (NEW table):** `weekly_goal_state(user_id, week_start date, midweek_sent_at, twodays_sent_at, congrats_sent_at, primary key(user_id, week_start))` — dedup each nudge + stop after completion. RLS own-rows; cron writes via service role.
- **Per-type last-sent (push types):** `notification_send_log(user_id, type, sent_on date, sent_at)` (or fold into `user_notification_state`) — so the cron respects once/day + priority.
- **Progressed-section targeting:** derive from existing `user_lecture_progress` (no new storage). New SECURITY DEFINER fn `students_progressed_in_subtree(p_section_id)` → user_ids with any progress on a lecture in that section's recursive subtree; replaces `fanout_to_all` for new_lecture/new_attachment.

**On-device (AsyncStorage / zustand-persist) — for local scheduling:**
- `lastAppOpenAt` (daily reset), `roundRobinIndex[event]` (phrase rotation), `lastShownAt[type]` (dedup/priority), `bubble: { dayKey, count, lastShownAt }` (cap 3/day + 2h gap), `scheduledIds[]` (manage cancel/reschedule).

**Mapping to the four asked-for fields:** last app open → DB `last_opened_at` (+ local mirror); last shown per type → local for local-types, DB `notification_send_log` for push-types; today's bubble count → local only (bubble is on-device); weekly goal completion → DB `weekly_goal_state`.

---

## 10. New-content targeting → BROADCAST to everyone who has the app

> **User update (supersedes original brief item 7):** new-content notifications are **NOT** restricted to progressed sections. They go to **everyone who has the app**. Do **not** build the progressed-subtree targeting; there is no `fanout_to_progressed` / `students_progressed_in_subtree` work.

- Keep the existing fan-out mechanism (`fanout_to_all`, migration `0007`) which already broadcasts on publish / attachment-add. Only adjustments:
  - **Audience = everyone with the app.** Current `fanout_to_all` filters `role = 'student'`. Broaden to all app users (every `profiles` row that has a registered `push_tokens` device, or simply all profiles), still **pref-gated** (`new_lecture` / `new_attachment` ON by default). Confirm whether admins should also receive (they are the publishers) — default: include all users with a push token, exclude the publishing admin if simple.
  - Apply the **phrase bank + round-robin** to the title/body (resolve in the fan-out SQL or the Edge Function).
  - **Wording note:** the bank line `"أُضيف درس جديد في [اسم القسم] الذي تتابعه"` says "الذي تتابعه" (that you follow). Since this now broadcasts to everyone (not just followers/progressed), drop or soften "الذي تتابعه" → e.g. `"أُضيف درس جديد في [اسم القسم]"`. Confirm final wording next session.
- Unclassified lectures (section_id null): still broadcast (no section to name) — wording without the section, or skip. Decide next session.
- Edge Function + webhook unchanged (still one auth'd push per `notifications` row).

---

## 11. Arabic phrase bank (verbatim — to live in `src/lib/notificationPhrases.ts`)

```text
استئناف عام (any %):
  "أكمل من حيث توقفت، ولك بكل حرف تسمعه أجر"
  "درسك بانتظارك، استكمل واغتنم الأجر"
  "خطوة واحدة تفصلك عن إكمال الدرس وأجره"
  "عد لدرسك، فالقليل المستمر خير من الكثير المنقطع"

استئناف قريب من النهاية (>70%):
  "اقتربت من إكمال الدرس، أكمل أجرك"
  "بقي القليل، لا تقطعه الآن وقد أوشكت"
  "أوشكت على الختام، أتمه ولك الأجر كاملًا"
  "خطوات يسيرة وتكتمل لك المحاضرة وأجرها"

استئناف بعد انقطاع طويل (>3 أيام):
  "ما زال درسك ينتظر استكمالك"
  "عد لدرسك متى ما تيسر، فالقليل المستمر خير من الكثير المنقطع"
  "لم يفتك الأجر بعد، درسك كما تركته"

إكمال الدرس:
  "أتممت الدرس، نفعك الله بما تعلمت"
  "ختمت هذا الدرس، تقبل الله منك"
  "أحسنت، أكملت درسًا جديدًا، نفعك الله به وزادك علمًا"
  "تم حفظ تقدمك، نفعك الله بما سمعت"

عدم الإكمال (تذكير لطيف):
  "توقفت قبل أن تكمل، عد إليه حين تستطيع وأجرك محفوظ"
  "لا بأس، أكمل لاحقًا، فالعلم لا يفوته إلا من ترك"
  "احفظ موضعك، ودرسك سينتظرك كما تركته"

تذكير يومي عام:
  "ألا تزور درسك اليوم؟ ولو لدقائق يكتب الله لك أجرها"
  "يوم جديد، وفرصة جديدة لطلب العلم وتحصيل أجره"
  "اجعل لهذا اليوم نصيبًا من العلم، ولو يسيرًا"

متابعة سلسلة لم تكتمل:
  "ما زلت في منتصف سلسلة [اسم السلسلة]، أكملها ولا تقطعها"
  "بقي لك [عدد] دروس من سلسلة [اسم السلسلة]، أكملها واغتنم أجرها"

الهدف الأسبوعي — منتصف الأسبوع:
  "أنت في منتصف الطريق نحو هدفك الأسبوعي، واصل ولك الأجر"
  "هدفك الأسبوعي قريب، لا تدعه يفوتك"

الهدف الأسبوعي — قبل يومين:
  "بقي القليل من الوقت لإكمال هدف هذا الأسبوع"
  "يومان وينتهي الأسبوع، أكمل ما تبقى من هدفك"

الهدف الأسبوعي — إكمال:
  "أكملت هدفك هذا الأسبوع، نفعك الله وبارك في وقتك"

محتوى جديد:
  "أُضيف درس جديد في [اسم القسم] الذي تتابعه"
  "أُضيف مرفق جديد يساعدك في [اسم الدرس]"
```

---

## 12. Phased rollout (with permission/consent flags)

1. **Phrase bank + variant selection** (`notificationPhrases.ts`, round-robin). Refactor existing local calls. *No perms. No new build needed for logic, but wording ships in next build.*
2. **Resume sub-variants + non-completion + completion bank + deep-link-with-position.** Player `?t=`. *No new perms.*
3. **Daily reminder rule rework** (reset-on-open, indefinite, quiet hours) + on-device state. *No new perms. (Avoid exact alarms → no `SCHEDULE_EXACT_ALARM`.)*
4. **New-content = broadcast to everyone with the app** (keep `fanout_to_all`; broaden audience beyond role=student; apply phrase bank; fix "الذي تتابعه" wording). *Server only; no app perms. No progressed-section targeting.*
5. **Unfinished-series** rework (rollup for remaining count) + phrases. *No perms.*
6. **Weekly-goal reminders** + `weekly_goal_state` + (recommended) **scheduled cron Edge Function** (pg_cron / Supabase scheduled function) + `profiles.last_opened_at`. *New infra; no app perms.*
7. **Visual identity:** brand notification icon + accent color via `expo-notifications` plugin config. *Rebuild required; no perms.*
8. **Priority/conflict dispatcher** (ties 1–6 together; one reminder/day by priority). *No perms.*
9. **Floating bubble** (LAST): native overlay module + `SYSTEM_ALERT_WINDOW` consent flow + usage detection + cap/gap/quiet-hours/defer. *Requires `SYSTEM_ALERT_WINDOW` user grant; new native module; new build.* Feature-flag it.

Each phase: keep data access in `src/api/*`, branch on `USE_MOCK`, `npm run typecheck`, calm non-gamified tone, test on the standalone APK (build workflow in `PLAN_V2_NOTIFY_RESPONSIVE.md` §4 — clean Windows PATH + absolute `gradlew.bat`).

---

## 13. Technical risks

- **Custom-font system notifications: not feasible.** Brand icon+color is the realistic ceiling for system notifications; true brand font/styling only on the bubble. Set expectations.
- **Floating overlay on modern Android (HIGH risk):** `SYSTEM_ALERT_WINDOW` user grant required; Android 12+ background-start + overlay restrictions; OEM battery killers (the test device is Samsung/One UI — aggressive) can suppress the overlay/service. Usage-gated display + a foreground service mitigates but adds complexity + a persistent service notification. iOS impossible. Treat as experimental, ship behind a flag, degrade to nothing if unsupported/denied.
- **"Only when device in use" needs native:** `ACTION_USER_PRESENT` receiver / foreground detection is not exposed by Expo; requires a native module/config plugin.
- **Background decisioning is constrained:** modern Android won't run arbitrary background logic to "decide" notifications on fresh data without a foreground service or push. Time/aggregate-based decisions (weekly goal, indefinite daily) are more reliable via **push/cron**; the local dispatcher only re-evaluates on app open. Keep daily as local repeating (survives via expo's boot receiver) but accept OEM variance.
- **Inexact alarms / Doze:** keep reminders inexact (calm app, exact timing not needed) → avoids `SCHEDULE_EXACT_ALARM` policy friction; expect Doze batching/delay.
- **Local-scheduled wording is fixed at schedule time:** the >3-day variant must be scheduled as its own delayed reminder (can't "upgrade" wording later); cancel all resume reminders on completion/resume to avoid stale fires.
- **Cron infra is new:** pg_cron / scheduled Edge Function + a service-role send path; must respect RLS via SECURITY DEFINER and the dedup tables.
- **Round-robin index + dedup state on-device** can reset on reinstall — acceptable (cosmetic).

---

## 14. Open decisions to confirm at the start of the next session
1. Weekly-goal midweek/2-days: **cron-push (recommended)** vs all-local?
2. Priority dispatcher ownership: **local-only for resume+daily**, cron consults state for goal — confirm?
3. `noncompletion_gentle` exact firing rule (when vs the resume variants) — proposed: soft fallback after resume attempts / on abandon.
4. New-content audience confirmed = **everyone with the app** (broadcast). Confirm: include admins? include unclassified/no-section lectures? final wording (drop "الذي تتابعه")?
5. Quiet hours exact range — proposed **21:00–07:00** local.
6. Bubble implementation: **custom native module (recommended)** vs RN lib.
7. New prefs/toggles for the new types (and a master "floating bubble" consent toggle).

---

## 15. Device-testing requirement (MANDATORY — connected phone R5CX10P3BPL)

Every notification type/behavior in this plan MUST be verified on the **physical connected phone (serial R5CX10P3BPL)** on the **standalone release APK** (never Expo Go — local notifications no-op there) — primarily with the **app CLOSED** (use `am kill`, NOT `am force-stop`, since force-stop cancels alarms). For test speed, temporarily shorten intervals (e.g. resume → ~60s), then revert + rebuild for the final build. Build/install/screencap workflow + the clean-PATH gotcha are in `PLAN_V2_NOTIFY_RESPONSIVE.md` §4.

Per-phase device checklist (capture a shade/overlay screenshot for each):
- [ ] Resume **general** (≤70%) fires with a general-bank phrase, **app closed**, deep-links to player **at the paused second**.
- [ ] Resume **near-completion** (>70%) fires with the near-bank phrase.
- [ ] Resume **long-inactivity** (>3 days) fires with the long-gap bank.
- [ ] Completion praise fires immediately at ≥90% with a completion-bank phrase.
- [ ] Non-completion gentle reminder fires with its soft bank.
- [ ] Daily reminder: fires once/day while app unopened; **opening the app resets it** (verify it does NOT fire the next day after an open); respects quiet hours.
- [ ] Unfinished-series reminder shows `[اسم السلسلة]` + correct remaining `[عدد]`.
- [ ] Weekly goal: midweek nudge, 2-days-before nudge, and completion congrats — and **no further goal reminders after completion**.
- [ ] New-content push lands in the shade **app closed**, delivered to a device that is **NOT** progressed in the section (proves broadcast-to-everyone), exactly **once** (no duplicate triggers).
- [ ] Phrase variety: trigger the same event 3–4× → different phrasings (round-robin), not the same sentence.
- [ ] Visual identity: brand small-icon + accent color render on the system notification.
- [ ] Floating bubble: appears only while the device is in use, ≤3/day, ≥2h gap, respects quiet hours, defers (not falls back) when locked, deep-links to player at the paused second.
- [ ] Priority/conflict: when multiple are eligible same day, only the highest (resume > goal > daily) shows; the rest defer to the next day.
- [ ] Deep-link: tapping any resume notification/bubble opens the **full player at the exact saved second**, not home.
- [ ] Final build only: temporary test intervals reverted; no diagnostic logs leak in logcat.
