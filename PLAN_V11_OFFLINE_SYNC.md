# PLAN V11 — Full Offline + Sync Queue + Fewer Round-Trips

Status: DECIDED — every choice below is locked. The executor does not ask questions.
Owner request (2026-07-05): «الأوسمة، الهدف الأسبوعي، حفظ التقدم — كل ما يمكن يعمل دون
اتصال، والمزامنة فور عودة الشبكة» + any speed improvement online or offline.
Latest migration on disk AND live is `0045_get_section_page.sql`; new migrations start
at **0046** (append-only, never edit 0001–0045). After any migration touching
RLS/policies/functions run `node scripts/security-check.mjs` (must stay 20/20).
V10 shipped the read-side offline foundation (persisted query cache, offlineFirst,
getSession boot, local playback). V11 is the WRITE side + the leftover read gaps +
two large round-trip collapses.

---

## The six deliverables (build order S → A → C → B → D → E)

| # | What | Kind |
|---|------|------|
| S | Migrations 0046 (day-aware activity RPC) + 0047 (`get_home_page`) | SQL |
| A | Connectivity foundation: `expo-network` + TanStack `onlineManager` | client |
| C | Live progress tick = **1** round-trip (was ~5 every 5s) | client |
| B | Offline outbox: progress/streak/notes/weekly-goal queue + day-accurate replay | client |
| D | Home = **1** round-trip (was 5 sequential) + playback prefetches | client |
| E | Offline read completion: quiz-stats line, notifications inbox, journey polish | client |

SQL first because C and B both call 0046's function. A before C/B because B needs the
reconnect signal and C wants `onlineManager` correctness.

---

## Current state — what breaks offline today (verified in code)

**Reads (mostly solved by V10):** the persist allowlist (`app/_layout.tsx:57`,
`PERSISTED_QUERY_ROOTS`) covers `home/section/sections/lecture/lectures/notes/journey/
benefits/appContent`. `queryKeys.journey/weeklyGoal/badges/streak` all share the
`journey` root → **الأوسمة, weekly goal, streak already render offline**. Gaps:
- `myQuizStats` (root `quizzes`) is NOT persisted → the «اختباراتك» line on
  رحلتي العلمية vanishes offline (`app/(student)/journey.tsx:124`).
- Notifications inbox (root `notifications`) is NOT persisted → empty offline.
- `journey.tsx:90` gate is `isLoading || !summary` — fine with persisted cache, keep,
  but the journey hooks (`src/hooks/useJourney.ts`) lack `placeholderData: keepPreviousData`.

**Writes (all fail silently offline):**
- `audioController.persist()` (`src/lib/audioController.ts:218-230`) `.catch(() => {})`
  → every offline listening tick is DROPPED server-side. The download sidecar keeps the
  resume position on-device (`src/lib/downloads.ts:90`), but: no `daily_listening`
  credit → **المداومة breaks even though the student listened**; no completion row →
  الأوسمة/weekly-goal/recovery never see offline lessons.
- `saveMyNote` (`src/api/notes.ts:29`) → offline note edits are lost with a silent
  error state in the editor.
- `setWeeklyGoal` (`src/api/journey.ts:93`) → offline goal edits fail.

**Perf hot spots (verified):**
- `saveLectureProgress` (`src/api/progress.ts:101-163`) per ~5s tick: SELECT prev
  (:117) + UPSERT (:131) + `recordListening` → RPC `record_meaningful_activity`
  (`src/api/journey.ts:141`) + `get_journey_summary` (:149) + SELECT `user_badges`
  (:153) ≈ **5 round-trips every 5 seconds** of playback, ~60/min. Mobile-data + battery
  cost, and pure latency online.
- `getHomeData` (`src/api/sections.ts:25-114`): 5 **sequential** awaits (roots →
  children rollups → newlyAdded → featured → continue-listening). Same disease 0045
  cured for section pages.
- `getLecturePlayback` is fetched only on tap; the resume card and auto-advance both
  eat that latency at the worst moment.

---

## S) Migrations

