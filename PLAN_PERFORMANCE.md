# PLAN_PERFORMANCE — deep performance scan findings + phased fix plan

**Written by:** Fable 5 (planning session, 2026-07-04), after code inspection of the
rendering layer, player pipeline, query layer, and asset/startup path.
**Executor:** Sonnet 5, phase by phase, **in order**, and only **after
`PLAN_SECURITY.md` is fully done**. Verify each phase before the next.

## Ground rules for the executor

- Read `CLAUDE.md` first. RTL rules apply to any UI you touch (physical
  left/right styles, never `row-reverse`). Data access stays in `src/api/*`.
- No new heavy dependencies without need. `FlatList` (built-in) is the default
  virtualization tool — do **not** add FlashList unless a converted screen still
  measurably janks (get owner OK first).
- After each phase: test on web (admin) AND native (Expo Go / dev build) — both
  platforms ship from this one codebase.
- Log anything unexpected in `GLITCH_LOG.md` (append).

## Verdict from the scan (context)

Good foundations already in place: Hermes + New Architecture enabled, recursive
rollups are server-side batched RPCs (no client tree-walking, no N+1), progress
writes are debounced to ~5s, `refetchOnWindowFocus` is off, global `staleTime` 60s.
The real costs found, ordered by user-visible impact:

