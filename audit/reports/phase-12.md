# Phase 12 — Test infrastructure & regression safety net

**Branch:** `audit/phase-12-tests` (branched from `audit/phase-8-quizzes`, so the tests
codify the phase-8 corrected behavior — per PLAN_AUDIT's ordering rationale "codify the
*corrected* behavior").
**Status:** complete — `npm test` green (13 suites, 120 tests), `npm run typecheck` green,
CI workflow added.
**Baseline:** the repo had **zero automated tests** (PLAN_AUDIT §1) — the single biggest
maintainability finding of the audit baseline.

---

## 1. What was added

### Tooling
| Piece | Choice | Notes |
|---|---|---|
| Runner | **jest 29.7** + **jest-expo 56.0.5** preset | matches Expo SDK 56; `npm test` / `npm run test:watch` |
| Component testing | **@testing-library/react-native 14.0.1** (+ react-test-renderer 19.2.3) | RNTL 14's API is **async** (`await render/fireEvent/act`) — documented in CLAUDE.md |
| Config | `jest.config.js` | `moduleNameMapper` mirrors the `@/*` alias; `react-native-worklets/jest/resolver.js` as resolver (reanimated 4 has no native worklets runtime under Jest); `clearMocks: true` |
| Global setup | `tests/setup.ts` | dummy `EXPO_PUBLIC_*` env (src/lib/env.ts throws without them), official AsyncStorage / safe-area-context / reanimated mocks |
| CI | `.github/workflows/ci.yml` | `npm ci` (exercises the patch-package postinstall — a broken expo-audio patch, F-001's failure mode, now fails CI loudly) → `typecheck` → `jest --ci`, on every push/PR |
| Types | `@types/jest` pinned to **^29** | v30 types don't provide globals against jest 29 (typecheck broke) |

### Test layout convention (documented in CLAUDE.md › Testing)
- `src/<module>/__tests__/*.test.ts` — colocated unit tests for pure logic.
- `tests/screens/*.test.tsx` — component tests. **Not** inside `app/`: Expo Router would
  register a colocated test file as a route.
- Component tests mock at the **hook seam** (`@/hooks/*`) + `expo-router`; api-layer unit
  tests mock `@/lib/supabase`. Nothing ever talks to a real backend.
- Assertions target user-visible **Arabic copy**, so the suite also pins the
  no-English-leakage requirement (F-030/F-054) for free.

## 2. Unit tests — pure logic (74 tests)

| Suite | Covers | Audited invariants pinned |
|---|---|---|
| `src/lib/__tests__/format.test.ts` (19) | `arNum`, `arDuration`, `arDayCount` & the other count labels, `arDate`/`arSince`, file-size/speed | Arabic dual/plural rules (the F-044 class of bug), Arabic-Indic digits, clamp/garbage handling, frozen-clock `arSince` buckets |
| `src/lib/__tests__/outboxQueue.test.ts` (15) | offline outbox storage | coalescing per (lecture, day); completed-flag never revoked by a later tick; negative-delta clamp; 120-entry cap drops oldest **days**; **F-025**: `clearQueue` keeps the array reference + bumps the generation counter (identity-boundary contract); persistence across module reload; corrupt-JSON degrade; `localDay()` is device-local (**F-043** contract) |
| `src/lib/__tests__/resumeCache.test.ts` (8) | resume-position sidecar | save→read round-trip (rounded, clamped), last-active pointer, corrupt-file degrade to null (in-memory expo-file-system fake) |
| `src/lib/__tests__/notificationPhrases.test.ts` (7) | `pickPhrase` | full round-robin + wraparound, no back-to-back repeats, per-event cursor independence, placeholder interpolation, bank hygiene (all Arabic, no English) |
| `src/lib/__tests__/errorText.test.ts` (6) | `arabicOr` (**F-054**), `arabicAuthError` (**F-030**) | Arabic server reasons pass verbatim; English/garbage always falls back to calm Arabic; the GoTrue mapping table |
| `src/constants/__tests__/badges.test.ts` (5) | badge catalog | unique keys, `kind_threshold` key shape (DB join key), exact milestone sets 1/5/10/25/50 & 3/7/30/100, Arabic copy |
| `src/api/__tests__/quizStatus.test.ts` (8) | `mapCard`/status derivation | precedence in_progress > passed > not_started > exhausted > failed; unlimited attempts never "exhausted"; null-guards |
| `src/api/__tests__/journeyLocalDay.test.ts` (6) | `rpcWithLocalToday` (**F-043/F-049** shim) | `p_today = localDay()` on the post-0090 path; PGRST202 fallback + session memoization; real errors NOT swallowed by the fallback; read-mapper null-guards |

## 3. Component tests — the 5 most defect-dense components (46 tests)

Chosen from `audit/FINDINGS.md` by findings-per-file:

| Component | Findings | Suite |
|---|---|---|
| `app/(student)/quiz-attempt/[attemptId].tsx` | F-051 P1, F-052, F-053, F-054 (4) | `tests/screens/quiz-attempt.test.tsx` (12) |
| `app/(auth)/register.tsx` | F-026 P1, F-029, F-030, F-032 (4) | `tests/screens/register.test.tsx` (8) |
| `app/(student)/edit-profile.tsx` | F-029, F-031, F-032, F-035 (4) | `tests/screens/edit-profile.test.tsx` (8) |
| `src/components/journey/BuddyCompareCard.tsx` | F-045, F-050 (2) | `tests/screens/buddy-compare-card.test.tsx` (9) |
| `app/(auth)/reset-password.tsx` | F-028 (1) | `tests/screens/reset-password.test.tsx` (6) |

(5th place was a tie among one-finding components; reset-password won over ContinueCard
because F-028's failure mode — burning the single-use recovery code — has the richest
regression scenario and sits on the account-recovery path.)

Highlights, by finding:
- **F-051** — the exact regression is reproduced: fake wall clock jumps 2 minutes past the
  deadline with **no timer ticks** (backgrounded), then an AppState `active` event must
  fire the auto-submit immediately; plus deterministic countdown, auto-submit at zero, and
  retry-after-failed-auto-submit.
- **F-052** — failed load renders the calm Arabic exit (no forever-spinner); already-
  submitted attempts redirect to their result.
- **F-053** — a failed submit shows the danger banner and stays retryable; a successful
  submit never double-fires.
- **F-054** — server's Arabic refusal renders verbatim; English noise becomes the generic
  connectivity line (asserted at the screen level and in the `arabicOr` unit).
- **F-026** — a non-guest session hitting /register renders `<Redirect href="/">` and never
  the form; the guard stays inert mid-mutation (can't race the success redirect).
- **F-028** — short password rejected **before** the code is consumed; a retry after a
  failed password write must **not** re-verify the consumed code (asserted call counts);
  resend starts a fresh verify cycle.
- **F-029** — min-8 gates on register + edit-profile keep submit inert client-side.
- **F-032** — oath modal: mutation fires only after the checkbox; «رجوع» clears it.
- **F-045** — every phrase branch fully feminine for female users, masculine set intact,
  zero-target goal never congratulated.

## 4. Infrastructure findings hit during the phase (all resolved in-phase)

1. **RNTL 14 async API** — `render`, `fireEvent`, `act`, `unmount` all return promises; a
   dangling (un-awaited) `unmount()` polluted subsequent renders in the same file
   (symptoms looked like wrong phrase branches). Convention documented: await everything.
2. **Reanimated 4 / react-native-worklets under Jest** — the official
   `react-native-reanimated/mock` itself boots the native worklets runtime and throws; the
   fix is the resolver worklets ships (`react-native-worklets/jest/resolver.js`) *plus* the
   reanimated mock.
3. **safe-area-context / AsyncStorage jest mocks** — ESM-default vs CJS interop differences;
   handled once in `tests/setup.ts`.
4. **`@types/jest@30` vs `jest@29`** — v30 types stopped providing usable globals;
   pinned `@types/jest@^29`.
5. **Jest module registry vs AsyncStorage instance identity** — after `jest.resetModules()`
   a re-required module sees a **fresh** AsyncStorage mock; tests that simulate an app
   restart must seed the *new* instance (pattern captured in `outboxQueue.test.ts`).

## 5. Contract tests against staging (task 3 — DONE, second pass)

F-002 was resolved mid-phase by a parallel session (staging project seeded, commit
`58dca65`), unblocking this. `tests/contract/api.contract.test.ts` (7 tests, run via
**`npm run test:contract`**, own `jest.contract.config.js` — node environment, real
network, anon-key clients only) verifies against live staging:
- anonymous sign-in enabled; a fresh guest reads **zero** rows of private tables (notes RLS);
- `lectures` select exposes only `status='published'` (the draft-invisibility RLS contract);
- `get_home_page` callable by guests;
- the **F-043/0090 contract**: `get_streak_status`/`get_journey_summary` either accept
  `p_today` or fail with exactly `PGRST202` (the only code `rpcWithLocalToday`'s fallback
  keys on), and the summary row shape matches `SummaryRow`;
- `get_section_quizzes` rows match `RawStatusRow` (mapCard's input).

Deliberately excluded from `npm test` and CI (network + secrets); `tests/contract/setup.ts`
hard-refuses to run against the production project ref (audit staging-only rule).

## 5b. Deliberately deferred (from the phase task list)
- **Maestro smoke flows** (task 5, "optional — user decides"): not set up; the Phase 11
  smoke script doesn't exist yet either. Recommend deciding at Phase 11/13.
- **Release-config check** (`NOTIF_TEST_MODE` etc.) remains a Phase 13 deliverable
  (`scripts/release-check.mjs`); CI here covers typecheck + tests only.

## 6. Exit criteria

- ✅ `npm test` green — 13 suites / 120 tests, guarding the audited invariants listed above.
- ✅ `npm run typecheck` green with the test files included.
- ✅ CI workflow in place (`.github/workflows/ci.yml`); red/green demonstrated locally via
  the same commands CI runs (`npm ci` → typecheck → `jest --ci`). First remote run will
  happen when this branch is pushed.
- ✅ Testing conventions documented in CLAUDE.md.