### `0046_offline_activity_sync.sql`
1. **Refactor 0044's body into a day-parameterised core**:
   `create or replace function public.apply_meaningful_activity(p_lecture_id uuid,
   p_seconds integer, p_completed boolean, p_day date) returns void`
   — IDENTICAL logic to 0044's `record_meaningful_activity`, with every `current_date`
   replaced by `p_day` (daily_listening upsert day, meaningful flip, `v_last` =
   `max(day) … where day < p_day`, `v_gap := p_day - v_last`, placeholder fill
   `while v_fill < p_day`). `security invoker`, `set search_path = public`,
   NOT granted to clients (revoke from public/anon/authenticated — internal only;
   invoker + own-rows RLS keeps it safe anyway).
2. **Keep the public seam**: `record_meaningful_activity(uuid, integer, boolean)`
   becomes a one-line wrapper → `apply_meaningful_activity(…, current_date)`.
   Same signature, existing grants re-asserted (0039 convention).
3. **`save_activity(p_lecture_id uuid, p_position_sec integer, p_duration_sec integer,
   p_delta_sec integer, p_completed boolean, p_day date default current_date,
   p_is_replay boolean default false) returns void`** — plpgsql, `security invoker`,
   `set search_path = public`. One call does what the client currently does in five:
   - Upsert `user_lecture_progress`: live (`p_is_replay=false`) keeps today's overwrite
     semantics for `position_sec` (a deliberate rewind must stick); replay uses
     `position_sec = greatest(existing, excluded)` so a stale offline entry never
     rewinds newer online progress. `completed = existing OR excluded` always (a
     lecture is never un-completed). Stamp `completed_at` only on the false→true
     transition: `now()` when `p_day = current_date`, else `p_day::timestamptz`
     (midnight of that day — enough for the 0044 recovery-window compare; never
     overwrite an earlier stamp).
   - Clamp `p_delta_sec` to `0..90` (`MAX_LISTEN_TICK_SEC`, `src/config.ts:39`) live;
     for replay entries clamp the entry total to `0..21600` (6h/day sanity cap).
   - Call `apply_meaningful_activity(p_lecture_id, <clamped delta>, p_completed, p_day)`.
   - `grant execute … to authenticated;` revoke public/anon (0039 convention).
4. No table changes. Idempotent (`create or replace`).

### `0047_get_home_page.sql`
`create or replace function public.get_home_page() returns jsonb` — `security invoker`,
`stable`, `set search_path = public`. One jsonb document, exactly mirroring 0045's style:
```
{ sections:[{id,title,cover_letter,total,completed}],          -- roots + rollups
  newly_added:[{id,title,duration_sec,sheikh_name,section_title}],  -- newest 8 published
  featured:[...get_featured_lectures() shape...],
  continue_listening: {lecture_id,title,sheikh_name,section_title,
                       position_sec,duration_sec} | null }
```
Reuses `get_children_rollups` + `get_featured_lectures` internally (no duplicated CTEs).
RLS applies (invoker). `grant execute to authenticated;` revoke public/anon.

After both: apply live (Management API, browser UA), regenerate
`src/types/database.generated.ts`, run `node scripts/security-check.mjs`.

---

## A) Connectivity foundation

Add **`expo-network`** (Expo SDK module, autolinks in the normal rebuild — the ONLY new
dependency of V11). New `src/lib/connectivity.ts`:
- Wire TanStack's `onlineManager.setEventListener` to
  `Network.addNetworkStateListener` (`isConnected && isInternetReachable !== false`),
  so paused `offlineFirst` queries resume the moment the network returns instead of
  waiting for the next mount/focus.
- Export `isOnline(): Promise<boolean>` (one-shot `Network.getNetworkStateAsync`) and
  `onReconnect(cb)` (fires on offline→online transitions) for the outbox.
- Initialise from `app/_layout.tsx` (one import + call at module scope near the RTL
  block — no render coupling).

No offline banner (V10 decision stands) — the app just quietly works.

---

## C) Live progress tick → one round-trip

