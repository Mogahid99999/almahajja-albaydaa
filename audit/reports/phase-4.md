# Phase 4 report — Content browsing & discovery

**Branch:** `audit/phase-4-browsing` (stacked on `audit/phase-3-auth`)
**Scope audited:** Home (`index.tsx` + `components/home/*`), `section/[id]`, `recent`,
`featured`, `sheikh-info`, `attachment/[id]`, `search` — plus `SectionsGrid`, both rails,
`ContinueCard`, `LectureRowItem`, `SubsectionsScroller`, `ProgressCard`, `SectionNavBar`,
`src/api/{sections,lectures,search,sheikhs}.ts`, `src/hooks/{useSections,useSearch,useLecture}.ts`,
and the server truth they depend on (migrations 0038/0047/0049/0059/0068/0072).
**Date:** 2026-07-15 · Executed per PLAN_AUDIT §Phase 4 + §2 checklist.

---

## 1. Headline finding — F-036 (P1): gender-visibility leak on browse lists

Gender scoping (`section_visible_to_viewer`, 0049) is enforced **only inside individual RPCs**
— never at RLS (`lectures_select` = `status='published' or is_content_manager()`), and 0049's
own comment flags `get_featured_lectures()` as the one list it left unfiltered. Concretely:

- **«أحدث الدروس»** (`getRecentLectures`, raw table select) listed — and on tap, played —
  lectures from opposite-gender sections that Home's server-scoped أُضيف حديثاً rail hides.
- **«المختارات»** leaked the same way on *both* surfaces: Home's rail (whose `get_home_page`
  featured leg just calls the unfiltered RPC) and the full-list screen.

**Interim client fix (shipped):** `filterVisibleLectures()` in `src/api/lectures.ts` passes
these small lists (≤8, staff-curated) through the existing per-lecture
`lecture_visible_to_viewer` RPC — parallel, fail-open per item (a hiccup degrades to the
pre-filter behavior, never a blanked list). Recent over-fetches 3× then slices to `limit` so
filtering can't leave the screen short while the rail shows a full 8.

**Deliberate costs, accepted until Phase 2:** Home's featured leg pays +1 RTT when the rail is
non-empty; recent issues up to 24 parallel lightweight checks per 30-min cache window.
**Phase 2 must** scope `get_featured_lectures` in SQL and add a filtered recent RPC (or extend
lectures RLS) — then delete the client filter. Search (`search_content`, 0068) was verified
already fully scoped (gender + published) server-side; `get_section_page`/`get_sections_flat`
likewise (0049/0059).

## 2. Other fixes

| ID | Sev | One-liner |
|---|---|---|
| F-011 | P3 | Section-nav search icon was a dead TODO stub from before search shipped — now opens بحث (every section page + attachment reader). |
| F-037 | P2 | ContinueCard's pause-glyph button never paused (always navigated). Now: pause when playing; resume via `playLecture` when current-but-paused (`preloadLecture` no-ops on the current lecture — the naïve fix would strand audio paused); `stopPropagation` so web's DOM bubbling doesn't navigate after pausing. |
| F-020 | P3 | Hardcoded sheikh display-name override moved to `src/config.ts` and applied at all three render sites via one helper. Remaining closure = owner renames `sheikhs.name` in the DB, then deletes the entry. |
| F-038 | P3 | Sheikh photo signed-URL expiry rendered an empty circle — `onError` now falls back to the placeholder icon and resets when a fresh URL arrives. |

## 3. Logged, not fixed (confirmed leads with owners)

- **F-039 (P2 → Phase 5):** every mounted `LectureRowItem` mints a signed URL
  (`prefetchPlayback`) — a 500-lecture section scroll issues hundreds of r2-read-url calls.
  Deliberate tap-latency tradeoff; Phase 5 owns audioController and should bound it.
- **F-040 (P3 → Phase 2):** «عرض الكل» for recent shows the same 8 items as the rail (both
  capped at 8) — fold a parameterized, server-filtered recent RPC into the F-036 SQL fix.
- **F-041 (P3 → Phase 11):** search's sheikh results navigate without an id (multi-sheikh
  match all lands on the primary's page); huge transcripts render as one Text node; the
  section/attachment «غير موجود» empty-states double as network-error states with no
  offline wording.

## 4. Verified-sound (selected checklist evidence)

