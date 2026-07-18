# Phase 7 report — Community (Q&A, voice notes, benefits, notes, buddy, moderation)

**Branch** `audit/phase-7-community` (cut from `audit/phase-12-tests`, so the Jest
harness + latest FINDINGS are available for regression tests).
**Scope** `questions.tsx`, `lecture-questions/[id]`, `lecture-benefits/[id]`,
`lecture-note/[id]`, `buddy-search.tsx`, `components/questions/*`
(`QuestionsBoard`, `AnswerThread`, `ModeratorAnswerComposer`, `VoiceRecorder`,
`VoiceNotePlayer`), `components/reports/ReportSheet`, `sheikh/index.tsx` (answering
side), `src/api/{questions,benefits,notes,reports,buddy}.ts`,
`src/hooks/{useQuestions,useBenefits,useNotes,useReports,useBuddy}.ts`, and the
Q&A/benefit/buddy/report/answer SQL (0028–0032, 0030, 0051–0053, 0059, 0077,
0078, 0080–0088, 0084–0086).
**Findings** F-056 (P1, fixed), F-057 (P2, fixed), F-058 (P3, logged).
**Deliverables** anonymity memo (`audit/reports/phase-7-anonymity-memo.md`),
migrations 0091 + 0092 (applied to staging, **authored-not-applied to prod**),
client fix in `useQuestions.ts`, three regression tests (2 contract, 1 unit).

---

## 1. Anonymity at the network layer (the headline task)

Verified with anon-key clients as asker `user@`, other viewer `publisher@`, and
`sheikh@`, inspecting raw RPC payloads **and** every raw table read each JWT is
entitled to. Full narrative in the anonymity memo. Summary:

| Path | Result |
|---|---|
| `get_public_questions` (other viewer) | `asker_display = null` for anonymous — ✅ |
| `get_question_inbox` (sheikh) | `asker_display = 'سائل'`, `asker_id = null` — ✅ |
| `get_question_answers` | answerer identity only, never asker — ✅ |
| `get_lecture_benefits` | selects `id, body, is_mine, created_at`; no `user_id` — ✅ |
| **sheikh raw `from('questions').select('asker_id')`** | **leaked real `asker_id` of an anonymous question — ✗ (F-056)** |
| sheikh raw `from('lecture_benefits').select('user_id')` | exposes author `user_id` — by design for staff moderation (F-058) |
| other student raw `from('questions')` | 0 rows (own-only) — ✅ |

