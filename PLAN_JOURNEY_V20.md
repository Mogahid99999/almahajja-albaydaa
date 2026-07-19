# V20 — «My Learning Journey» / Buddy System / Badges Revamp

> Enhanced requirements + phased implementation plan.
> Source: `متطلبات_تطوير_المحجة_البيضاء_منسق_بدون_جداول.docx` (July 2026), reconciled against the actual codebase.
> Tone: calm, no comparison, no blame, full RTL, brand palette (cream · dark green · quiet gold).
> User-facing copy stays in Arabic (it ships to users); everything else is English.

> **⚠️ HARD RULE — RTL EVERYWHERE.** Every new screen, card, sheet, modal, row, icon,
> and animation in this plan MUST be right-to-left. No exceptions. This means:
> Arabic copy throughout; row direction reversed (back/chevron on the correct side);
> progress bars and calendars fill/read RTL; the celebration modal and every new
> component honor the app's RTL bootstrap. Any component that looks correct only in
> LTR is a defect, not "polish later". This applies to all of §2–§16 below.

---

## 0. Executive summary — what's already built vs. genuinely new

Before any work, this is the standing baseline (do NOT rebuild it):

| Already shipped (v1..v19) | Genuinely new (no schema, no code) |
|---|---|
| Streak ring `StreakRing` + `get_streak_status` | **Bookmarks (للمراجعة لاحقًا)** — no table, no screen |
| Basic weekly goal `GoalCard` + `weekly_goals` | **Buddy shared goals (أهداف الرفقة)** — no schema at all |
| Lifetime totals (lectures/minutes/days) `get_journey_summary` | **Activity log** (monthly calendar) |
| Badges — only 2 kinds: `completed` + `streak` (`src/constants/badges.ts`) | **Harvest (حصاد الرحلة)** (week/month/all filter) |
| Buddy relationships (up to 3) + requests + `buddy_requests` | **Journey map (خريطة رحلتي)** (section/series progress) |
| Buddy weekly **comparison** card `BuddyCompareCard` | **Tiered badge system** (6 categories × 5 tiers) |
| `getResumeTarget` (last position) — API ready | **Unified Achievement Celebration Modal** |
| Local completion praise `presentCompletionPraise` | **Buddy encouragement** (canned phrases, once/24h) |
|  | **Scheduled buddy notifications** (batched, time windows) |

> Governing architecture (CLAUDE.md): all reads/writes go through `src/api/*` only; components never call `supabase` directly. Every recursive rollup is a server-side SQL function, never client-side tree walking. Student reads filter `status='published'`. All day-anchored math uses the device-local day (`localDay()` / `p_day`, see F-043 / migration 0090).

---

## 1. Overall goal
Turn «رحلتي العلمية» from a numbers-and-badges page into a hub that answers: my streak today, where I stopped, my weekly + scholarly progress, my harvest, my nearest achievement, and how I'm doing with each buddy.

**Out of scope (confirmed):** new study plans, a «مكتبتي» page, free chat/messages between buddies, the word «عهد» (the approved term is «هدف الرفقة»).

---

## 2. Streak ring & today's state — *minor tweak to existing*
Keep `StreakRing`. Only wording + info polish is required:
- Current streak days · today's state · longest streak · visual of recent days · tapping opens the **Activity log** (new, §7).
- **Copy:**
  - Before today's activity: «لم تبدأ مداومتك اليوم» / «لم تسجّل نشاطًا علميًا اليوم» — button **ابدأ الآن**.
  - After activity: «تمت مداومة اليوم» / «بارك الله في سعيك، عُد غدًا لتواصل رحلتك».
- **Code hook:** `useStreakStatus` already gives `todayCounted` + `current`. Add `longest` (already in `get_journey_summary`). "Tap opens activity log" = new button opening the §7 screen.

---

## 3. «واصل رحلتك» (Resume) card — *API half-ready, UI new*
A card after the ring showing the latest scholarly position.
- Section ← inner section ← series · current/next lesson title · completed count and series % · pause time · continue button.
- Two states: **incomplete lesson** («توقفت عند 24:18» → أكمل الاستماع) and **next lesson** («أنجزت 8 من 25» → ابدأ الدرس التالي).
- With multiple series: show the most-recently-active; the rest live in **Journey map**.
- **Hook:** `getResumeTarget()` exists but only returns `title`+`positionSec`+`durationSec`. **Needs extension** to return the full breadcrumb + lesson number + completed count + series % + next lesson. Best done as a new server RPC `get_resume_card` building it all in one round-trip (instead of several client reads).

---