- **Stale-cache-after-unpublish:** `reconcileContentListsAfterHydration` invalidates the
  `home/section/sections/lectures` roots post-hydration, online-only, `refetchType:'active'` —
  matches its documented contract; recent/featured/search roots are outside it but recent +
  featured refetch on stale mount and search is never persisted.
- **Section page at every depth:** one generic template; FlatList (virtualized,
  `initialNumToRender=10`) for lectures; subsection-container sections stay quiet (empty-state
  only when no lectures AND no subsections); rollups come from server SQL
  (`get_section_page`/`get_children_rollups`) — no client tree-walking anywhere (CLAUDE.md rule
  holds). Progress % display = server truth; division guarded (`total > 0`).
- **Search:** 350 ms debounce with timer cleanup; `enabled` gate on empty; results scoped
  server-side (0068: published + gender + anonymity — benefits/questions never select
  `user_id`); Arabic diacritics/hamza normalization is whatever Postgres `arabic` FTS config
  does — flagging exotic-variant matching quality as a content-team observation, not a defect.
- **Rails:** ScrollView-not-FlatList is fine at their hard 8-item server cap;
  `ContinueCard` dismiss snapshot (`lectureId@position`) semantics verified; `?t=` handoff
  passes the displayed position (never trusts a stale cache).
- **Home:** single-RPC payload; pull-to-refresh fans out to buddy/notifications/journey/
  broadcasts with `refetchType:'all'` (matches its comment); loading state only on cold cache.
- **Attachment reader:** loading/not-found/empty-body states all present; transcript body is
  plain text (no injection surface).

## 5. §2 per-screen checklist — ×7 screens

Legend: ✅ pass (code-verified) · 🔧 fixed · 📋 logged (F-nnn) · 📱 device-pass pending · N/A.

| Dimension | Home | section/[id] | recent | featured | sheikh-info | attachment | search |
|---|---|---|---|---|---|---|---|
| Functional correctness | 🔧 F-036/37 | ✅ | 🔧 F-036 | 🔧 F-036 | 🔧 F-020 | ✅ | ✅ |
| Crash paths | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edge cases (empty/huge/malformed) | ✅ | ✅ (F-042 waiver) | 🔧 short-list | ✅ | ✅ | 📋 F-041 huge | ✅ |
| Loading/empty/error/offline | ✅ | 📋 F-041 offline copy | ✅ | ✅ | ✅ | 📋 F-041 | ✅ |
| Guest vs registered vs role | ✅ (guest banner/journey gates) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Input validation | N/A | N/A (id → not-found) | N/A | N/A | N/A | N/A | ✅ server-side |
| State mgmt / cache | ✅ reconcile roots | ✅ keepPreviousData | ✅ | ✅ | 🔧 F-038 URL expiry | ✅ | ✅ debounce+gc |
| Navigation / back / deep-link | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 📋 F-041 sheikh rows |
| API races / cancellation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (RQ keying) |
| Security (RLS/leakage) | 🔧 F-036 | ✅ (server-scoped) | 🔧 F-036 | 🔧 F-036 | ✅ | ✅ | ✅ (0068) |
| Performance / virtualization | ✅ capped rails | ✅ FlatList · 📋 F-039 | ✅ | ✅ | ✅ | 📋 F-041 | ✅ |
| Memory (listeners/timers) | ✅ | ✅ | ✅ | ✅ | 🔧 effect reset | ✅ | ✅ timer cleanup |
| Accessibility | ✅ labels | 📱 | ✅ | ✅ | 📱 expand rows | 📱 reading order | ✅ |
| Small/large phones · tablet | 📱 | 📱 | 📱 | 📱 | 📱 | 📱 | 📱 |
| Keyboard handling | N/A | N/A | N/A | N/A | N/A | N/A | ✅ |
| Background/kill/restore | ✅ persisted cache | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (transient) |
| Localization (Arabic/arNum) | ✅ | ✅ arLectureCount | ✅ | ✅ | ✅ | ✅ | ✅ |

## 6. Verification status & waivers

- `npm run typecheck` clean; `/code-review` (medium) ran over the diff — its five findings
  (play-after-pause dead end, web bubbling, filter-after-limit shortfall, stale guard comment,
  override single-site) were **all confirmed and fixed in-branch**; its Home +1 RTT observation
  is accepted and documented above.
- **Waiver (F-042):** staging seeding of pathological trees is blocked by F-002 — tree edge
  cases verified against the SQL semantics + component code only; re-run live when staging
  exists. Device/tablet/a11y cells (📱) roll into the Phase 11 matrix as usual.
