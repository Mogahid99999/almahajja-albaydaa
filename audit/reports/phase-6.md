# Phase 6 report — Journey, streaks, goals, badges

**Branch** `audit/phase-6-journey` (stacked on `audit/phase-4-browsing`).
**Scope** `app/(student)/journey.tsx`, `src/components/journey/*` (StreakRing,
StreakDetailCard, GoalCard, GoalEditorSheet, JourneyGate, JourneyHomeCard,
BuddyCompareCard, BadgeSeal, labels), `src/components/home/StreakCard.tsx`,
`src/hooks/{useJourney,useStreak,useProgress}.ts`, `src/api/{journey,progress}.ts`,
`src/constants/badges.ts`, `src/lib/{outbox,outboxQueue}.ts` (journey legs),
streak SQL: migrations 0004, 0013 (claim), 0014, 0044, 0046.
**Findings** F-043 (P1, fixed client-side + migration 0090 authored),
F-044/F-045 (P3, fixed), F-046/F-047 (P3, logged), F-048 (P3, wontfix documented),
F-049 (post-0090 cleanup tracker), F-050 (buddy-compare day-anchor mismatch, logged).

---

## 1. The streak/day-boundary spec (as verified, and as fixed)

### Write side (what makes a day "count")
- Every playback tick lands in `save_activity` (0046) → `apply_meaningful_activity`:
  upsert into `daily_listening(user_id, day)`, add the forward-only delta
  (live-clamped ≤ 90s/tick, replay-clamped ≤ 6h/day), union the lecture id.
- A day becomes **meaningful** (counts toward المداومة) once its accumulated
  seconds ≥ 120 **or** any completion lands on it. The flip is server-side and
  one-way.
- **Day attribution — the P1 (F-043).** The offline outbox has always credited
  the **device-local** day (`localDay()`, its documented contract); the live path
  passed no `p_day` and silently credited the **server UTC** day. For the target
  audience (UTC+2…+4), between local midnight and ~03:00 the two paths disagree.
  Concrete failure: listen 00:10–00:14 local with a connectivity blip in the
  middle → 2 min on UTC-yesterday (live) + 2 min on local-today (replay) →
  neither row reaches 120s → no meaningful day → streak breaks despite 4 real
  minutes. Fixed: live path now sends `p_day: localDay()` — all writes are
  device-local-day, matching the outbox contract.

### Read side
- `streak_for_user`: gaps-and-islands over meaningful days; islands join when
  gap ≤ 2 days (one missed day tolerated, value = days actually listened);
  current streak = island whose last day ≥ **today** − 2.
- `get_streak_status`: `today_counted` = meaningful row exists for **today**;
  recovery window = last meaningful day 3–5 days before **today** + 30-day
  cooldown clear.
- `get_week_progress`: Sat→Fri window derived from **today** (bounds math
  verified correct for all 7 weekdays).
- Every "**today**" above was server-UTC `current_date`. Migration **0090**
  (authored this phase, **not applied** — no staging exists, F-002) makes the
  read rollups AND `try_claim_goal_congrats` day-parameterised (`p_today date
  default current_date`, clamped via a single `clamp_client_day` helper to
  `current_date ± 1`, NULL-safe), drops the old arities — new-signature drops
  included so the file is genuinely idempotent under manual management-API
  re-runs — (every existing SQL caller — 0015/0082 buddy, 0025/0074/0075
  admin, 0035 cron — resolves through the default), and hardens `save_activity`:
  future `p_day` clamped to ≤ current_date + 1; live `completed_at` stamped
  `greatest(now(), day-midnight)` so an ahead-of-UTC local-day completion can
  never fall before a `broke_at` equal to that same day (recovery-bar edge);
  replays keep 0046's exact midnight rule so a completion replayed for a past
  day can never satisfy a recovery window it predates.