| # | Finding | Impact | Phase |
|---|---------|--------|-------|
| 1 | **Zero virtualized lists in the whole app** — every list renders all rows at once inside a `ScrollView` (the shared `src/components/ui/Screen.tsx` wrapper). Hurts most on: notifications, section lecture lists, admin lectures/users/questions tables | High, grows with content | P1 |
| 2 | **Whole-store player subscriptions**: `usePlayerStore()` without a selector in `MiniPlayer.tsx`, `ContinueCard.tsx`, `app/player/[id].tsx`, `app/(student)/lecture-note/[id].tsx` → every position tick re-renders these trees for the entire duration of playback (MiniPlayer is mounted globally) | High while audio plays | P2 |
| 3 | **Unbounded queries**: notifications list has no `.limit()` (grows forever per user); admin lectures/users lists fetch everything | Medium, grows with time | P3 |
| 4 | Signed audio/attachment URLs are minted with 1h TTL but cached under the global 60s `staleTime` → needless re-mint round-trips | Low-Medium | P4 |
| 5 | Startup/assets: stray 8.2MB MP3 in the Metro-watched root (known cold-start/font-timeout aggravator, see GLITCH_LOG #1/#2); font weights loaded vs actually used unverified | Low-Medium (dev + web mostly) | P5 |

Explicitly checked and already fine (don't spend time here): rollup RPC batching,
progress write cadence, `getRecentLectures` capped at 40, dependency list is lean
(no dead heavy packages), Hermes/newArch flags, horizontal rails as ScrollViews.

---

## Phase P1 — Virtualize the long lists (biggest win)

**Goal:** long screens mount ~10–15 rows instead of hundreds.

1. **Understand the wrapper first**: `src/components/ui/Screen.tsx` is a ScrollView.
   A converted screen must NOT nest a FlatList inside it. Add a variant (e.g.
   `Screen` prop `scroll={false}` or a `ListScreen` sibling) that provides the same
   safe-area/padding/RTL frame without the ScrollView, and put the screen's header
   content into `ListHeaderComponent`.
2. Convert in this order (student first, then admin):
   1. `app/(student)/notifications.tsx`
   2. `app/(student)/section/[id].tsx` (lecture rows; keep the subsections
      scroller component as-is)
   3. `app/(student)/recent.tsx` and `app/(student)/featured.tsx`
   4. `app/(student)/questions.tsx` + `src/components/questions/QuestionsBoard.tsx`
   5. Admin tables: `app/admin/lectures.tsx`, `users.tsx`, `questions.tsx`,
      `quizzes.tsx`, `reminders.tsx` (web — FlatList works on react-native-web)
3. Per list: `keyExtractor` from the row id, `initialNumToRender` ≈ one screenful,
   memoize row components (`React.memo`) and callbacks. Where row height is fixed,
   add `getItemLayout`.
4. Skip tiny/static lists (about, profile, journey cards) — virtualizing them is
   negative value. Leave horizontal rails (`FeaturedRail`, `NewlyAddedRail`,
   `SubsectionsScroller`) as ScrollViews.
5. **Verify per screen:** scroll behaves identically (RTL intact, pull-to-refresh
   if present still works), no blank-flash while fast-scrolling, screen still
   renders the empty-state correctly.

**Done when:** the five listed groups render via FlatList with stable scrolling on
native and web.

## Phase P2 — Player re-render containment

**Goal:** during playback, only the components that display the live position re-render.

1. Replace whole-store `usePlayerStore()` destructuring with per-field selectors
   (`usePlayerStore((s) => s.isPlaying)` etc.) in the four files listed in
   finding #2. Split components where needed so the **position-driven** part
   (progress bar / scrubber / time label) is a small leaf component; title,
   buttons, artwork must not re-render on ticks.
2. `ContinueCard` (Home) does not need a live position — read the position once
   (snapshot or a coarse selector) so Home stays quiet during playback.
3. Check the tick source in `src/lib/audioController.ts` (`playbackStatusUpdate`
   listener): if the store's `setPosition` is called more often than ~1×/sec,
   throttle writes to 1/sec (or set the player's status-update interval if
   expo-audio exposes it). Do NOT throttle what the full-player scrubber displays
   while the user is dragging.
4. **Verify:** with audio playing, navigate Home / a section / notes — interactions
   feel smooth; use React DevTools Profiler (web) to confirm MiniPlayer's parent
   trees stop re-rendering per tick; lock-screen controls and the 90% completion
   trigger still work.

**Done when:** playback ticks re-render only the position leaf components.

## Phase P3 — Bound the unbounded queries

**Goal:** no query whose payload grows without limit.

1. **Notifications** (`src/api/notifications.ts`, list fn around line 116): add
   `.limit(50)` + "load more" via `useInfiniteQuery` (TanStack) keyed on
   `created_at` cursor — or, if the screen UX should stay simple, a plain
   `.limit(100)` with a "showing latest 100" footer note. Prefer infinite query;
   it's the standard pattern and the screen is already being converted to
   FlatList in P1 (pairs naturally with `onEndReached`).
2. **Admin lectures** (`src/api/admin.ts` ~line 125): keep full fetch for now if
   the library is small (< ~500 rows — check live count), but add `.limit(1000)`
   as a guard and a `// pagination TODO` note; the admin screens already filter
   client-side. `admin_user_list` RPC (0025) — check it already takes paging
   params; if yes, wire the admin users screen to page (50/page) instead of
   fetching all.
3. **Verify:** notifications screen loads fast with a seeded 200-notification test
   user; "load more" appends correctly; unread badge logic (if any) still matches.

**Done when:** notifications paginate; admin lists bounded or consciously guarded.

## Phase P4 — Cache tuning (cheap wins)

**Goal:** stop refetching things that rarely change; stop re-minting valid signed URLs.

1. **Signed URLs** (`src/api/lectures.ts` ~line 16, `src/api/attachments.ts` ~line 67,
   and their hooks `useLecture`/`useAttachments`): URLs are valid 3600s but cached
   only 60s. Give these queries `staleTime: 45 * 60 * 1000` and
   `gcTime: 50 * 60 * 1000`, keyed per storage path, so replaying/reopening a
   lecture within ~45min never re-mints. Keep the mint-on-error retry path.
2. **Per-key staleTime** in the hooks (not globally): sections tree + rollups
   5 min; `app_config` (support contact etc.) 30 min; featured + broadcasts 5 min;
   leave progress/journey/notifications at the 60s default or shorter.
3. **Verify:** airplane-mode-off normal use: navigating back/forth between Home ↔
   section ↔ player triggers no visible refetch spinners; changing content as
   admin still shows up for students within the chosen staleness windows (owner
   expectation: minutes is fine).

**Done when:** network tab (web) shows no repeated signed-URL mints or tree
refetches during a normal 5-minute browse session.

## Phase P5 — Startup & assets

**Goal:** faster cold start, especially web dev/admin.

1. Move `Voice 015 (online-audio-converter.com).mp3.mp3` (8.2MB, project root)
   into `test-media/` (already gitignored) or delete it — confirm with the owner
   it has no unique content first 🛑 (one question, not a phase blocker: default
   to moving, never deleting, if no answer).
2. **Fonts:** inventory which Amiri / IBM Plex Sans Arabic weights are actually
   referenced (`src/constants/theme.ts` + font loading in `app/_layout.tsx`);
   drop unused weight imports. Re-test the web boxed-icons glitch afterwards
   (GLITCH_LOG #2) — it may simply disappear.
3. **Startup work audit** in `app/_layout.tsx`: confirm notifications bootstrap,
   font loading, and auth restore run in parallel, and nothing blocks first paint
   that could be deferred (e.g. push-token registration can run after first
   frame). Small re-orderings only — no architectural change.
4. **Verify:** time a web dev cold start and a native cold start before/after
   (3 runs each, note in the PR/commit message); boxed-icons glitch status noted
   in `GLITCH_LOG.md`.

**Done when:** root is media-free, only used font weights load, startup numbers
recorded before/after.

## Phase P6 — Measure + server check (closing sweep)

1. Run the **Supabase performance advisor** (dashboard → Advisors → Performance):
   apply low-risk index suggestions as migration `00xx_perf_indexes.sql` (likely
   candidates the scan predicts: `daily_listening (user_id, day)`,
   `notifications (user_id, created_at desc)`, `quiz_attempts (quiz_id, user_id)` —
   only add what the advisor/EXPLAIN actually supports).
2. Skim pg_stat_statements top queries via MCP; if `search_buddy_candidates`
   shows up hot (it computes a streak per candidate row), note it in
   `GLITCH_LOG.md` as a future optimization — do not rewrite it now.
3. Final regression pass: full student + admin click-through on native and web,
   audio playback + background audio + downloads + resume.

**Done when:** advisor clean or triaged, click-through green, findings appended to
the log.

---

## Final acceptance for the whole plan

- P1–P6 done in order, each verified on both platforms.
- Before/after startup timings recorded (P5) and a one-paragraph summary of
  user-visible improvements written at the top of this file under "RESULTS".
- `GLITCH_LOG.md` updated.