## 4. Bookmarks (للمراجعة لاحقًا) — *entirely new*
A mark at a specific minute inside a lesson to return to later.

### Schema (new migration)
```
lecture_bookmarks(
  id uuid pk, user_id uuid, lecture_id uuid,
  position_sec int not null,
  note text null,                      -- optional short note
  status text default 'pending',       -- 'pending' | 'reviewed'
  created_at timestamptz, reviewed_at timestamptz null
)
```
RLS: student sees/writes own rows only. Index on `(user_id, status)`.

### Player
- A **«للمراجعة لاحقًا»** button in the player (best home: `LessonToolsRow` / `PlayerUtilityBar` — must not pause audio).
- On press: lesson/series name + current timestamp saved automatically + optional short note.
- A small Toast that does NOT pause audio: «تمت إضافة الدقيقة 24:18 إلى المراجعة لاحقًا».
- Prevent duplicate marks at the same timestamp within a few seconds (~5–10s window on `position_sec`).

### «المراجعة لاحقًا» screen (new route `app/(student)/bookmarks.tsx`)
- Per mark: section · series · lesson title · timestamp · note · added date · status.
- Tap: opens the lesson and seeks to the minute via the existing `?t=` deep-link — **without changing original progress** unless the student keeps listening naturally past it.
- Manage: edit note · mark reviewed · return to review · delete · filter by section/series · show only unreviewed.
- On completion: «تمت مراجعة هذه العلامة / نفعك الله بما تعلمت وذكّرك منه ما نسيت».

### Access
- A «المراجعة لاحقًا — N» entry in profile / student tools (N = unreviewed).
- Shortcut inside «رحلتي العلمية»: «لديك 6 مواضع بانتظار المراجعة» → button **ابدأ المراجعة** (shows only when pending marks exist).

### Offline rules
- Downloaded lesson: the mark works offline then syncs. **Hook:** reuse the existing outbox channel (`enqueueActivity` pattern) — add a `bookmark` queue type.
- Removing a lesson from downloads does NOT delete its marks.
- Marks are tied to the account and appear across all devices.

---

## 5. Upgraded weekly goal — *extend existing*
Keep the types (lectures/minutes). Add to the display: percentage, days remaining, required daily rate, over-target state.
- % = done ÷ target × 100 · remaining = target − done · daily required = ⌈remaining ÷ days_remaining⌉.
- Current day counts in remaining unless it's over · local timezone · does not stop at 100% (over: «9 من 7 — 129%»).
- On not completing (new week): «أنجزت 5 من 7 دروس هذا الأسبوع / أسبوع جديد وفرصة جديدة بإذن الله».
- **Hook:** pure client computation over the existing `summary.week` → extend `GoalCard.tsx` only, no schema.

---

## 6. Journey map — *new (relies on existing rollups)*
Shows the student's progress across existing sections/series (no new plans, no locking, no forced order).
- Started sections/series · current/completed/not-started · each series' % and completed count · last lesson and next.
- Show the last 2–3 tracks + a **عرض الرحلة كاملة** button.
- **Hook:** `get_section_rollup` exists. **Needs** an RPC `get_journey_map` returning the series the student touched with (%, completed/total, last lesson, next lesson) ordered by most-recent activity.

---

## 7. Activity log — *new*
A monthly calendar of activity days.
- Colors: dark green (full activity) · light green (light) · gold (goal/achievement) · empty (none).
- Day detail: «الأحد 19 يوليو / استمعت 47 دقيقة / أكملت درسين / اجتزت اختبارًا / كتبت فائدة».
- Shows: current streak, longest streak, total active days, days in month · navigate previous months · gaps shown as info, no blame.
- **Hook:** `daily_listening` exists. **Needs** an RPC `get_activity_calendar(p_month)` aggregating by local day: minutes + completed lessons + quizzes + benefits, and classifying the color. The "gold" layer derives from achievement events (§9/§15).

---

## 8. Harvest (حصاد الرحلة) — *new*
A summary of the journey's fruit, filter: this week / this month / since the start.
- Completed lessons · actual listening hours/minutes · active days · completed series · passed quizzes · benefits/notes written.
- Top 3 numbers on the page + a **عرض الحصاد كاملًا** button.
- **Hook:** RPC `get_harvest(p_range)` aggregating from `daily_listening` + `user_lecture_progress` + quizzes + benefits within local-day bounds.

---

## 9. Upgraded badge system — *major extension to `badges.ts`*
Reorganize into **graded categories and tiers** showing the condition + progress + remaining, with a distinct symbol per category.

**Tiers:** bronze · silver · gold · diamond · exceptional.