`src/api/progress.ts` `saveLectureProgress`:
1. Replace the SELECT-prev + UPSERT + `recordListening` pipeline with **one**
   `supabase.rpc('save_activity', { p_lecture_id, p_position_sec: posInt,
   p_duration_sec, p_delta_sec, p_completed: reachedThreshold })`.
   The forward-delta must now be computed WITHOUT the prev SELECT: track the last saved
   position in the caller — `audioController` already knows it (`lastSavedAt` pattern,
   `src/lib/audioController.ts:127-131`); add a module-level `lastSavedPos` set on each
   persist and on track load (from the store's `positionSec`), pass
   `deltaSec = clamp(pos - lastSavedPos, 0, 90)` into `saveLectureProgress`. Keep the
   mock contract (`src/mock/api.ts saveLectureProgress`) working — mock path unchanged.
2. `justCompleted` detection without the prev row: derive from the query cache /
   player state (the store knows the lecture's prior `completed` status via the section
   page row; simplest correct rule: treat `reachedThreshold && !alreadyMarkedThisTrack`
   with a module-level per-track flag in audioController, reset on track change).
   Server-side `completed = old OR new` makes over-reporting harmless.
3. **Badges**: re-evaluate ONLY on completion events (`justCompleted`) and on journey
   screen mount — never per tick. Move the existing catalog-diff logic
   (`src/api/journey.ts:148-175`) into `evaluateBadges()` called from those two points.
   `maybeUpdateReminders` (`src/api/progress.ts:181`) stays gated on
   `firstTouch || justCompleted` as today (firstTouch now = "no lastSavedPos yet").
4. Net effect online: 1 RPC per 5s tick (was ~5 calls). Nothing else changes visibly.

---

## B) Offline outbox — the sync queue

New `src/lib/outbox.ts` (AsyncStorage-backed, key `offline-outbox-v1`):
```ts
type OutboxEntry =
  | { kind:'activity'; lectureId:string; day:string /*YYYY-MM-DD local*/;
      positionSec:number; durationSec:number; deltaSec:number; completed:boolean }
  | { kind:'note'; lectureId:string; body:string; updatedAt:string }
  | { kind:'goal'; metric:'lectures'|'minutes'; target:number };
```
- **Coalescing** (keeps the queue tiny): one `activity` entry per (lectureId, day) —
  accumulate `deltaSec`, keep max `positionSec`, OR `completed`. One `note` entry per
  lectureId (last write wins). One `goal` entry total (last write wins).
- **Enqueue points**:
  - `saveLectureProgress` catch / offline short-circuit: when `save_activity` fails or
    `isOnline()` is false, enqueue instead (the sidecar position write at
    `audioController.ts:224` stays — it is the instant on-device resume).
  - `useSaveNote` (`src/hooks/useNotes.ts:14`): add `onMutate` optimistic cache write
    (move the current `onSuccess` setQueryData there); `onError` → enqueue `note` and
    surface the calm state «سيُحفظ عند عودة الاتصال» in the editor
    (`app/(student)/lecture-note/[id].tsx` save-status row, ~:200) instead of a dead
    silent failure. Muted text, no red, no modal.
  - `useSetWeeklyGoal` (`src/hooks/useJourney.ts:39`): `onMutate` optimistically set
    `queryKeys.weeklyGoal` data; `onError` → enqueue `goal`, close the sheet normally.
- **Flush** (`flushOutbox()`): guarded by a single in-flight promise; sorts `activity`
  entries by `day` ascending (streak math needs chronological inserts); replays:
  - activity → `rpc('save_activity', {..., p_day: day, p_is_replay: true})`
  - note → `saveMyNote` (server upsert; last-write-wins is the accepted rule)
  - goal → `setWeeklyGoal`
  Remove each entry only after its call succeeds; stop the pass on the first network
  failure (retry later). After a flush that processed ≥1 activity entry, invalidate
  `queryKeys.journey` root + `queryKeys.home`.
- **Triggers**: `onReconnect` (from A), AppState → active (piggyback the existing
  `onActive` in `app/_layout.tsx` NotificationsBootstrap), post-boot once the session
  is ready, and a 60s interval that runs ONLY while the queue is non-empty.
- **Accepted tradeoffs (do not engineer around)**: a success-but-lost-ack retry can
  double-credit a few seconds (bounded by the 6h/day server clamp); replayed
  completions stamp midnight of their day; quizzes stay online-only (server-graded,
  answer-key security) — a quiz tap offline keeps its existing register/intro gating.

---

## D) Home in one round-trip + playback prefetch

1. `getHomeData` (`src/api/sections.ts:25`) → one `rpc('get_home_page')` + a pure
   mapper to the existing `HomeData` type (`coverLetter()` fallback logic stays
   client-side). Mock path untouched.
2. **Resume-card prefetch**: when home data lands with `continueListening`, fire
   `queryClient.prefetchQuery(queryKeys.lecture(id), () => getLecturePlayback(id),
   staleTime 30min)` so tapping «تابع الاستماع» opens the player with zero wait
   (signed URL TTL is 3600s — safely above the 30min staleTime).
3. **Next-lecture prefetch**: in `audioController.resolveNext` (:154-169), after
   `setNext(next.id)`, prefetch that lecture's `getLecturePlayback` the same way —
   auto-advance and the "next" button become gapless instead of paying metadata +
   signed-URL latency between lessons. Skip when offline (`isOnline()` false).
4. Verify `useLecturePlayback` uses `queryKeys.lecture(id)` so the prefetches land in
   the same cache entry the player reads.

---

## E) Offline read completion + polish

1. Persist-allowlist additions (`app/_layout.tsx:57`): add `quizzes` **selectively** —
   extend `shouldDehydrateQuery` so `['quizzes','myStats']` persists but attempt/intro
   keys do not (check `key[1]`); add `notifications` root (the user's own inbox on the
   user's own device; server is still the source of truth on refetch). Everything else
   in the exclusion rationale stands.
2. `useJourneySummary` / `useWeeklyGoal` / `useBadges` (`src/hooks/useJourney.ts`) and
   `useNotifications`: add `placeholderData: keepPreviousData`.
3. Offline mark-read taps in the inbox: let the mutation fail quietly (row still opens
   its target if cached) — explicitly NOT queued (low value, avoids read-state races).
4. Bump the persister `buster` only if the dehydrated shape changed (it did not — the
   allowlist only widened; keep `APP_VERSION`).

---

## Rules (same as V10 unless stated)

- All data-access via `src/api/*`; components never call supabase directly.
- Migrations append-only: **0046, 0047**. Pin `search_path = public`; revoke
  PUBLIC/anon + grant authenticated per 0039. Do NOT weaken any RLS policy.
- `record_meaningful_activity(uuid,integer,boolean)` keeps its exact signature.
- Only ONE new dependency: `expo-network`. No other packages, no custom native code
  (normal `assembleRelease` rebuild is expected and fine).
- `USE_MOCK=true` must keep working (mock paths untouched).
- RTL, calm tone, Arabic UI strings, Feather icons; no offline banners/toasts beyond
  the two quiet inline states specified in B.
- After migrations: apply live → regen types → `security-check.mjs` 20/20 → typecheck.

---

## Verification (device R5CX10P3BPL, release build, USE_MOCK=false)

1. **C:** while a lecture plays online, confirm exactly one `save_activity` call per
   ~5s (temporary counter/log in a dev run, or Supabase API logs), and that resume
   position + completion + streak flip still behave identically to before.
2. **B (the core drill):** airplane mode → play a DOWNLOADED lecture ≥3 minutes, edit
   its note, change the weekly goal → force-stop → relaunch still offline (note text +
   goal show their optimistic values) → reconnect → within ~1 min: `daily_listening`
   has today's seconds (streak card flips «واصلت اليوم»), the note row on the server
   matches, `weekly_goals` matches. Then a **day-boundary** replay: seed an outbox
   entry dated yesterday (dev hook or device clock), flush, verify yesterday's
   `daily_listening` row got the credit — the streak did NOT break.
3. **D:** cold-open Home (cache cleared) = ONE network call; tap «تابع الاستماع» →
   player starts with no metadata wait; auto-advance to the next lesson starts
   without the previous stall.
4. **E:** airplane mode: رحلتي العلمية shows streak ring, weekly goal, الأوسمة,
   «اختباراتك»; the notifications inbox shows its last-fetched rows.
5. **A:** toggle airplane mode while the app is open → queries refetch on reconnect
   without navigating away (onlineManager wired).
6. `security-check.mjs` 20/20; types regenerated; typecheck clean.
