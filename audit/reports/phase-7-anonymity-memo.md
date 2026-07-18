# Phase 7 — Q&A / UGC Anonymity Verification Memo

**Question the phase was asked to answer:** is the asker's identity actually hidden
where the product promises it — verified at the *network layer* (the raw bytes each
party's session can retrieve), not merely in the UI?

**Method.** Anon-key clients (the same key shipped in the app bundle) signing in as three
seeded staging identities — asker `user@` (student), a second student/other viewer
`publisher@`, and `sheikh@` — then calling every RPC *and* attempting raw PostgREST table
reads that each JWT is entitled to, inspecting the returned payloads. Staging only
(`xjtpwcwotuflomqigzfa`); production ref hard-guarded. All probes are archived in the
Phase 7 report; the two load-bearing ones are now permanent contract regressions
(`tests/contract/api.contract.test.ts`, F-056 / F-057).

## What the promise is

| Surface | Stated guarantee | Source |
|---|---|---|
| Anonymous question (`is_anonymous`) | asker name hidden from **everyone incl. admin**; `asker_id` to **admins only** (for «حظر الكاتب»), never to sheikhs | migration 0077 header; `QuestionsBoard` copy «يُعرض دون اسمك» |
| Sheikh-audience question («للشيخ فقط») | body reaches only asker + moderators | 0028 design |
| Shared benefit (فائدة) | «تُنشر دون اسمك دائماً»; author resolved **only** through admin/staff moderation RPCs | `api/benefits.ts`; 0030/0081 |
| Private note (ملاحظة) | strictly private, own-rows only | 0029 |

## What the RPC layer does (correct)

- `get_public_questions` → `asker_display = null` for anonymous questions; only
  published + public rows. Verified: other viewer sees `asker_display = null`, `is_mine = false`.
- `get_question_inbox` (0077/0084) → `asker_display = 'سائل'` for anonymous **even to
  admin**; `asker_id` shipped **only** when `is_admin()`. Verified: sheikh sees
  `{ asker_display: 'سائل', asker_id: null }`.
- `get_question_answers` → returns only the answerer (moderator) identity, never the asker.
- `get_lecture_benefits` → columns `id, body, is_mine, created_at` — `user_id` is never selected.

The UI, which consumes only these RPCs, is anonymity-clean.

## What the network layer exposed (the finding)

**The RPC is not the only endpoint a moderator's JWT can reach.** Row-Level Security on the
base tables is a *parallel* path, and it was looser than the RPCs:

- **`questions` (F-056, P1 — fixed).** The 0028 policy
  `questions_select_own_or_moderator … using (asker_id = auth.uid() OR is_moderator())`
  let a **sheikh** run
  `from('questions').select('asker_id, is_anonymous, body')`
  and read the **real `asker_id`** of an *anonymous* question whose inbox row correctly
  said `'سائل'` / `null`. Because `asker_id` is a stable per-user UUID, a sheikh can
  correlate an anonymous question with any *named* question by the same asker (whose name
  the inbox/public list reveals) — or simply cluster all "anonymous" questions by author —
  and **deanonymise**. This directly defeats the 0077 guarantee, and specifically leaks to
  the sheikh, the one party anonymity is meant to shield the asker from.
  **Confirmed live:** raw select returned `asker_id = c9d6…193de` for the anonymous row.

- **`lecture_benefits` (documented, not a new defect).** The `own_or_staff_viewer` SELECT
  policy (0081) similarly lets a sheikh raw-read `user_id` of every benefit. Unlike
  questions, this is **consistent with the benefits design**: `admin_list_benefits` already
  resolves the author to staff for moderation accountability (0081 widened it from admin to
  sheikh, a Phase-2-reviewed decision). No new exposure beyond the sanctioned moderation
  path; logged as **F-058, P3** for a product decision on whether sheikhs (vs admins only)
  should deanonymise benefit authors.

## The fix and its proof

**Migration 0091** drops the moderator branch from the `questions` SELECT policy →
`questions_select_own` (own rows only). Every legitimate moderator read already flows
through `SECURITY DEFINER` RPCs, which bypass RLS, so nothing legitimate depends on the raw
moderator select, and no client calls `from('questions')` directly (verified repo-wide).

**Verified on staging after applying 0091:**
- sheikh `from('questions').select('asker_id')` → **0 rows** (was leaking `asker_id`);
- `get_question_inbox` still returns `'سائل'` / `null` and answering still works;
- `get_public_questions` still anonymous; asker still reads their own via the DEFINER RPC.

Locked as the **F-056 regression** contract test.

## Verdict

**Anonymity now holds at the network layer for questions.** The asker's identity is
unreachable by a sheikh through any endpoint their JWT can hit — RPC or raw table — and
reaches admins only as an opaque `asker_id` for banning, exactly as 0077 intends. Benefits
deanonymisation by staff remains **by design** (F-058 flags it for an explicit product
ruling). Private notes and sheikh-audience routing were verified unchanged and correct.

**Applied to production (2026-07-16).** 0091 and 0092 were applied to both staging and
production via the Supabase Management API and verified at the schema level (prod policy is
`questions_select_own`; `update_own_question` clears `question_answers` + the audio mirror).
No functional probes were run against production — that would write test rows into real
user data; the schema-level verification is authoritative for a DDL change. Two follow-ups
for the owner: (1) neither migration is recorded in prod `schema_migrations` (out-of-band,
the same drift as 0059+ — reconcile under F-002/F-015 before any `supabase db push`);
(2) **revoke the Management API access token** used for this apply.