| Category | Thresholds |
|---|---|
| Student (lessons) | 25 · 50 · 150 · 250 · 500 |
| Listening hours (**actual listening**, not file duration) | 15 · 30 · 100 · 300 · 500 hours |
| Streak (consecutive) | 7 · 15 · 30 · 100 · 365 days |
| Total active days (never lost on a break) | 10 · 30 · 100 · 365 |
| Series completion | first · 3 · 5 · 10 (+ a special badge named after an important series) |
| Quizzes & mastery | first · 5 · 10 · ≥90% · complete a series' quizzes |
| Note-taking (تدوين العلم) | first benefit · 10 · 50 · writing on 7 different days |
| Buddy | buddy start · first shared goal · first completed · 4 · 12 · shared series · 4 consecutive weeks |

- «بداية الطريق» stays standalone (first lesson).
- **Page display:** tabs (الكل · التعلّم · المداومة · الإتقان · التدوين · الرفقة) · summary «حصلت على 7 من 24» · nearest badge «طالب العلم الفضي — بقي 37 درسًا» · locked badges show condition/progress/remaining.
- **Hook:** `src/constants/badges.ts` has only 2 kinds. **Needs:** redesign `BadgeDef` with `{category, tier, threshold, metric}`; extend `evaluateBadges` to read all metrics (actual hours, total days, series, quizzes, benefits, buddy). Metrics not in `get_journey_summary` today need the RPC extended. "Actual hours" = from `daily_listening` (computed delta), not `duration_sec` — **decision locked**.

---

## 10. Upgraded buddy system — shared goals — *entirely new*
Up to 3 buddies (exists). **New:** an independent goal per buddy, each relationship's progress separate, one active goal per buddy, max 3 active goals.

### Schema (new migration)
```
buddy_goals(
  id uuid pk,
  a_user_id uuid, b_user_id uuid,          -- the two buddies
  created_by uuid,
  metric text,                              -- 'lectures'|'minutes'|'active_days'
  target int,
  starts_on date, ends_on date,            -- the duration
  status text,  -- 'pending'|'active'|'a_done'|'b_done'|'completed'|'expired'|'declined'|'cancelled'
  a_progress int default 0, b_progress int default 0,
  created_at timestamptz
)
```
- Each student has their own independent share; neither completes on behalf of the other. The goal completes only when both finish.
- **All computation via SECURITY DEFINER RPCs** (matching the existing `buddy.ts` pattern): `create_buddy_goal` · `respond_buddy_goal` · `get_buddy_goals` · `recompute_buddy_goal_progress` (called from `save_activity` or on a schedule).
- **Creating a goal:** pick buddy → type → value → duration → invite the buddy accepts/declines.
- **States** (8): pending accept · active · close · you finished · buddy finished · both completed · expired · declined/cancelled.
- **Motivational copy:** as in source §10 (you finished / buddy finished / completed / expired) — stored in `labels.ts`.

---

## 11. Buddies inside «رحلتي العلمية» — *extend `BuddyCompareCard`*
No standalone page. A **«رفقاء الرحلة»** section with short cards for the three.
- Buddy card: name · «هدفكما: 5 دروس لكل طالب» · «أنت 4 من 5 — رفيقك 3 من 5» · «بقي يومان».
- No goal: «لا يوجد هدف مشترك حاليًا» + button **إنشاء هدف رفقة**.
- Buddy detail sheet: current goal · both sides' progress and days left · completed goals count · consecutive weeks · start date · buttons (new goal / invitations / manage buddy).
- **Hook:** replace/extend `BuddyCompareCard` to read `get_buddy_goals` instead of the bare weekly comparison.

---

## 12. Make the invitations page visible — *extend `buddy-requests.tsx`*
- Prominent «الدعوات» button inside «رفقاء الرحلة» · clear profile entry «دعوات الرفقة» · numeric badge · a card atop the section «لديك دعوتان جديدتان — عرض الدعوات».
- Page organized in two sections: **buddy invitations** (incoming/outgoing, accept/decline, status, buddy count of 3) and **buddy goal invitations** (buddy, type, value, duration, accept/decline).

---

## 13. Automatic buddy notifications — *new (builds on existing push infra)*
Notifications tied to real progress, distributed, not instant per event.
- Types: buddy made progress · finished their share · you're both close · two days left · you both hit the goal · buddy hit their weekly goal / returned to their streak.
- Batch nearby activity into one notification · time windows (morning 9–11 · afternoon 2–5 · evening 7–9:30) · local timezone · **daily cap 3, only 1 per buddy per day (decision locked)** · mute a specific buddy's notifications.
- **Hook:** cron + Edge Functions exist (`notify-on-publish`, dispatch crons 0033–0036). **Needs:** a new cron `dispatch_buddy_nudges` + new `notification_prefs` type(s) + respect existing quiet-hours.