### F-056 (P1) — Q&A anonymity bypass via the raw `questions` table
The 0028 RLS policy `questions_select_own_or_moderator` granted moderators a raw
SELECT over `public.questions`, which includes `asker_id` and `is_anonymous`. Every
*legitimate* moderator read, however, goes through `SECURITY DEFINER` RPCs
(`get_question_inbox`, 0077/0084) that return `'سائل'`/`null` for anonymous askers
and ship `asker_id` to admins only. The raw-table branch bypassed all of it: a
**sheikh** could read the true `asker_id` of an anonymous question and correlate it —
via the shared stable UUID — with a named question by the same person (whose name the
inbox reveals), deanonymising the asker. This defeats the explicit 0077 guarantee and
leaks precisely to the sheikh, the party anonymity shields the asker from.
**Confirmed live** (sheikh raw select returned the asker's real UUID).

**Fix — migration 0091:** drop the moderator branch → `questions_select_own`
(`asker_id = auth.uid()`). All moderator access already flows through RLS-exempt
DEFINER RPCs; no client does a raw `from('questions')` select (verified repo-wide).
**Re-verified on staging:** sheikh raw select → 0 rows; inbox/answer/public paths
unchanged. Locked as the F-056 contract regression.

## 2. Answer-thread correctness

### F-057 (P2) — editing a question leaves a stale answer under the new text
`update_own_question` (0078) resets a question to `pending` and clears the *mirror*
answer columns when the body changes — its own comment states «a stale answer must
never sit under new text». But 0086 later moved answers into `question_answers` and
mirrored only the latest back. 0078 was never updated, so a body edit cleared the
mirror yet left the `question_answers` rows. `get_question_answers` reads that table,
so once the edited question is answered again the **old** answer reappears **above** the
new one — the exact stale pairing 0078 forbids, and for a sheikh-audience question it
can resurface a private prior answer under unrelated new text.
**Confirmed live:** edit body → re-answer → thread = `[old answer, new answer]`.

**Fix — migration 0092:** recreate `update_own_question` (0078 body verbatim) and,
on a changed body, also `delete from question_answers where question_id = p_id` and
clear `answer_audio_path` (the 0078 version cleared `answer_body` but not the voice
mirror key — a second latent stale leak). **Client leg** (`useQuestions.ts`): the
edit mutation now invalidates the whole `['questions']` root, so the cached
`['questions','answers',id]` thread is dropped too (the old `mine`+`public`-only
invalidation missed it). **Re-verified on staging:** edit → re-answer → thread =
`[new answer]` only. Locked as the F-057 contract + unit regressions.

## 3. Multi-user flows exercised (two accounts + seeded sheikh)

- **Q&A end-to-end:** ask (anon public / named / sheikh-only) → sheikh inbox → answer
  (append semantics, 0086) → asker + public views. Anonymity holds at every hop (§1).
- **Study buddy round-trip** (genders set via service key, then restored): same-gender
  search → invite → incoming → accept → mutual pairing → duplicate-invite guard
  («هذا الطالب رفيقك بالفعل») → cancel. Gender guard confirmed: a no-gender / cross-role
  invite is rejected («لا يمكن إرسال هذه الدعوة») and search returns empty without gender.
  Guest/anonymous guards (0088, live on staging) confirmed via `security-check` —
  `send_buddy_request` rejected for anonymous JWTs.
- **Reports:** `report_content` succeeds for a **guest** (anonymous) session — guests may
  report, as designed.
- **security-check.mjs** against staging: **20/20 pass** (incl. guest gates on
  `ask_question`, `add_lecture_benefit`, `send_buddy_request`).

## 4. Reviewed and found correct (no change)

- **Voice answers** (`VoiceRecorder`/`VoiceNotePlayer`/`ModeratorAnswerComposer`):
  mic-permission denial path, pause/resume/preview, upload-then-`answer_question`
  ordering, at-least-one-of-text/audio gate (mirrors SQL), per-note isolated player
  released on unmount, RTL seek geometry. `can_read_storage_object` (`answers/%`, 0086)
  gates by moderator / asker / public-answered — the correct anonymity-preserving set.
- **Private notes** (`lecture-note/[id]`, `useSaveNote`): own-rows RLS (0029); debounced
  autosave with an unmount flush routed through the mutation so an offline back-out is
  captured optimistically and queued in the outbox (F-025 identity-boundary clearing from
  Phase 3 already covers cross-identity replay).
- **Benefits lifecycle** (`lecture-benefits/[id]`): anonymous post → `is_mine` own-delete →
  report → admin moderation. `get_lecture_benefits` never selects the author.
- **Blocked-word UX:** `BlockedWordError` (SQLSTATE `BLOCK`) surfaced as calm Arabic on
  ask/update/benefit/report reason.

## 5. Logged (not fixed in-phase)

### F-058 (P3) — staff can deanonymise benefit authors via raw table / `admin_list_benefits`
`lecture_benefits` SELECT is `own_or_staff_viewer` (0081), and `admin_list_benefits`
resolves `author_id`/`author_name` to sheikhs (email nulled for non-admin staff). Unlike
questions this is **consistent with the benefits design** (author resolved for moderation
accountability; 0081 deliberately widened admin→sheikh, Phase-2-reviewed). Recorded as a
**product decision**: should benefit authorship be visible to sheikhs, or admins only?
No code change pending that ruling. Not a network-layer *regression* — the RPC path already
sanctions it.

## 6. Verification status

- `npm run typecheck` — **clean** (incidentally cleared a pre-existing Phase 12 contract-setup
  node-types error while extending that suite).
- `npm test` — **136 passed** (16 suites), incl. the new F-057 unit test.
- `npm run test:contract` — **9 passed** live against staging, incl. F-056 + F-057 regressions.
- `/security-review` over the diff — **no HIGH/MEDIUM findings**; 0091/0092 are net hardening.

## 7. Owner actions

1. ~~Apply migrations 0091 and 0092 to production~~ — **done 2026-07-16.** Both applied to
   staging and production via the Supabase Management API and verified at the schema level
   (prod: `questions_select_own` policy; `update_own_question` clears `question_answers` +
   `answer_audio_path`). No `database.generated.ts` regeneration needed — no RPC
   signature/shape changed. **Remaining:** (a) 0091/0092 are NOT in prod
   `supabase_migrations.schema_migrations` — prod tracks only 0001–0058 while 0059+ (incl.
   these) were applied out-of-band; reconcile the whole range under F-002/F-015 before any
   `supabase db push`. (b) **Revoke the Management API access token** used for the apply.
2. Rule on **F-058** (benefit-author visibility: sheikh vs admin-only).
3. Migration-numbering note: this branch carries 0090 but not 0088/0089 (they live on
   `audit/phase-2-backend`). 0091/0092 have no functional dependency on 0088/0089 and are
   self-consistent on this branch; at merge all of 0088–0092 coexist in order.
