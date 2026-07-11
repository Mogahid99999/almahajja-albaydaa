# V14 — Q&A/benefits fixes, support link on Home, buddy admin visibility

Read `CLAUDE.md` first, then the memory index (`memory/MEMORY.md`). This is an
Expo SDK 56 app (Arabic RTL, Supabase). **All decisions below are already made —
implement them directly. Do NOT ask the user to confirm scope, approach, or
whether to proceed; execute the recommended path and report what you did.** If a
detail is genuinely ambiguous and unspecified here, pick the sanest default,
state it in one line, and keep going.

### Ground rules (this repo)
- Migrations are **append-only**, starting at `0077`. Apply them to the LIVE DB
  via the Supabase Management API (no CLI): `SUPABASE_ACCESS_TOKEN` and
  `SUPABASE_PROJECT_ID` are in `.env`. The `/database/query` endpoint 403s
  (Cloudflare 1010) without a browser `User-Agent` header — always send
  `User-Agent: Mozilla/5.0 (...)`.
- **After any migration touching RLS/policies/functions, run
  `node scripts/security-check.mjs`** — all 20 checks must pass.
- Any function created via `drop function` + `create` resets its EXECUTE grant to
  Postgres's default (`PUBLIC`), silently undoing 0039's hardening. **Always**
  `revoke execute on function ... from public, anon;` then
  `grant execute on function ... to authenticated;` (see migration 0039).
- When an RPC's signature/return columns change, update
  `src/types/database.generated.ts`, or cast with `as unknown as <Type>` at the
  call site — the established pattern across `src/api/*`.
- Data access only through `src/api/*`; components never call `supabase`
  directly. Rollups are server-side SQL (recursive CTEs), never client tree
  walking (see the `nested-sections` skill).
- Keep the calm, non-competitive, RTL Arabic tone. No leaderboards, no ranking
  between students.