---

## 14. Canned encouragement from a buddy — *new*
No chat. Fixed canned phrases, once/24h per buddy, at a suitable time respecting quiet hours.
- «تشجيع رفيقك» button in the buddy card · pick from 8 fixed phrases (source §14) · no message log · mute per buddy · no badges for sending.
- **Hook:** table `buddy_encouragements(from, to, phrase_key, sent_at)` to enforce the 24h cap server-side + RPC `send_encouragement` + scheduled push.

---

## 15. Achievement Celebration Modal — *new, unified*
One component to celebrate weekly goal / badges / streak / series / quizzes / first lesson or benefit / buddy goals.
- **3 levels:** simple (card atop screen) · medium (quiet Modal) · large (special quiet celebration).
- Design: light dim + gold glow · simple Islamic ornament + few gold particles · gentle icon scale-in · optional light haptic · «الحمد لله» button + secondary «عرض الوسام» · no confetti / loud game effects.
- **Rules:** never repeats (state saved in DB) · concurrent ones batch in sequence · lock-screen achievement shows after opening · never pauses audio nor appears before a quiz result · supports Reduce Motion · **celebration sound ON (quiet) + real-time notify (decision locked)**.
- **Hook:** no celebration component exists today (badges render silently). **Needs:** table `celebrated(user_id, event_key)` to prevent repeats + a display queue in a Zustand store + an `AchievementCelebration` component. Needs one quiet sound file in `assets/`.

---

## 16. «رحلتي العلمية» page order (compact, expandable)
1) title 2) streak ring + today's state 3) resume card 4) bookmarks shortcut (conditional) 5) upgraded weekly goal 6) journey map 7) harvest 8) compact activity log 9) nearest badges + all-badges button 10) buddies section 11) invitations button + badge.

---

## 17. General acceptance criteria
Full Arabic RTL · local-timezone math · no duplicate achievements/notifications across devices · modals never pause audio nor break a quiz · no free messages · invitations visible · calm experience with no comparison/ranking/blame · brand palette & motion.

---

# Implementation plan

Order follows the source's execution priorities (§17) with shared infrastructure brought forward.

## Phase 1 — personal core (highest value, lowest risk) — **IN PROGRESS**
1. **Resume card (§3):** RPC `get_resume_card` + card UI. *(API half-ready)* — ⬜ TODO
2. **Upgraded weekly goal (§5):** extend `GoalCard` computationally only — no schema. — ⬜ TODO
3. **Tiered badges (§9):** redesign `badges.ts` + extend `evaluateBadges` and the RPC for new metrics + tabbed screen. — ⬜ TODO
4. **Achievement Celebration Modal (§15):** ✅ **DONE (not yet device-verified)**. Built:
   - migration `0104_achievement_celebrations.sql` — `celebrated` table + `try_claim_celebration(p_key)` (server dedup, cross-device, once-ever).
   - `src/api/celebrations.ts` — `tryClaimCelebration` (best-effort, `as never` until types regen).
   - `src/stores/celebrationStore.ts` — Zustand FIFO queue + quiz `suppressed` gate + `celebrate()` imperative helper.
   - `src/components/celebration/AchievementCelebration.tsx` — RTL modal, 3 levels (simple/medium/large), gentle Reanimated scale-in, reduce-motion aware, «الحمد لله» + «عرض الوسام», brass-seal emblem.
   - `src/lib/celebrationCue.ts` — optional quiet sound + light haptic, dependency-optional (no new native build required; drop `assets/celebration.m4a` + `expo install expo-haptics` to enable).
   - Wired: mounted in `app/_layout.tsx`; badge seam in `audioController` enqueues on completion; quiz-attempt screen raises the suppression gate.
   - Test: `src/stores/__tests__/celebrationStore.test.ts` (6 tests) — sequential display, claim-gating, session dedup, suppression. Full suite 197/197 green, typecheck clean.
   - **Follow-ups before ship:** apply 0104 to DB → regenerate `database.generated.ts` → drop the `as never`; run `node scripts/security-check.mjs`; device-verify a real badge earn.
5. Update copy and page order (§2, §16 partial). — ⬜ TODO

## Phase 2 — journey & harvest
6. **Bookmarks (§4):** `lecture_bookmarks` migration + player button + screen + offline queue + profile entry.
7. **Journey map (§6):** RPC `get_journey_map` + screen/section.
8. **Activity log (§7):** RPC `get_activity_calendar` + monthly calendar + day detail.
9. **Harvest (§8):** RPC `get_harvest(p_range)` + section with top 3 + full screen.