- Client reads (`get_journey_summary`, `get_streak_status`,
  `try_claim_goal_congrats`) now pass `p_today: localDay()` with a **memoized
  PGRST202 fallback** to the zero-arg call — verified against the live pre-0090
  database: the `p_today` call returns PGRST202 (fallback engages, behavior
  unchanged), the no-arg call returns 200. Either deploy order of {0090, app
  build} is therefore safe; the intended order is migration first (management
  API is instant; store builds are not). Cleanup tracked as **F-049**.
- Deliberately **not** localized: buddy/admin/cron streak reads (the viewer's
  local day is meaningless for another user's streak; crons have no device).
  Residual: the buddy-compare RPC's own-side legs stay server-day → the phrase
  can misreport in the midnight window (**F-050**, logged for the next
  owner-applied migration batch).

### Recovery (استعادة المداومة)
Verified against 0044/0046: window = last meaningful day + 3 … + 5; bar = ≥ 2
lessons **fully completed** with `completed_at ≥ broke_at`; 30-day cooldown;
bridge = 1-second placeholder rows at `last+2, last+4` (≤ 2 rows) so the ≤2-day
island rule reconnects; evaluated on **every** completion (not just the day's
first meaningful flip — the 2nd lesson must still trigger it). After a recovery,
`get_streak_status` recomputes `available=false` (gap collapses to 1) — no stuck
CTA. StreakCard copy («درسان كاملان خلال المهلة») matches the actual bar.

### TZ scenarios walked
- UTC+3, nightly listening 00:30 local: pre-fix, credits drifted to the prior
  UTC day and «واصلت اليوم» misreported until 03:00; post-fix (with 0090) every
  surface flips at local midnight.
- Travel/TZ change: `localDay()` follows the device; a westward jump re-credits
  an existing local day (row merge — idempotent); an eastward jump ≤ +1 day is
  within the server clamp.
- Clock tampering: future-day farming now clamped to +1 day server-side; past-day
  writes remain open by design (offline replay) — accepted, documented tradeoff.
- DST: none in the primary market; elsewhere `localDay()` is calendar-date-based
  (`getFullYear/Month/Date`), so DST shifts never skip/duplicate a date.

## 2. Badges
- **Idempotency**: `user_badges` PK (user_id, badge_key) + upsert with
  `ignoreDuplicates` — concurrent completion ticks / two devices cannot
  double-award. ✓
- **Never-revoke invariant**: streak badges compare against **longest** streak
  (max island length over full history — monotonic; recovery bridging can only
  merge islands, never shrink them); completed badges against a count that never
  decreases (`completed` is OR-merged server-side, never un-set). No delete path
  exists. ✓
- Evaluation moments (V11 · C): completion event + journey mount only — verified
  no per-tick evaluation. `useSyncBadgesOnMount` is best-effort/silent offline. ✓

## 3. Weekly goal
- Optimistic editor (patches both `weeklyGoal` and `journey` summary caches),
  `networkMode: 'offlineFirst'`, failure → outbox (`enqueueGoal`, single
  coalesced entry), sheet closes on settle — offline edit UX verified sound. ✓
- Goal edited mid-week: `current` recomputes over the whole Sat→Fri window in
  the new metric — coherent, documented behavior. Zero/absent goal row: defaults
  (lectures/3) match the table default; `target=0` cannot arise from the UI and
  degrades gracefully everywhere it could arrive via raw API (F-046, logged with
  the CHECK-constraint fix batched for the next owner-applied migration).
- GoalEditorSheet mid-edit re-seed race → F-047 (P3, logged).

## 4. Per-screen checklist — journey.tsx + 4 embedded cards
(StreakCard/Home, StreakDetailCard, GoalCard+Editor, BuddyCompareCard, JourneyHomeCard, BadgeSeal grid)

| Dimension | Result |
|---|---|
| Functional correctness | ✓ after F-043/F-044/F-045 |
| Runtime errors / crash paths | ✓ all queries have empty-safe fallbacks; no unguarded index/parse |
| Edge cases (empty/huge/malformed) | ✓ zero-state streak («ابدأ اليوم»), 0-goal, 100+ badges impossible (fixed catalog ×9) |
| Loading / empty / error / offline | ✓ `keepPreviousData` + persisted `journey` root renders last snapshot offline; spinner only on true first load |
| Guest vs registered | ✓ JourneyGate (screen) + null render (cards) + `enabled:false` on every query — no guest fetches; register CTA routes correct |
| Input validation | ✓ editor is preset-only; server gap = F-046 (logged) |
| State management | ✓ invalidation fan-out verified: save→`journey/badges/streak/home`; outbox replay→`['journey']` root + home + section |
| Navigation | ✓ back chevron; deep re-entry safe; goal sheet closes on hardware back (`onRequestClose`) |
| API interaction | ✓ one RPC per read; badge upsert idempotent; PGRST202 fallback probed live |
| Security | ✓ own-rows RLS on all 4 journey tables (re-read policies); INVOKER rollups; buddy card shows only pct/streak of accepted same-gender buddies |
| Performance | ✓ fixed small badge catalog; no lists needing virtualization; single summary RPC |
| Memory leaks | ✓ `useSyncBadgesOnMount` cancels on unmount; no listeners/timers in scope |
| Accessibility | ✓ roles/labels on edit + recovery CTA; selected states on editor chips |
| Small phones / tablet | ✓ 48%-width badge grid wraps; stat row `flex:1` ×3 (tight but scrolls); no fixed widths > 320pt |
| RTL / localization | ✓ all copy Arabic; `arNum`/`arDayCount` throughout after F-044; gendered wording after F-045 |
| Backgrounding / kill / restore | ✓ persisted query cache restores; outbox drains post-boot |
| Network interruption mid-action | ✓ goal edit + ticks queue; badge eval silently skips |

## 5. Code review (medium, 8 angles) — outcomes folded back in
The pre-commit `/code-review` (4 finder agents × 8 angles over the diff)
surfaced and led to fixing, before commit: (a) a **recovery-bar regression** in
the first 0090 draft — replayed past-day completions would have been stamped
`now()` instead of that day's midnight, letting a pre-break completion satisfy
the compensatory bar; (b) the mirror-image live edge — an ahead-of-UTC local-day
completion stamped `now()` fell *before* a `broke_at` equal to that day (now
`greatest(now(), day-midnight)`); (c) the migration's "idempotent" claim was
false (new-signature drops added); (d) NULL `p_today` produced an all-zeros
streak (clamp is NULL-safe now, single `clamp_client_day` definition);
(e) write/read clamp asymmetry (+1 vs +2 dead zone — aligned at ±1);
(f) `try_claim_goal_congrats` was left on the server week while writes went
local-day (now parameterized + client passes local day); (g) the un-memoized
fallback doubled every journey read pre-0090 (memoized); (h) the gender-phrase
ternary re-created the exact structure that caused F-045 (flattened via a
`g(masc, fem)` picker). F-049/F-050 were opened for the two accepted residuals.

## 6. Verification record & limitations
- `npm run typecheck` clean; `node scripts/security-check.mjs` 20/20 (CLAUDE.md
  requirement after an RLS/function-touching migration — run against the live DB,
  which 0090 does not yet alter).
- Live read-only probe of production PostgREST proved the PGRST202 fallback
  contract (see §1).
- **0090 is authored, not applied, and not replay-tested** — no staging project
  (F-002) and no local Postgres on this machine. It must go through the F-002/F-015
  staging replay (or careful management-API apply) **before** the next client
  build ships; then regenerate `src/types/database.generated.ts` and remove the
  `rpcWithLocalToday` fallback + its `as never` casts.
- Around-midnight and TZ-travel scenarios verified by SQL/JS semantics walk-through,
  not on-device clock manipulation; queue a device pass with F-019.

## 7. Exit criteria
- Streak math verified across TZ scenarios: **yes** (semantics-level; device pass queued).
- Checklist ×1 screen + embedded cards: **complete** (above).
- Open items forwarded: F-046, F-047, F-050 → Phase 11 / next migration batch; 0090 apply + typegen + shim removal → owner action, tracked in F-043/F-049.
