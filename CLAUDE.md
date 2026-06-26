# منصة دروس العلم الشرعي

## What this is
An Arabic-first (RTL) Islamic learning app. Lectures are organized into nested sections/items (a section can contain sub-sections and lectures, recursively — e.g. العقيدة → التوحيد → كتاب التوحيد → lessons). Calm, non-competitive tone throughout: no leaderboards, no public ranking, no gamified visuals.

## Scope decision
Telegram bot integration is DEFERRED. For now, lectures are added only through a manual admin upload form. Build the "unclassified" admin review concept anyway (draft/published status), so the bot can plug into the same queue later without any redesign.

## MVP feature list (build in this order)
1. Admin upload form (title, audio file, parent section, order number, sheikh name, attachments, publish status)
2. Nested sections/items data model and navigation
3. Web admin panel for managing sections/items/lectures
4. Direct playback on tap + mini player + full player
5. Resume from last position, mark complete at 90%+ listened
6. Offline download per lecture (download/delete)
7. Personal progress tracking (started/in progress/completed, % per section) — never compared between students
8. Simple roles: student / admin
9. "About the platform" page — static, asks users to pray for the teachers and contributors

## Explicitly out of scope for now
Telegram bot, quizzes, attachments-as-a-system, admin mobile panel, notifications, weekly goals/streaks/badges/journey page, study companion, roadmap, onboarding screen.

## Tech Stack

**Single cross-platform codebase targeting iOS, Android, and Web (Expo).**

| Concern | Choice |
|---|---|
| App framework | **Expo (React Native)** — SDK 56 |
| Navigation | **Expo Router** (file-based routing, `app/` directory) |
| Language | **TypeScript** with `strict` mode enabled |
| Backend | **Supabase** — PostgreSQL database, Auth, and File Storage (audio + downloads) |
| Audio playback | **expo-audio** |
| Offline downloads | **expo-file-system** |
| Client state | **Zustand** (player state, download state) |
| Server state / data fetching | **TanStack Query** (`@tanstack/react-query`) |

### Why this stack
- One codebase ships the three mobile screens (Home, Section, Player) **and** the web admin dashboard — no separate web app to maintain.
- Supabase Postgres natively supports the recursive `WITH RECURSIVE` CTEs the nested-section rollups need (see `.claude/skills/nested-sections`). Those CTEs live as SQL functions in `supabase/migrations` and are called from the client via `supabase.rpc(...)`.
- The [nested-sections skill](.claude/skills/nested-sections/SKILL.md) originally sketched a Prisma/Next.js data layer; the **schema and query semantics are unchanged**, only the implementation is Supabase SQL + `supabase-js` instead of Prisma.

### Project layout
```text
app/                  Expo Router routes (file-based). Route bodies are placeholders until the screen-building phase.
  _layout.tsx         Root: RTL enforcement + QueryClientProvider
  (student)/          Student app group (Home, generic Section page)
  (admin)/            Admin web dashboard group
  player/[id].tsx     Full-screen player
src/
  lib/                supabase client, query client, env
  api/                Data-access functions (sections, lectures, progress) — mirror the nested-sections skill
  hooks/              TanStack Query hooks wrapping src/api
  stores/             Zustand stores (player, downloads)
  types/              Shared types incl. generated DB types
  constants/          Design tokens (colors/typography from README design system)
  components/         Shared UI (added during screen phase)
supabase/
  migrations/         SQL schema, RLS policies, recursive-rollup RPC functions
```

### Stack conventions
- All data-access goes through `src/api/*`; components never call `supabase` directly.
- Recursive subtree rollups (lecture counts, progress %) are **always** server-side SQL functions, never client-side tree walking.
- Student-facing reads must filter `status = 'published'`; admin reads see drafts too (enforced by RLS, not just query filters).

## Design
RTL throughout, design system synced from Claude Design. Calm muted teal/off-white palette, no bright competitive colors, no heavy animation.

## Conventions
[fill in once decided: naming, file structure, etc. — leave blank for now, Claude Code will propose these]