## Phase 3 — upgraded buddy system
10. **Buddy goals (§10):** `buddy_goals` migration + RPCs (create/respond/get/recompute) + wire into `save_activity`.
11. **Buddy cards inside the journey (§11):** extend `BuddyCompareCard` + detail sheet.
12. **Visible invitations (§12):** buttons/badges + reorganize `buddy-requests.tsx` into two sections.
13. **Scheduled buddy notifications (§13):** cron `dispatch_buddy_nudges` + prefs types + batching/time windows.
14. **Buddy encouragement (§14):** `buddy_encouragements` + `send_encouragement` + phrase-picker button.

## After each phase
- Any migration touching RLS/policies/functions → `node scripts/security-check.mjs`.
- A regression test for each testable piece of logic (goal math, color classification, badge thresholds, 24h cap) asserting on visible Arabic copy.
- Device verification before commit — especially offline and bookmark sync.
- Regenerate `database.generated.ts` after each migration (avoid `as never` debt).

---

# Idea & design enhancements (tied to the brand identity & our system)

Additions beyond the source text, designed to blend with our existing components (`Card` · `Txt` · `StreakRing` · `SectionTitle` · cream/green/gold `colors` · RTL) and the calm tone, without breaking "no comparison / no blame".

### Unified visual language
- **Generalize the current "brass seal" badge look** into an app-wide achievement identity: the same quiet seal texture in `BadgeSeal` becomes the basis for tier icons (bronze→exceptional as a brass→gold→diamond gradient with no loud shine).
- **Collapsible journey cards** via a new shared `JourneySection` component (title + one-line summary + expand), achieving "compact but expandable" (§16) without a long, heavy page. The collapsed state is persisted in `settingsStore` (Zustand) so the student's preference is remembered.
- **A unified `ProgressBar`** using the same `StreakRing` color logic (calm green + gold on over-target) across: weekly goal, series %, buddy goals — visually consistent.

### Enhanced ideas per feature
- **Resume card (§3):** instead of a static view, a small "resume chip" showing *time since last listen* in a gentle tone («منذ يومين») — a nudge without pressure — reusing the existing `updatedAt` in `getResumeTarget` and the existing resume-phrase-picker logic.
- **Bookmarks (§4):** link to the existing **Benefits (فوائد)** feature — a «حوّل هذه العلامة إلى فائدة» button opens the benefit editor with the timestamp quoted (feeds the "note-taking" badge §9 and closes the loop between review and note-taking).
- **Journey map (§6):** a light tree view reusing the `nested-sections` vocabulary (section ← inner ← series) with the same section-tree icons from admin, so it feels familiar.
- **Activity log (§7):** the calendar reuses the same `StreakRing` color ramp (consistency) rather than new colors; "day detail" appears as a quiet bottom-sheet (same pattern as `GoalEditorSheet`).
- **Harvest (§8):** the "top 3 numbers" are chosen dynamically by what's most notable this week (biggest number / newest achievement) rather than three fixed ones — a live feel without comparison.
- **Celebration (§15):** reuse the Islamic ornament and the app logo (`assets/logo.pdf`, tile teal) as the glow backdrop — consistent visual identity — and use `expo-haptics` for the optional light vibration.
- **Buddy encouragement (§14):** the eight phrases render as small "du'a cards" in the `display` font (same as headings) for a calm spiritual feel, not a dry text list.

### Consistency with existing constraints
- All new notifications (§13/§14) respect the already-applied **quiet-hours (23:00–05:00)** and existing `notification_prefs` — we add types, not a new system.
- All math on the device-local day via `localDay()`/`p_day` as in `save_activity` — no UTC drift.
- Offline via the existing **outbox** (`enqueueActivity`) with a `bookmark` queue type — no new sync channel.

---

## Decisions locked (2026-07-19)
1. **Badge "actual hours" (§9):** ✅ from `daily_listening` (actual listening), not file duration.
2. **Celebration sound (§15):** ✅ quiet sound ON + real-time notification (not deferred). *(Needs one quiet sound file in `assets/`.)*
3. **Buddy notification daily cap (§13):** ✅ max 3/day, only 1 per buddy per day.
4. **Start:** ✅ Phase 1 in full now (resume card + weekly goal + tiered badges + celebration modal), then device-verify.

## Deferred decisions (do not block Phase 1)
- The "special badge named after an important series" (§9): defined later (app_config candidate).
- "Compact activity log" on the page (§16.8): number of days shown compact — decided in Phase 2.
