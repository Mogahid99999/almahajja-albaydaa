# Phase 8 report — Quizzes

**Branch** `audit/phase-8-quizzes` (stacked on `audit/phase-6-journey`).
**Scope** `app/(student)/quiz/[id].tsx`, `quiz-attempt/[attemptId].tsx`,
`quiz-result/[attemptId].tsx`, `src/hooks/useQuizzes.ts`, `src/api/quizzes.ts`,
`src/components/quiz/*`, quiz SQL: 0017 (core), 0018 (publish fan-out),
0023 (publisher policies), 0081 (sheikh staff viewer), section-page embed (0045).
**Findings** F-051 (P1, fixed), F-052/F-053 (P2, fixed), F-054 (P3, fixed),
F-055 (P3, logged → Phase 10 quiz editor).

---

## 1. Server-side integrity verification (read from 0017/0023/0081; guest gate probed live)

| Attack / property | Verdict |
|---|---|
| Answer key in any pre-submit payload | **Clean.** Students have NO select on `quiz_questions`/`quiz_options` (admin/content-manager-only RLS); the solver payload comes exclusively from DEFINER `get_attempt_questions`, which builds options as `{id, text, order}` only. `quizzes` rows readable directly are content-free (title/thresholds). |
| Grading | Server-side in `submit_quiz_attempt` (sum of points where the SAVED option `is_correct`); score/passed written server-side. |
| Countdown tampering | `remainingSec` computed on the **server clock** from `started_at`; `save_quiz_answer` refuses past `started_at + time_limit + 30s grace`; submit has no deadline by design — it grades only in-time saves. Device-clock changes are irrelevant to all three. |
| Double-submit race | `select … for update` + idempotent early-return of the stored result. |
| Attempts-left bypass | `start_quiz_attempt` re-checks `max_attempts` server-side (counting **submitted** attempts) and raises Arabic refusals; an in-progress attempt is always reused, never duplicated. Client "disabled button" is UX only. Two-device simultaneous start collapses onto `unique(user_id, quiz_id, attempt_no)` — one side gets a constraint error (now mapped to calm Arabic, F-054). |
| Guest gating | `start_quiz_attempt` raises «يلزم إنشاء حساب لأداء الاختبار» for anonymous JWTs — **verified live** (security-check probe "guest: start_quiz_attempt rejected" passes). Intro shows the register nudge client-side. |
| Cross-student reads | Attempt/answers RLS = own rows (+ admin); result RPCs check `user_id = auth.uid()`; admin results RPCs guard `is_admin()` (widened to sheikh read parity by 0081 — deliberate); `quiz_result_payload` has EXECUTE revoked from `authenticated` entirely (internal only). |
| `is_correct` exposure to staff | Content managers (admin/publisher, 0023) and via admin RPCs the sheikh (0081) — by design; students never. |
| Drafts | Every student RPC filters `status='published'`; direct `quizzes` select policy hides drafts from non-staff. |

`show_result` × `show_correct_answers` (all four combinations walked through
`quiz_result_payload` + the result screen): each switch is honored literally;
(T,T)/(T,F)/(F,F) are coherent; **(F,T)** shows the per-question review while
hiding the score — countable checkmarks reconstruct it (F-055, logged as an
admin-semantics question for the Phase 10 editor pass, not a server bug).

## 2. Client findings & fixes

### F-051 (P1) — countdown froze across backgrounding
The timer decremented state via chained 1-second timeouts. RN freezes JS timers
in background, so a phone call / app-switch mid-attempt returned to a countdown
showing phantom time; zero — the only auto-submit trigger — never fired; every
answer after the real deadline was refused server-side while the banner blamed
connectivity. Integrity held (server clamp), but the user unknowingly "answered"
into the void. **Fix:** the deadline is now a wall-clock timestamp seeded from
the server's `remainingSec`; every tick and every AppState→active recomputes
remaining from it, so foregrounding snaps to truth and auto-submit fires
immediately when the deadline passed in background (and retries if the submit
itself fails). Device-clock edits move only the display; the server clamp is
unchanged.

### F-052 (P2) — infinite spinner on load errors
Attempt + result screens had no error branch (`isLoading || !data` → spinner).
Foreign/bogus ids via deep links (server raises), or offline first-opens, spun
forever. Fixed with calm Arabic error states + «العودة».

### F-053 (P2) — silent submit failure
`onError` only reset the guard ref. Offline submit: sheet closed, button back to
idle, no message — user believes they submitted. Fixed: danger banner (server
Arabic verbatim / connectivity fallback), retry open.

### F-054 (P3) — error copy
Raw `err.message` (English PostgREST noise) on start; save-failure banner always
claimed connectivity even for «انتهى وقت الاختبار»; intro blamed the quiz for
network failures. Fixed via shared `arabicOr()` (`src/lib/errorText.ts`).

