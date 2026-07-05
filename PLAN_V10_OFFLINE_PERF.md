# PLAN V10 — Offline-first + Instant Navigation + Field Fixes

Status: DECIDED — every choice below is locked. The executor does not ask questions.
Owner request (2026-07-05), enhanced into this plan. Latest migration on disk AND live
is `0043_perf_fk_indexes.sql`; new migrations start at **0044** (append-only, never edit
0001–0043). After any migration touching RLS/policies/functions run
`node scripts/security-check.mjs`.

---

## The five deliverables

| # | What | Kind |
|---|------|------|
| A | استعادة المداومة rule change: recovery = **≥ 2 fully-completed lessons within the 3-day window** | SQL + copy |
| B | Section screen dead zone (blue-marked area): quizzes/attachments must scroll into view; nothing hidden behind the system nav bar | client fix |
| C | Instant section navigation: one RPC per section page, prefetch, cached-first render, **no spinner when cache exists** | SQL + client |
| D | Offline-first: persisted query cache; home/sections/lecture names/notes readable offline; downloaded lectures playable offline | client (+1 dep pair) |
| E | `/downloads` crash fix (GLITCH_LOG #20 — infinite render loop) | client fix |

Build order: **E → B → A → C → D** (crash first — it blocks verifying D; the two small
fixes next; the two big interlocking ones last, C before D because D persists whatever
C's query shapes are).

---

## A) استعادة المداومة — new recovery bar

**Current** (`supabase/migrations/0014_daily_streak_recovery.sql`,
`record_meaningful_activity`, line ~212): recovery fires on the first meaningful flip of
the day when `v_seconds >= 240 OR v_lectures >= 2 OR p_completed` — i.e. 4 minutes, or
2 *listened* lectures, or 1 completion, **today only**.

**New rule (owner's wording):** استعادة المداومة تتم بحضور درسين كاملين على الأقل خلال
الثلاثة أيام — recovery requires **at least 2 lectures fully completed within the 3-day
recovery window** (from `broke_at` through today). Minutes-listened and single
completions no longer qualify.

### Migration `0044_streak_recovery_two_lessons.sql`
1. `alter table public.user_lecture_progress add column if not exists completed_at timestamptz;`
   Backfill: `update ... set completed_at = updated_at where completed and completed_at is null;`
   Wherever `completed` flips to true (find the write path — `src/api/progress.ts` /
   the progress-upsert RPC if one exists), stamp `completed_at = now()` **only on the
   false→true transition** (never overwrite an earlier stamp).
2. `create or replace function public.record_meaningful_activity(...)` — same signature
   (client callsites untouched). Keep the meaningful-flip logic (120s/completion gate at
   line ~193) EXACTLY as is; replace only the compensatory bar:
   ```sql
   -- Recovery bar: ≥2 lectures completed inside the window [v_broke_at .. today].
   select count(*) into v_completed_in_window
     from public.user_lecture_progress
    where user_id = v_uid and completed
      and completed_at >= v_broke_at::timestamptz;
   if v_completed_in_window < 2 then return; end if;
   ```
   (`v_broke_at` = the existing `broke_at` from `streak_recovery_state`; everything
   after the bar — gap bridging, `recovered_at` stamp, 30-day cooldown — unchanged.)
3. Keep the 30-day cooldown and 3–5-day gap detection exactly as in 0014.

### Copy updates (client)
- `src/components/home/StreakCard.tsx:165` — replace
  «استمع اليوم إلى درسين، أو أربع دقائق من الاستماع، وتعود مداومتك كما كانت تلقائياً.»
  with: «أكمل درسين كاملين على الأقل خلال أيام المهلة الثلاثة، وتعود مداومتك كما كانت تلقائياً.»
- `src/components/journey/StreakDetailCard.tsx:45` — replace «درسان أو أربع دقائق
  استماع اليوم» with «درسان كاملان خلال المهلة».
- Grep `أربع دقائق` across `src/` + `supabase/functions/` (reminder-cron phrasing from
  V7 lives somewhere around `notificationPhrases.ts` / the broadcast crons) and fix any
  other description of the old bar.

---

## B) Section screen bottom dead zone (the blue-marked area)

**Diagnosis.** `app/(student)/section/[id].tsx` renders
`<Screen scroll={false} padded bottomPad={118}>` and `src/components/ui/Screen.tsx:31`
applies `paddingBottom: bottomPad + insets.bottom` to the OUTER container. With
`scroll={false}` the FlatList (flex:1) sits INSIDE that padding, so ~118px + inset is
reserved permanently **outside the scrollable area** — a dead band above the system nav
even when the MiniPlayer isn't mounted — and the ListFooter (QuizListCard «اختبر هذا
العنصر» + AttachmentList) gets clipped right at that band, exactly the owner's
screenshot.

**Fix (do all three):**
1. In `section/[id].tsx` pass `bottomPad={0}` to `Screen` and instead give the FlatList
   `contentContainerStyle={{ paddingBottom: <miniPlayerPad> + insets.bottom + 24 }}`
   (use `useSafeAreaInsets`). The footer then scrolls fully into view; nothing hides
   behind the phone's buttons.
2. `<miniPlayerPad>` is **conditional**: read the player store (the same signal
   `src/components/MiniPlayer.tsx` mounts on — a current-lecture/visible flag in
   `src/stores/*player*`) — 118 when the MiniPlayer is showing, 0 when not. No more
   permanently reserved band.
3. Audit the OTHER student screens that hardcode `bottomPad={118}` (grep `bottomPad`) —
   apply the same conditional treatment ONLY where the screen scrolls its own list
   (`scroll={false}` + inner list); plain `scroll` screens already pad inside their
   ScrollView and just need the conditional 118→0.

The quizzes block itself already renders (ListFooterComponent, line 164–180) — this is
purely an inset/clipping fix; no data change. After the fix the «اختبر هذا العنصر» card
must be fully visible above the nav bar in the owner's exact scenario (section with 3
lectures + 1 quiz).

---

## C) Instant navigation between الأقسام العلمية

**Diagnosis.** `getSectionPage` (`src/api/sections.ts:117`) makes ~6 **sequential**
round-trips per tap (section+rollup → parent title → children → children rollups →
lectures+progress → attachments → quizzes). At 100–300ms each over mobile data that's
the multi-second «العقيدة» open the owner sees — even for empty sections. The screen
also renders a full-screen ActivityIndicator on every `isLoading`.

### C1 — one RPC per section page. Migration `0045_get_section_page.sql`
`create or replace function public.get_section_page(p_section_id uuid) returns jsonb`
— `security invoker`, `stable`, `set search_path = ''` (match 0042's pinning
convention). It returns ONE jsonb document:
```
{ section:{id,title,description,cover_image,cover_letter,show_header,parent_id},
  parent_title, rollup:{total,completed,sheikh_names},
  subsections:[{id,title,cover_letter,total,completed}],
  lectures:[{id,title,duration_sec,order,sheikh_name,position_sec,completed}],
  attachments:[...same columns the client reads today...],
  quizzes:[...same shape getSectionQuizzes returns...] }
```
Internally it reuses the EXISTING `get_section_rollup` / `get_children_rollups`
functions (don't duplicate the recursive CTEs) and joins progress as
`user_lecture_progress` for `auth.uid()`. RLS still applies (invoker) — published-only
for students falls out of existing policies. `grant execute to authenticated, anon;`
(guests browse too — verify anon can already read published sections; mirror whatever
0038-era grants do).

Client: `getSectionPage` becomes ONE `supabase.rpc('get_section_page', ...)` + a pure
mapper to the existing `SectionPageData` type. Keep the old multi-query code path ONLY
in `src/mock/api.ts` (USE_MOCK must keep working). Regenerate
`src/types/database.generated.ts` after the migration.

### C2 — cached-first render, no spinner
- `src/lib/queryClient.ts`: raise defaults — `staleTime: 30 * 60_000`,
  `gcTime: 7 * 24 * 3600_000`, `networkMode: 'offlineFirst'`, keep
  `refetchOnWindowFocus: false`, `retry: 1`.
- `useSectionPage` / `useHome`: add `placeholderData: keepPreviousData` (TanStack v5
  import from `@tanstack/react-query`).
- `section/[id].tsx`: only show the ActivityIndicator when `isLoading && !data` (i.e.
  a genuinely cold cache). With persisted cache (D) that path becomes first-install-only.
  Never show a spinner over existing data — background refetches are silent.

### C3 — prefetch on approach
- Home (`app/(student)/index.tsx` sections grid) and `SubsectionsScroller` /
  section-card components: on mount of each visible section card, fire
  `queryClient.prefetchQuery({ queryKey: queryKeys.section(id), queryFn: () => getSectionPage(id), staleTime: 30 * 60_000 })`
  for its target — by the time the user taps, the page is warm. Cap: prefetch only
  what's rendered (the cards on screen), not the whole tree recursively.
- Keep lecture rows metadata-only (already true — audio URL is fetched on tap via
  `getLecturePlayback`; verify nothing on the section page fetches storage URLs).

---

## D) Offline-first

Two new dev-deps (pure JS, no native rebuild):
`@tanstack/react-query-persist-client` + `@tanstack/query-async-storage-persister`
(match the installed `@tanstack/react-query` major).
`@react-native-async-storage/async-storage` 2.2.0 is ALREADY installed.

1. **Persist the query cache.** In `app/_layout.tsx` swap `QueryClientProvider` for
   `PersistQueryClientProvider` with an async-storage persister:
   `maxAge: 30 * 24 * 3600_000`, `buster: <app version from src/lib/version.ts>`.
   `dehydrateOptions.shouldDehydrateQuery`: persist ONLY successful queries and EXCLUDE
   volatile/private keys — notifications, admin (`queryKeys.*admin*`), quiz attempts,
   questions. Home, sections, lecture lists, notes, journey/streak snapshots DO persist.
   On web use the same persister (async-storage falls back to localStorage) — but
   nothing web-specific is required beyond "don't crash".
2. **Offline reads.** With `networkMode: 'offlineFirst'` + persisted cache, a cold
   offline launch hydrates home + sections + lecture names + notes from disk with no
   spinner (C2's `isLoading && !data` guard). Verify `useNotes`' query keys are in the
   persisted set (owner: «حتى الملاحظات» must open offline).
3. **Auth/guest offline.** Supabase already persists sessions in async-storage. Verify
   the root layout does NOT block render on a network session refresh: an offline cold
   start must reach Home with the cached session/guest state. If there's a blocking
   `getSession()`+network gate, render from the cached session immediately and refresh
   in background.
4. **Playback offline.** `src/lib/audioController.ts:284–354` already prefers
   `localUriFor(lectureId)` + sidecar meta and falls back to it on network error — keep,
   and verify the OFFLINE path end-to-end on device (it must not await
   `getLecturePlayback` before starting a downloaded lecture — read the code; if the
   local branch already skips the network, just prove it). Non-downloaded lectures
   offline: tapping shows a calm inline notice («هذه المحاضرة تحتاج اتصالاً — أو حمّلها
   للاستماع بلا إنترنت»), NOT a spinner, NOT a crash.
5. **No global offline banner work** beyond the above — out of scope.

---

## E) `/downloads` crash (GLITCH_LOG #20 — fix and mark fixed)

`src/hooks/useDownloads.ts:67-73` — `useDownloadedIds()` returns a **fresh array**
(`Object.entries().filter().map()`) from a Zustand selector with no equality fn ⇒ every
store notification re-renders ⇒ "Maximum update depth exceeded", process dies on
Android release.

Fix: wrap with `useShallow` from `zustand/react/shallow`
(`useDownloadsStore(useShallow((s) => ...))`) — zustand v5 pattern; confirm installed
zustand version and use its shallow API accordingly. Audit the rest of the file for the
same smell (`useDownloadedLectures`'s join-key memo can stay once its input is stable).
Then update GLITCH_LOG.md #20 with a "FIXED in V10" note. Re-verify the owner's exact
repro: open app → profile → المحاضرات المحمّلة, on the RELEASE build, with 1+ download
present AND with none.

---

## Verification (device R5CX10P3BPL, release build, USE_MOCK=false)

1. **A:** with a 3–5-day-old break seeded for a test user, complete 1 lecture → streak
   NOT restored; complete a 2nd → restored. 4+ minutes of listening alone → NOT
   restored. Sheet + journey copy show the new wording.
2. **B:** owner's screenshot scenario (كتاب التوحيد: 3 lectures + quiz) — scroll to
   bottom: quiz card fully visible, no dead band, nothing under the system bar; repeat
   with MiniPlayer active (band appears, content still reachable above it).
3. **C:** cold-open العقيدة (cache cleared) — ONE network round trip in the metro/proxy
   log; re-open — instant, zero spinner; tap into a prefetched child — instant.
4. **D:** play a downloaded lecture → force-stop app → airplane mode → relaunch: Home
   renders from cache, sections browsable, lecture names listed, notes open; downloaded
   lecture plays from local file; non-downloaded lecture shows the inline notice.
5. **E:** /downloads opens clean on release build (both empty and populated).
6. `node scripts/security-check.mjs` green after 0044/0045; regenerate DB types.