- Verify each change for real (`npx tsc --noEmit` minimum; run in the
  browser/device when there's a UI surface to observe — use the `run` skill).

---

## 1) Anonymous questions: hide the name from the sheikh AND the admin

**Current behavior (intentional, must change):** `get_question_inbox` in
`supabase/migrations/0070_question_category.sql` deliberately reveals the real
name to admins even for anonymous questions:
```sql
case
  when not q.is_anonymous then coalesce(p.display_name, 'طالب علم')
  when public.is_admin()  then coalesce(p.display_name, 'طالب علم')   -- remove this branch
  else 'سائل'
end
```

**Decision (locked):** When the asker chose "إخفاء الاسم", the displayed name must
be `'سائل'` for **both** sheikh and admin. **Keep `asker_id` for admins** so the
"حظر الكاتب" (ban author) action in `app/admin/questions.tsx` still works — only
the *displayed name* is hidden, not the moderation capability.

**Implement (migration `0077`):** Recreate `get_question_inbox` so
`asker_display` = `'سائل'` whenever `q.is_anonymous`, regardless of role; leave
`case when public.is_admin() then q.asker_id else null end` unchanged. Preserve
all current params/columns (it also gains `section_parent_title` in item 2 —
combine both changes into this one recreation). Verify `app/admin/questions.tsx`
and the sheikh Q&A screen never render the name from any other source. Benefits
(`فوائد الدارسين`) are already fully anonymous (`get_lecture_benefits` returns no
identity); leave benefit anonymity as-is.

## 2) Show "القسم ← الدرس" (section + lesson), not just the lesson title

**Decision (locked):** Only the lesson's **direct parent section** is needed —
NOT the full recursive path. So: `parent_section_title` + `lecture_title`.

**Current:** `get_question_inbox` returns `lecture_title` only
(`0070_question_category.sql`); `admin_list_benefits` returns `lecture_title`
only (`0030_lecture_benefits.sql`). Neither returns the section.

**Implement:**
- Migration `0077`: recreate `get_question_inbox` to also return
  `section_title text` = the title of the section the lesson belongs to
  (`lectures.section_id → sections.title`). No recursion needed — one join to the
  lesson's direct parent section.
- Migration `0078` (or fold into 0077): recreate `admin_list_benefits` to also
  return `section_title text` the same way.
- Update `src/api/*` (types + mapRow) and the screens that render these
  (`app/admin/questions.tsx`; the benefits/contributions screen —
  `app/admin/contributions.tsx` or whichever shows فوائد الدارسين; and the sheikh
  screen) to display "«{section_title} ← {lecture_title}»". If a question is
  general (no lecture), show nothing extra.

## 3) Let the asker edit their own question and flip privacy (private → public)

**Current:** No edit RPC exists (`0032_set_question_hidden.sql` is
moderation-only), and `questions` has no owner UPDATE policy (edits go only via
RPCs). `get_my_questions` already returns `body`, `audience`, `status`,
`category`, `is_anonymous`.

**Decision (locked):** Allow editing the body, the `audience`
(`sheikh` ↔ `public`), and the `category`. **Allow editing even after it has
been answered**, but when an answered question's body changes, reset its status
to `pending` and clear the old answer (so a stale answer never sits under new
text); an unchanged-body privacy/category flip keeps the answer. (Sane default —
state it and proceed.)

**Implement (migration `0078`):** Add
`update_own_question(p_id uuid, p_body text, p_audience text, p_category text)`,
`security definer`, `search_path = public`:
- require `auth.uid()` = the row's `asker_id` (else raise);
- validate exactly like `ask_question`: body length 3–2000,
  `audience in ('public','sheikh')`, `category in ('general','fatwa')`;
- if the new body differs from the stored body, set
  `status='pending', answer_body=null, answered_by=null, answered_at=null`;
  otherwise leave the answer intact;
- update `audience`/`category` in all cases.
`revoke`/`grant` as per the ground rules.

Client: in the shared board `src/components/questions/QuestionsBoard.tsx` and the
screen `app/(student)/questions.tsx`, add an "تعديل" affordance shown only for
the user's own questions (`is_mine` / from `get_my_questions`), with an inline
editor (body + a private↔public toggle + category). Add a mutation hook in
`src/hooks/*` that invalidates the my-questions + public-questions query keys on
success. Do not touch `is_anonymous` (out of scope).

## 4) Support/Telegram contact button on the Home screen

**Context:** The owner already changed the sign-in support line to a **Telegram**
icon + label, still driven by the existing `support_whatsapp_url` config key via
`getSupportContact()` (`src/api/appContent.ts`). See the exact render in
`app/(auth)/sign-in.tsx` lines ~176–200 (`FontAwesome name="telegram"`,
`Linking.openURL(supportUrl)`, label "هل لديك مشكلة؟ تواصل مع الدعم الفني
للمنصة", `accentBrassMuted` icon).

**Decision (locked):** Add the **same** button to the Home screen, in **addition**
to the existing one (don't remove sign-in's). Same Telegram icon/label, same
`support_whatsapp_url` key, same "empty = hidden" rule, same admin control — the
key is already in `SETTINGS_KEYS`/`getAppConfigForAdmin`, so **no admin or
backend change is needed**.

**Implement (client only, no migration):** In `app/(student)/index.tsx`, read
`support_whatsapp_url` via the existing hook (`src/hooks/useAppContent.ts` —
reuse/extend `useSupportContact` if present, else the same query), and render the
Telegram contact row only when the value is non-empty. Reuse the sign-in visual
(extract a small shared `SupportContactLink` component from sign-in so both
screens share one implementation — preferred over duplicating). Place it calmly
(e.g. below the main rails / near the footer), RTL, muted palette.

## 5) Admin visibility into "رفيق الدراسة" (study buddy)

**Current:** No admin read exists — only `get_buddy_status` (caller's own buddy)
and `search_buddy_candidates` (student-facing). Accepted pairs live in
`public.buddy_requests` with `status='accepted'` (`0015_study_buddy.sql`).
"Enabled the feature" = the student set `profiles.gender` (the prerequisite to
appear in buddy search).

**Decision (locked):** "من فعّل الميزة" = students with a non-null
`profiles.gender`. Show: count of feature-enabled students, count of active pairs
(`status='accepted'`, de-duplicated so each pair counts once), and the list of
active pairs with both display names. Include pending-request count as a small
extra. Non-competitive — plain counts + a pair list, no ranking.

**Implement (migration `0079` + new admin screen):**
- `admin_buddy_overview()` — `security definer`, gated on `is_admin()`, returns
  one jsonb: `{ enabled_count, active_pairs_count, pending_count, pairs: [{ a_name, b_name, since }] }`.
  Resolve names via `profiles.display_name` inside the DEFINER (profiles RLS is
  own-only). De-dup pairs (e.g. only rows where `from_user_id < to_user_id`, or
  `distinct` on the unordered pair). `revoke`/`grant` per the ground rules.
- Add `app/admin/buddies.tsx` and a nav item in
  `src/components/admin/AdminShell.tsx` (`NAV_ITEMS`, `adminOnly: true`), wired
  through a hook in `src/hooks/*` and an `src/api/*` function. Follow the calm
  admin styling used by the other admin screens (stat tiles + a simple list).

---

## Note: "not compatible with your phone" APK install error — NO action needed now

Root cause identified: `android/app/build.gradle` enables per-ABI splits with
`universalApk false` (`include "armeabi-v7a", "arm64-v8a"`), so a manual
`assembleRelease` emits one APK per ABI and no universal APK; sideloading the
wrong-ABI file yields this exact error. **Decision (locked):** The future store
release uses AAB (`bundleRelease`), where the split block is auto-disabled and
Google Play does per-device splitting — that path already avoids the problem, so
**do NOT change the build config or spend time on this now.** (For a one-off
manual install today, sideload the `arm64-v8a` APK, which fits modern devices —
informational only.)

---

## Definition of done
- `node scripts/security-check.mjs` → 20/20; `npx tsc --noEmit` clean.
- New migrations `0077`+ applied to the live DB and verified (query the recreated
  functions; check grants are `authenticated`-only, not `PUBLIC`).
- Items 1–5 exercised in the browser/device.
- Update memory with the V14 state (new migrations, the locked decisions above,
  what was device-verified).