## 3. Offline mid-attempt contract (defined & verified)
Quizzes are **online-only** (the outbox deliberately excludes them — outbox.ts
header). The verified contract: picks are kept **locally** and marked unsaved;
each pick attempts an immediate server save (failure → banner, answer retained);
**submit resaves every unconfirmed answer first**, then submits; a failed submit
is now visible (F-053) and retryable; abandoning mid-attempt keeps the attempt
resumable (`in_progress_attempt_id` on the intro/section card) with countdown
continuity from `started_at` server-side. Answers picked offline and never
resaved before the deadline are dropped by the server — by design, matching
"grade only what was saved in time".

## 4. Per-screen checklist — quiz/[id], quiz-attempt/[attemptId], quiz-result/[attemptId]

| Dimension | Result |
|---|---|
| Functional correctness | ✓ after F-051…F-054 |
| Runtime errors / crash paths | ✓ `questions.length === 0` guarded; `current` indexed only after that guard; no unguarded parses |
| Edge cases | ✓ 0-question published quiz → calm empty state; unanswered-questions submit → count in confirm sheet; huge option text wraps (flex:1, lineHeight) |
| Loading / empty / error / offline | ✓ error states added (F-052); intro splits network vs missing (F-054) |
| Guest vs registered | ✓ intro nudge + server-enforced gate (probed live); result/attempt RPCs own-rows |
| Input validation | ✓ option validated server-side against the question's quiz (`إجابة غير صالحة`) |
| State management | ✓ persisted-cache rule confirmed: only `['quizzes','myStats']` dehydrates (attempt/result payloads never hit disk); submit primes the result cache then invalidates `['quizzes']` + `['section']` |
| Navigation | ✓ submitted-attempt deep link replaces to result (no loop — result's back → intro); Android back on confirm modal = «متابعة الحل»; retry uses replace |
| API interaction | ✓ double-submit guarded client (ref + isPending) and server (for update); saves upsert idempotently |
| Security | ✓ §1 table |
| Performance | ✓ one question rendered at a time; no lists to virtualize |
| Memory leaks | ✓ interval + AppState listener cleaned up in the countdown effect; timeout chain removed |
| Accessibility | ✓ options are `accessibilityRole="radio"` with selected state; buttons labeled |
| Small phones / tablet | ✓ single-column, max-width confirm card, no fixed widths |
| RTL / localization | ✓ Arabic-Indic counters (`arNum`/`arQuestionCount`/`arAttemptCount`); progress bar `alignSelf:'flex-end'` for RTL fill; English leakage closed (F-054) |
| Backgrounding / kill / restore | ✓ F-051 fixed; kill-and-reopen resumes via intro (`تابع الاختبار») with saved answers + server-true countdown |
| Network interruption mid-action | ✓ pick→banner+retain; submit→visible error+retry (F-053) |

## 5. Verification record & limitations
- `npm run typecheck` clean. The agent-based review pass was cut short by a
  session limit; the correctness + security verification of the diff was
  completed inline instead (countdown-effect closure/ordering analysis,
  `arabicOr` range check against every 0017 raise, enumeration-oracle check on
  the RPC error paths, persistence-allowlist re-check, retry semantics) — no
  new defects surfaced. Re-running `/code-review` + `/security-review` over
  this branch's diff in a fresh session is a cheap belt-and-braces follow-up.
- Server behaviors verified by reading 0017/0023/0081 and by the live guest-gate
  probe; timed-deadline and two-device races were reasoned from the SQL (locks,
  unique constraint), not exercised live — no staging (F-002). Queue a
  physical-device pass (backgrounding during a real timed attempt) with F-019.
- Attempt-lifecycle diagram:

```
not_started ──start_quiz_attempt──▶ in_progress ──submit (grades in-time saves)──▶ submitted
     ▲                                  │  ▲                                          │
     │                                  │  └── resume (intro/section card,            ├─ passed (sticky; canRetry=false)
     │                                  │      same attempt, server countdown)        └─ failed ──▶ retry allowed while
     │                                  └── abandon (stays in_progress;                   attempts_used < max_attempts,
     │                                      never counts toward max_attempts)             else exhausted
     └── (attempt deleted only via admin quiz delete — cascade)
```

## 6. Exit criteria
- Checklist ×3 screens: **complete**.
- Timing/integrity attacks repelled server-side: **verified in SQL** (clock
  tampering, late saves, double submit, attempts bypass, guest start, foreign
  attempt reads).
- Open items forwarded: F-055 → Phase 10 (quiz editor UX for the (F,T)
  switch combination).
